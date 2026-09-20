import type { Finding, TaskView } from "../types";

const taskContext = {
  taskId: "fixture-orders-pagination",
  title: "Paginate orders",
  repository: "commerce-api",
  branch: "codex/orders-pagination",
  request: "Add cursor pagination to the orders API without breaking existing clients.",
};

const initialFinding: Finding = {
  id: "finding-initial-contract",
  label: "Approach forming",
  time: "1:14",
  headline: "Existing clients expect an array. I’m considering a separate paginated route.",
  explanation:
    "The current route returns an array directly, so changing its response shape could break callers. This is an initial proposal, not a confirmed constraint on the final design.",
  tone: "neutral",
  tentative: true,
  sourceEventIds: ["event-agent-message-01", "event-item-completed-04"],
  supportingSteps: [
    {
      title: "Traced the orders endpoint and its callers",
      detail: "The route currently returns the repository result directly.",
      path: "src/routes/orders.ts",
    },
  ],
  commands: [
    {
      command: "rg \"orders\" src tests",
      output: "Found the route, repository, and compatibility tests.",
    },
  ],
};

const updatedFinding: Finding = {
  id: "finding-opt-in-pagination",
  label: "Approach updated",
  time: "2:05",
  headline: "Pagination will be opt-in on the existing route, matching the customers API.",
  explanation:
    "The customers API already uses optional limit and cursor parameters while preserving the legacy array response when pagination is not requested. Reusing that convention avoids a second route and protects existing clients.",
  tone: "success",
  sourceEventIds: ["event-direction-01", "event-agent-message-03", "event-item-completed-08"],
  supportingSteps: [
    {
      title: "Compared the customers API convention",
      detail: "The existing route adds pagination only when the caller opts in.",
      path: "src/routes/customers.ts",
    },
    {
      title: "Reused the cursor helper",
      detail: "The orders route can share the existing cursor encoding and response branch.",
      path: "src/pagination/cursor.ts",
    },
  ],
  commands: [
    {
      command: "sed -n '1,220p' src/routes/customers.ts",
      output: "The customers route keeps the legacy response unless limit or cursor is present.",
    },
  ],
};

const edgeCaseFinding: Finding = {
  id: "finding-timestamp-tie",
  label: "Found an edge case",
  time: "5:32",
  headline: "A timestamp-only cursor skips orders created at the same instant.",
  explanation:
    "The first implementation used creation time alone. When a page ends halfway through a group sharing that timestamp, the next page jumps past the remaining orders. The cursor needs a unique tie-breaker.",
  tone: "warning",
  sourceEventIds: ["event-test-boundary", "event-agent-message-07", "event-diff-03"],
  supportingSteps: [
    {
      title: "Added the opt-in pagination branch",
      detail: "The legacy response path remains unchanged when no cursor is provided.",
      path: "src/routes/orders.ts",
    },
    {
      title: "Legacy response test passes",
      detail: "Existing clients continue to receive an array.",
      path: "tests/orders.test.ts",
    },
    {
      title: "Boundary test fails",
      detail: "Two orders are missing when creation timestamps are identical.",
      path: "tests/orders.test.ts · identical timestamps",
    },
  ],
  commands: [
    {
      command: "pnpm test -- orders.test.ts -t boundary",
      output: "Expected 4 orders, received 2. The failing case uses identical creation timestamps.",
    },
  ],
};

const completeFinding: Finding = {
  id: "finding-complete",
  label: "Complete",
  time: "8:12",
  headline: "Cursor pagination is ready. Existing clients keep the same response.",
  explanation:
    "The existing orders response remains unchanged by default. Opt-in callers can request a limit and cursor, and the cursor now uses creation time plus order ID so tied timestamps are ordered consistently.",
  tone: "success",
  sourceEventIds: ["event-test-final", "event-agent-message-11", "event-turn-completed"],
  supportingSteps: [
    {
      title: "Added order ID as the cursor tie-breaker",
      detail: "The query and cursor now use the same two-part ordering.",
      path: "src/routes/orders.ts",
    },
    {
      title: "Reran the endpoint tests",
      detail: "Legacy, opt-in, and identical-timestamp cases pass.",
      path: "tests/orders.test.ts",
    },
  ],
  commands: [
    {
      command: "pnpm test -- orders.test.ts",
      output: "12 endpoint tests passed.",
    },
  ],
};

const historyFor = (...findings: Finding[]) => [...findings].reverse();

export const walkthroughFixtures: Record<string, TaskView> = {
  overview: {
    ...taskContext,
    status: "running",
    statusLabel: "Working",
    currentActivity: "Looking for pagination conventions elsewhere…",
    nextStep: "Check the project’s pagination conventions.",
    currentFinding: initialFinding,
    history: historyFor({
      ...initialFinding,
      id: "finding-earlier-array-contract",
      label: "Confirmed earlier",
      time: "0:38",
      headline: "The orders route currently returns an array directly.",
      explanation: "This is a confirmed observation of the current implementation, not a conclusion about the final design.",
      sourceEventIds: ["event-read-orders-route"],
    }),
    fixtureLabel: "Recorded walkthrough · initial approach",
  },
  steering: {
    ...taskContext,
    status: "running",
    statusLabel: "Working",
    currentActivity: "Reusing the cursor helpers…",
    nextStep: "Implement the optional query and response branches.",
    currentFinding: updatedFinding,
    history: historyFor(initialFinding),
    direction: {
      text: "Follow the customers API: use limit and cursor, and return data plus nextCursor only when pagination is requested.",
      state: "adopted",
      detail: "Direction received · later commentary and actions confirmed the changed approach.",
    },
    fixtureLabel: "Recorded walkthrough · direction adopted",
  },
  evidence: {
    ...taskContext,
    status: "running",
    statusLabel: "Working",
    currentActivity: "Fixing the ordering and rerunning the boundary test…",
    nextStep: "Use creation time and order ID together.",
    currentFinding: edgeCaseFinding,
    history: historyFor(updatedFinding, initialFinding),
    direction: {
      text: "Follow the customers API: use limit and cursor, and return data plus nextCursor only when pagination is requested.",
      state: "adopted",
      detail: "The direction was incorporated before the edge case was found.",
    },
    fixtureLabel: "Recorded walkthrough · evidence expanded",
  },
  complete: {
    ...taskContext,
    status: "completed",
    statusLabel: "Complete",
    currentActivity: "All requested verification is complete.",
    currentFinding: completeFinding,
    history: historyFor(edgeCaseFinding, updatedFinding, initialFinding),
    completion: {
      headline: "Cursor pagination is ready.",
      detail: "Existing clients keep the same response while opt-in callers can paginate safely.",
      checks: ["12 endpoint tests passed", "Identical-timestamp boundary covered"],
      changedFiles: ["src/routes/orders.ts", "src/pagination/cursor.ts", "tests/orders.test.ts"],
    },
    fixtureLabel: "Recorded walkthrough · complete and review",
  },
};

export function getWalkthroughFixture(name: string | null): TaskView {
  return walkthroughFixtures[name ?? "overview"] ?? walkthroughFixtures.overview;
}
