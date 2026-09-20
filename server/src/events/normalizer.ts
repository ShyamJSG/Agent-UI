import type { ServerNotification } from "../../../protocol/ServerNotification";
import type { ServerRequest } from "../../../protocol/ServerRequest";
import type { ThreadItem } from "../../../protocol/v2/ThreadItem";

export type ProtocolMessage = ServerNotification | ServerRequest;

export type NormalizedEvent = {
  id: string;
  sequence: number;
  method: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  activity: string;
  agentDelta?: string;
  itemType?: string;
  message: ProtocolMessage;
  receivedAt: string;
};

export function normalizeProtocolMessage(message: ProtocolMessage, sequence: number): NormalizedEvent {
  const base: NormalizedEvent = {
    id: `event-${sequence}`,
    sequence,
    method: message.method,
    activity: "Working through the task",
    message,
    receivedAt: new Date().toISOString(),
  };

  if (message.method === "item/started" || message.method === "item/completed") {
    return {
      ...base,
      threadId: message.params.threadId,
      turnId: message.params.turnId,
      itemId: message.params.item.id,
      itemType: message.params.item.type,
      activity: activityForItem(message.params.item),
    };
  }

  if (message.method === "item/agentMessage/delta") {
    return {
      ...base,
      threadId: message.params.threadId,
      turnId: message.params.turnId,
      itemId: message.params.itemId,
      activity: "Writing the current understanding",
      agentDelta: message.params.delta,
      itemType: "agentMessage",
    };
  }

  if (message.method === "turn/started") {
    return {
      ...base,
      threadId: message.params.threadId,
      turnId: message.params.turn.id,
      activity: "Starting the task",
    };
  }

  if (message.method === "turn/completed") {
    return {
      ...base,
      threadId: message.params.threadId,
      turnId: message.params.turn.id,
      activity: message.params.turn.status === "completed" ? "Task turn completed" : "Task turn ended",
    };
  }

  if (message.method === "turn/plan/updated") {
    return { ...base, threadId: message.params.threadId, turnId: message.params.turnId, activity: "Planning the next step" };
  }

  if (message.method === "turn/diff/updated") {
    return { ...base, threadId: message.params.threadId, turnId: message.params.turnId, activity: "Reviewing file changes" };
  }

  if ("id" in message && (message.method.includes("requestApproval") || message.method.includes("requestUserInput") || message.method === "mcpServer/elicitation/request")) {
    return { ...base, activity: "Waiting for approval or input" };
  }

  if (message.method === "error") {
    return { ...base, activity: "Codex reported an error" };
  }

  return base;
}

function activityForItem(item: ThreadItem): string {
  switch (item.type) {
    case "commandExecution":
      return "Running a command";
    case "fileChange":
      return "Editing files";
    case "plan":
      return "Planning the next step";
    case "agentMessage":
      return "Writing the current understanding";
    case "reasoning":
      return "Considering the approach";
    default:
      return "Working through the task";
  }
}
