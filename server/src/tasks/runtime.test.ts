import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../protocol/ServerNotification";
import { normalizeProtocolMessage } from "../events/normalizer";
import { TaskStore } from "../persistence/store";
import { TaskRuntime } from "./runtime";

describe("TaskRuntime with a fake app-server", () => {
  it("streams item deltas into a completed normalized task view", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });
    const updates: string[] = [];
    runtime.subscribe((view) => updates.push(view.status));

    const task = await runtime.start("Reply with exactly BACKEND_READY.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "completed");

    expect(task.taskId).toMatch(/^live-/);
    expect(runtime.getView()?.status).toBe("completed");
    expect(runtime.getView()?.currentFinding.headline).toBe("BACKEND_READY");
    expect(runtime.getView()?.history).toHaveLength(1);
    expect(runtime.getEvents().filter((event) => event.method === "item/agentMessage/delta")).toHaveLength(2);
    expect(updates).toContain("running");
    expect(updates).toContain("completed");

    runtime.close();
  });

  it("surfaces a command approval and routes an explicit decision", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Please request approval before continuing.", process.cwd());
    await waitFor(() => runtime.getView()?.approval?.state === "pending");

    expect(runtime.getView()?.approval).toMatchObject({
      method: "item/commandExecution/requestApproval",
      title: "Codex requests command approval",
      availableActions: ["accept", "decline", "cancel"],
    });

    await runtime.respondToApproval(99, "accept");
    await waitFor(() => runtime.getView()?.status === "completed");
    expect(runtime.getView()?.approval?.state).toBe("resolved");

    runtime.close();
  });

  it("routes steering with the active turn and separates receipt from adoption", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });
    const directionStates: string[] = [];
    runtime.subscribe((view) => {
      if (view.direction) directionStates.push(view.direction.state);
    });

    await runtime.start("Keep this turn steerable.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "running");
    await runtime.steer("Use the customers API convention.", "steer-action-1");

    expect(directionStates).toContain("received");
    await waitFor(() => runtime.getView()?.direction?.state === "adopted");
    const eventsAfterDelivery = runtime.getEvents().length;
    await runtime.steer("Use the customers API convention.", "steer-action-1");

    expect(runtime.getView()?.direction?.state).toBe("adopted");
    expect(runtime.getEvents()).toHaveLength(eventsAfterDelivery);

    runtime.close();
  });

  it("retains direction for follow-up when the active turn has ended", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Complete this turn normally.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "completed");
    await runtime.steer("Please use the customers API convention.");

    expect(runtime.getView()?.direction?.state).toBe("queuedForFollowUp");
    expect(runtime.getView()?.direction?.detail).toMatch(/turn ended before delivery/i);

    runtime.close();
  });

  it("shows known steering delivery failure without retrying", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Keep this turn steerable.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "running");
    await expect(runtime.steer("fail this direction")).rejects.toThrow("fake steer rejected");
    expect(runtime.getView()?.direction?.state).toBe("deliveryFailed");

    runtime.close();
  });

  it("keeps stopping separate from stopped until turn completion confirms interruption", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });
    const statuses: string[] = [];
    runtime.subscribe((view) => statuses.push(view.status));

    await runtime.start("Keep this turn steerable.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "running");
    await waitFor(() => runtime.getView()?.currentFinding.headline === "Initial understanding");
    const beforeStop = runtime.getView()?.currentFinding.headline;
    await runtime.interrupt();

    await waitFor(() => runtime.getView()?.status === "stopped");
    expect(runtime.getView()?.status).toBe("stopped");
    expect(statuses).toContain("stopping");
    expect(runtime.getView()?.currentFinding.headline).toBe(beforeStop);
    expect(runtime.getView()?.currentActivity).toBe("Task turn ended");

    runtime.close();
  });

  it("restores running state when the interrupt request fails", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Keep this turn steerable interrupt-fail.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "running");
    await expect(runtime.interrupt()).rejects.toThrow("fake interrupt rejected");

    expect(runtime.getView()?.status).toBe("running");
    expect(runtime.getView()?.currentActivity).toMatch(/stop request failed/i);

    runtime.close();
  });

  it("reconciles a saved disconnected task without starting a duplicate turn", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const store = new TaskStore();
    const threadId = "fake-thread-1";
    const turnId = "fake-turn-1";
    const view = {
      taskId: "restored-task",
      title: "Restored task",
      repository: "fixture",
      cwd: process.cwd(),
      branch: "main",
      request: "Continue the saved task",
      status: "running" as const,
      statusLabel: "Working",
      currentActivity: "Working",
      currentFinding: {
        id: "finding-restored",
        label: "Working understanding",
        time: "now",
        headline: "Saved understanding",
        explanation: "Saved explanation",
        tone: "neutral" as const,
        tentative: true,
        sourceEventIds: [],
        supportingSteps: [],
        commands: [],
      },
      history: [],
      fixtureLabel: "restored",
    };
    const message = {
      method: "turn/started",
      params: {
        threadId,
        turn: { id: turnId, items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: 1, completedAt: null, durationMs: null },
      },
    } as Extract<ServerNotification, { method: "turn/started" }>;
    store.persist({ view, event: normalizeProtocolMessage(message, 1), threadId, turnId });

    const runtime = new TaskRuntime({ store, executable: process.execPath, args: [fakeServer] });
    expect(runtime.getView()?.status).toBe("disconnected");
    await runtime.reconcile();

    expect(runtime.getView()?.status).toBe("running");
    expect(runtime.getView()?.currentActivity).toMatch(/reconnected to the active/i);

    runtime.close();
  });

  it("starts a follow-up as a new turn in the same thread", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Complete the first turn normally.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "completed");
    const previousFinding = runtime.getView()?.currentFinding.id;

    await runtime.followUp("Now verify the result in a follow-up turn.");
    await waitFor(() => runtime.getView()?.status === "completed");

    expect(runtime.getView()?.history.some((finding) => finding.id === previousFinding)).toBe(true);
    expect(runtime.getView()?.status).toBe("completed");

    runtime.close();
  });

  it("routes typed user-input answers", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Please request user-input before continuing.", process.cwd());
    await waitFor(() => Boolean(runtime.getView()?.approval?.userInputRequest));
    expect(runtime.getView()?.approval?.userInputRequest?.questions[0].id).toBe("preferred-style");

    await runtime.respondToUserInput(100, { "preferred-style": ["Existing convention"] });
    await waitFor(() => runtime.getView()?.status === "completed");
    expect(runtime.getView()?.approval?.state).toBe("resolved");

    runtime.close();
  });

  it("routes a simple MCP elicitation form", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({ executable: process.execPath, args: [fakeServer] });

    await runtime.start("Please request mcp input before continuing.", process.cwd());
    await waitFor(() => Boolean(runtime.getView()?.approval?.mcpElicitation));
    expect(runtime.getView()?.approval?.mcpElicitation?.formSupported).toBe(true);

    await runtime.respondToElicitation(101, "accept", { style: "concise" });
    await waitFor(() => runtime.getView()?.status === "completed");
    expect(runtime.getView()?.approval?.state).toBe("resolved");

    runtime.close();
  });

  it("applies an accepted background summary without blocking the turn", async () => {
    const fakeServer = resolve(process.cwd(), "server/test-fixtures/fake-app-server.cjs");
    const runtime = new TaskRuntime({
      executable: process.execPath,
      args: [fakeServer],
      summaryDebounceMs: 1,
      summaryMaxWaitMs: 10,
      summaryRunner: async (input) => ({
        kind: "finding",
        headline: "The background summary confirms the result.",
        explanation: "This summary came from an isolated runner.",
        sourceEventIds: input.completedEvents.map((event) => event.id),
        throughSequence: input.throughSequence,
        tentative: false,
      }),
    });

    await runtime.start("Complete this task and summarize it.", process.cwd());
    await waitFor(() => runtime.getView()?.status === "completed");
    await waitFor(() => runtime.getView()?.currentFinding.origin === "background-summary");

    expect(runtime.getView()?.currentFinding.headline).toBe("The background summary confirms the result.");
    expect(runtime.getView()?.history.length).toBeGreaterThan(0);

    runtime.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for fake app-server state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
