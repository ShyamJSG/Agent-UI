import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../protocol/ServerNotification";
import { normalizeProtocolMessage } from "./normalizer";

describe("app-server event normalizer", () => {
  it("maps agent message deltas to a stable item identity and activity", () => {
    const message: Extract<ServerNotification, { method: "item/agentMessage/delta" }> = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "The route is an array." },
    };

    const event = normalizeProtocolMessage(message, 4);

    expect(event).toMatchObject({
      id: "event-4",
      sequence: 4,
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      itemType: "agentMessage",
      activity: "Writing the current understanding",
      agentDelta: "The route is an array.",
    });
  });

  it("uses a generic activity when an item cannot be classified", () => {
    const message = {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1,
        item: { type: "reasoning", id: "item-2", summary: [], content: [] },
      },
    } as const satisfies Extract<ServerNotification, { method: "item/started" }>;

    expect(normalizeProtocolMessage(message, 5).activity).toBe("Considering the approach");
  });
});
