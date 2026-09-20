const readline = require("node:readline");

const output = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const threadId = "fake-thread-1";
const turnId = "fake-turn-1";
let steerable = false;
let interruptShouldFail = false;
const item = {
  type: "agentMessage",
  id: "fake-item-1",
  text: "BACKEND_READY",
  phase: null,
  memoryCitation: null,
  delivery: null,
  questions: null,
};

function emitCompletedTurn() {
  output({ method: "item/started", params: { threadId, turnId, startedAtMs: 2, item } });
  output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: "BACKEND_READY" } });
  output({ method: "item/completed", params: { threadId, turnId, completedAtMs: 3, item } });
  output({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [item], itemsView: "full", status: "completed", error: null, startedAt: 1, completedAt: 4, durationMs: 3 } } });
}

function emitInterruptedTurn() {
  output({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [], itemsView: "full", status: "interrupted", error: null, startedAt: 1, completedAt: 4, durationMs: 3 } } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    output({ id: message.id, result: { userAgent: "fake", platformFamily: "linux", platformOs: "linux", codexHome: "/tmp/fake-codex" } });
    return;
  }

  if (message.method === "thread/start") {
    output({ id: message.id, result: { thread: { id: threadId }, model: "fake", modelProvider: "fake", serviceTier: null, cwd: message.params.cwd, runtimeWorkspaceRoots: [], instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write", activePermissionProfile: null, reasoningEffort: null, multiAgentMode: "disabled" } });
    return;
  }

  if (message.method === "turn/start") {
    const prompt = message.params.input?.[0]?.text ?? "";
    steerable = prompt.includes("steer");
    interruptShouldFail = prompt.includes("interrupt-fail");
    output({ id: message.id, result: { turn: { id: turnId, items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: 1, completedAt: null, durationMs: null } } });
    setImmediate(() => {
      output({ method: "turn/started", params: { threadId, turn: { id: turnId, items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: 1, completedAt: null, durationMs: null } } });
      output({ method: "item/started", params: { threadId, turnId, startedAtMs: 1, item: { type: "commandExecution", id: "fake-command-1" } } });
      if (message.params.input?.[0]?.text.includes("approval")) {
        output({
          method: "item/commandExecution/requestApproval",
          id: 99,
          params: {
            kind: "command",
            threadId,
            turnId,
            itemId: "fake-command-1",
            startedAtMs: 1,
            approvalId: null,
            environmentId: null,
            reason: "Run the verification test",
            command: "node --test",
            cwd: process.cwd(),
            commandActions: [],
            additionalPermissions: null,
            proposedExecpolicyAmendment: null,
            proposedNetworkPolicyAmendments: null,
            availableDecisions: ["accept", "decline", "cancel"],
          },
        });
        return;
      }
      if (message.params.input?.[0]?.text.includes("user-input")) {
        output({
          method: "item/tool/requestUserInput",
          id: 100,
          params: {
            threadId,
            turnId,
            itemId: "fake-input-1",
            questions: [{ id: "preferred-style", header: "Style", question: "Which style should be used?", isOther: true, isSecret: false, options: [{ label: "Existing convention", description: "Match the repository." }] }],
            isBlocking: true,
            autoResolutionMs: null,
          },
        });
        return;
      }
      if (message.params.input?.[0]?.text.includes("mcp")) {
        output({
          method: "mcpServer/elicitation/request",
          id: 101,
          params: {
            threadId,
            turnId,
            serverName: "fixture-mcp",
            mode: "form",
            _meta: null,
            message: "Choose a review style.",
            requestedSchema: { type: "object", properties: { style: { type: "string", title: "Style" } }, required: ["style"] },
          },
        });
        return;
      }
      if (steerable) {
        output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: "Initial understanding" } });
        return;
      }
      output({ method: "item/started", params: { threadId, turnId, startedAtMs: 2, item } });
      output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: "BACKEND_" } });
      output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: "READY" } });
      output({ method: "item/completed", params: { threadId, turnId, completedAtMs: 3, item } });
      output({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [item], itemsView: "full", status: "completed", error: null, startedAt: 1, completedAt: 4, durationMs: 3 } } });
    });
    return;
  }

  if (message.method === "turn/steer") {
    if (message.params.input?.[0]?.text.includes("fail")) {
      output({ id: message.id, error: { code: -32000, message: "fake steer rejected" } });
      return;
    }
    output({ id: message.id, result: { turnId } });
    setTimeout(() => output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: item.id, delta: " I will use the customers API convention." } }), 25);
    return;
  }

  if (message.method === "turn/interrupt") {
    if (interruptShouldFail) {
      output({ id: message.id, error: { code: -32001, message: "fake interrupt rejected" } });
      return;
    }
    output({ id: message.id, result: {} });
    emitInterruptedTurn();
    return;
  }

  if (message.id === 99) {
    if (message.result?.decision === "accept") emitCompletedTurn();
    return;
  }

  if (message.id === 100) {
    emitCompletedTurn();
    return;
  }

  if (message.id === 101) {
    emitCompletedTurn();
    return;
  }

  if (message.method === "thread/resume") {
    output({ id: message.id, result: { thread: { id: threadId, status: { type: "active", activeFlags: [] } }, model: "fake", modelProvider: "fake", serviceTier: null, cwd: process.cwd(), runtimeWorkspaceRoots: [], instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write", activePermissionProfile: null, reasoningEffort: null, multiAgentMode: "disabled", initialTurnsPage: null, turnsBackwardsCursor: null, itemsBackwardsCursor: null } });
    return;
  }

  if (message.method === "thread/delete") {
    output({ id: message.id, result: {} });
  }
});
