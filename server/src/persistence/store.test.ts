import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../protocol/ServerNotification";
import type { TaskView } from "../../../shared/src/taskView";
import { normalizeProtocolMessage } from "../events/normalizer";
import { TaskStore } from "./store";

describe("TaskStore", () => {
  it("merges streamed item updates into one logical event and restores the latest task", () => {
    const store = new TaskStore();
    const initial = createView("waiting");
    const firstMessage: Extract<ServerNotification, { method: "item/agentMessage/delta" }> = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Existing clients " },
    };
    const secondMessage: Extract<ServerNotification, { method: "item/agentMessage/delta" }> = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "expect an array." },
    };

    store.persist({ view: initial, event: normalizeProtocolMessage(firstMessage, 1), threadId: "thread-1", turnId: "turn-1" });
    store.persist({
      view: { ...initial, status: "running", statusLabel: "Working", currentActivity: "Writing the current understanding" },
      event: normalizeProtocolMessage(secondMessage, 2),
      threadId: "thread-1",
      turnId: "turn-1",
    });

    expect(store.countEvents(initial.taskId)).toBe(1);
    expect(store.listEventsAfter(initial.taskId, 0)).toHaveLength(1);
    expect(store.listEventsAfter(initial.taskId, 1)).toHaveLength(1);
    expect(store.loadLatestTask()).toMatchObject({
      status: "disconnected",
      currentActivity: "Backend restarted; saved task state restored",
    });

    store.close();
  });
});

function createView(status: TaskView["status"]): TaskView {
  return {
    taskId: "task-1",
    title: "Test task",
    repository: "fixture",
    branch: "main",
    request: "Test task",
    status,
    statusLabel: status === "waiting" ? "Waiting" : "Working",
    currentActivity: "Waiting",
    currentFinding: {
      id: "finding-1",
      label: "Waiting",
      time: "now",
      headline: "Waiting for the first update.",
      explanation: "No conclusion yet.",
      tone: "neutral",
      tentative: true,
      sourceEventIds: [],
      supportingSteps: [],
      commands: [],
    },
    history: [],
    fixtureLabel: "test",
  };
}
