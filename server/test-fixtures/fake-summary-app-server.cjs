const readline = require("node:readline");

const output = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const threadId = "summary-thread";
const turnId = "summary-turn";

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    output({ id: message.id, result: { userAgent: "fake-summary", platformFamily: "linux", platformOs: "linux", codexHome: "/tmp/fake-summary" } });
  } else if (message.method === "thread/start") {
    output({ id: message.id, result: { thread: { id: threadId }, model: "fake", modelProvider: "fake", serviceTier: null, cwd: message.params.cwd, runtimeWorkspaceRoots: [], instructionSources: [], approvalPolicy: "never", approvalsReviewer: "user", sandbox: "workspace-write", activePermissionProfile: null, reasoningEffort: null, multiAgentMode: "disabled" } });
  } else if (message.method === "turn/start") {
    output({ id: message.id, result: { turn: { id: turnId } } });
    setImmediate(() => {
      output({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [], itemsView: "notLoaded", error: null, startedAt: 1, completedAt: null, durationMs: null } } });
      output({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "summary-message", delta: '{"kind":"no-change","throughSequence":8}' } });
      output({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [], itemsView: "full", error: null, startedAt: 1, completedAt: 2, durationMs: 1 } } });
    });
  }
});
