import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { FindingCard } from "./components/FindingCard";
import { TaskViewer } from "./components/TaskViewer";
import { SteeringComposer } from "./components/SteeringComposer";
import { walkthroughFixtures } from "./fixtures/paginationWalkthrough";

afterEach(() => vi.restoreAllMocks());

describe("recorded task viewer", () => {
  it("shows one current takeaway, activity, and next step by default", () => {
    render(<TaskViewer task={walkthroughFixtures.overview} />);

    expect(screen.getByRole("heading", { name: /existing clients expect an array/i })).toBeVisible();
    expect(screen.getByText("Looking for pagination conventions elsewhere…")).toBeVisible();
    expect(screen.getByText(/check the project’s pagination conventions/i)).toBeVisible();
    expect(screen.queryByTestId("explanation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });

  it("reveals explanation, supporting steps, and commands one level at a time", () => {
    render(<TaskViewer task={walkthroughFixtures.evidence} />);

    fireEvent.click(screen.getByRole("button", { name: "What led here" }));
    expect(screen.getByTestId("explanation")).toBeVisible();
    expect(screen.queryByTestId("supporting-steps")).not.toBeInTheDocument();
    expect(screen.queryByTestId("commands")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /supporting steps/i }));
    expect(screen.getByTestId("supporting-steps")).toBeVisible();
    expect(screen.queryByTestId("commands")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Commands and output" }));
    expect(screen.getByTestId("commands")).toBeVisible();
  });

  it("keeps earlier findings collapsed until history is requested", () => {
    render(<TaskViewer task={walkthroughFixtures.complete} />);

    expect(screen.getByRole("button", { name: /3 earlier findings/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /3 earlier findings/i }));
    expect(screen.getByTestId("history-list")).toBeVisible();
    expect(screen.getByText("A timestamp-only cursor skips orders created at the same instant.")).toBeVisible();
  });

  it("keeps an expanded finding open when its content is updated", () => {
    const { rerender } = render(<FindingCard finding={walkthroughFixtures.evidence.currentFinding} current />);

    fireEvent.click(screen.getByRole("button", { name: "What led here" }));
    fireEvent.click(screen.getByRole("button", { name: /supporting steps/i }));
    expect(screen.getByTestId("supporting-steps")).toBeVisible();

    rerender(
      <FindingCard
        finding={{
          ...walkthroughFixtures.evidence.currentFinding,
          explanation: "The evidence now includes the corrected two-part ordering.",
        }}
        current
      />,
    );

    expect(screen.getByTestId("supporting-steps")).toBeVisible();
    expect(screen.getByText("The evidence now includes the corrected two-part ordering.")).toBeVisible();
  });

  it("separates direction adoption from the direction message", () => {
    render(<TaskViewer task={walkthroughFixtures.steering} />);

    expect(screen.getByTestId("direction-status")).toHaveTextContent("Your direction changed the approach");
    expect(screen.getByText(/direction received · later commentary/i)).toBeVisible();
  });

  it("shows the completion result and changed files without a progress percentage", () => {
    render(<TaskViewer task={walkthroughFixtures.complete} />);

    expect(screen.getByTestId("completion-panel")).toBeVisible();
    expect(screen.getByText("12 endpoint tests passed")).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("surfaces supported approval choices and sends only an explicit decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApprovalPanel
        approval={{
          requestId: 42,
          method: "item/commandExecution/requestApproval",
          title: "Codex requests command approval",
          detail: "Run the verification test",
          command: "node --test",
          availableActions: ["accept", "decline"],
          state: "pending",
        }}
      />,
    );

    expect(screen.getByTestId("approval-panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Decline" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/approval",
        expect.objectContaining({
          body: expect.stringContaining('"requestId":42,"action":"accept"'),
        }),
      );
    });
  });

  it("keeps steering available and waits for backend delivery before clearing the draft", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SteeringComposer status="running" enabled onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText("Give direction without stopping the task…"), { target: { value: "Use the customers API convention." } });
    fireEvent.click(screen.getByRole("button", { name: "Send direction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Use the customers API convention."));
    expect(screen.getByPlaceholderText("Give direction without stopping the task…")).toHaveValue("");
  });

  it("renders a typed permission grant form instead of a generic approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApprovalPanel
        approval={{
          requestId: 43,
          method: "item/permissions/requestApproval",
          title: "Codex requests additional permissions",
          detail: "The task requested access to the workspace.",
          availableActions: [],
          permissionRequest: { networkRequested: true, readPaths: ["src"], writePaths: ["src"], hasUnsupportedEntries: false },
          state: "pending",
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Allow network access"));
    fireEvent.click(screen.getByRole("button", { name: "Grant selected permissions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/approval",
      expect.objectContaining({ body: expect.stringContaining('"action":"grantPermissions"') }),
    ));
  });

  it("renders generated user-input questions and sends answers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApprovalPanel
        approval={{
          requestId: 44,
          method: "item/tool/requestUserInput",
          title: "Codex is asking for input",
          detail: "1 question requires an answer.",
          availableActions: [],
          userInputRequest: {
            questions: [{ id: "style", header: "Style", question: "Which style?", isOther: true, isSecret: false, options: [{ label: "Existing", description: "Match the repo." }] }],
          },
          state: "pending",
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Existing"));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/approval",
      expect.objectContaining({ body: expect.stringContaining('"action":"answerUserInput"') }),
    ));
  });

  it("renders a simple MCP elicitation form with explicit actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ task: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ApprovalPanel
        approval={{
          requestId: 45,
          method: "mcpServer/elicitation/request",
          title: "Input requested by fixture-mcp",
          detail: "Choose a review style.",
          availableActions: [],
          mcpElicitation: { mode: "form", serverName: "fixture-mcp", message: "Choose a review style.", fields: [{ key: "style", label: "Style", type: "string", required: true }], formSupported: true },
          state: "pending",
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "Concise" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/approval",
      expect.objectContaining({ body: expect.stringContaining('"action":"mcpElicitation"') }),
    ));
  });
});
