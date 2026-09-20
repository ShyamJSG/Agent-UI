import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { TaskRuntime } from "./tasks/runtime";
import { isApprovalAction } from "./tasks/runtime";
import { TaskStore } from "./persistence/store";
import { CodexSummaryProvider } from "./summaries/codexProvider";
import { createProviderRunner } from "./summaries/provider";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const store = new TaskStore(process.env.AGENT_UI_DB ?? "data/agent-ui.sqlite");
const summaryEnabled = process.env.AGENT_UI_SUMMARY_ENABLED === "1";
const summaryRunner = summaryEnabled
  ? createProviderRunner(new CodexSummaryProvider({
      cwd: process.cwd(),
      executable: process.env.CODEX_SUMMARY_EXECUTABLE,
      timeoutMs: Number(process.env.AGENT_UI_SUMMARY_TIMEOUT_MS ?? 30000),
      onStage: (stage) => console.log(`[summary] ${stage}`),
    }))
  : undefined;
const runtime = new TaskRuntime({ store, summaryRunner, summaryDiagnostics: (message) => console.log(`[summary-result] ${message}`) });
const subscribers = new Set<ServerResponse>();

runtime.subscribe((view) => {
  const payload = `event: update\nid: ${runtime.getSequence()}\ndata: ${JSON.stringify({ view, sequence: runtime.getSequence() })}\n\n`;
  for (const response of subscribers) response.write(payload);
});

const server = createServer(async (request, response) => {
  applyCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/api/health") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && request.url === "/api/tasks/active") {
      writeJson(response, 200, { task: runtime.getView() ?? null, sequence: runtime.getSequence() });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/tasks/stream")) {
      const url = new URL(request.url, `http://${host}:${port}`);
      const headerSequence = Number(request.headers["last-event-id"] ?? 0);
      const querySequence = Number(url.searchParams.get("after") ?? 0);
      const after = Math.max(
        Number.isFinite(headerSequence) ? headerSequence : 0,
        Number.isFinite(querySequence) ? querySequence : 0,
      );
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      for (const event of runtime.replayAfter(after)) {
        response.write(`event: replay\nid: ${event.sequence}\ndata: ${JSON.stringify({ view: runtime.getView() ?? null, event, sequence: event.sequence })}\n\n`);
      }
      response.write(`event: snapshot\nid: ${runtime.getSequence()}\ndata: ${JSON.stringify({ view: runtime.getView() ?? null, sequence: runtime.getSequence() })}\n\n`);
      subscribers.add(response);
      request.on("close", () => subscribers.delete(response));
      return;
    }

    if (request.method === "POST" && request.url === "/api/tasks") {
      const body = await readJson(request);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const cwd = typeof body.cwd === "string" && body.cwd.length > 0 ? body.cwd : process.cwd();
      if (!prompt) return writeJson(response, 400, { error: "prompt is required" });
      if (!isAbsolute(cwd) || !existsSync(cwd)) return writeJson(response, 400, { error: "cwd must be an existing absolute path" });
      const task = await runtime.start(prompt, cwd, actionId(request, body));
      writeJson(response, 202, { task });
      return;
    }

    if (request.method === "POST" && request.url === "/api/tasks/approval") {
      const body = await readJson(request);
      const requestId = body.requestId;
      const action = body.action;
      if (typeof requestId !== "string" && typeof requestId !== "number") {
        return writeJson(response, 400, { error: "requestId is required" });
      }
      if (action === "grantPermissions" && isPermissionGrant(body.permissions)) {
        const task = await runtime.respondToPermissions(requestId, body.permissions, actionId(request, body));
        writeJson(response, 200, { task });
        return;
      }
      if (action === "answerUserInput" && isUserInputAnswers(body.answers)) {
        const task = await runtime.respondToUserInput(requestId, body.answers, actionId(request, body));
        writeJson(response, 200, { task });
        return;
      }
      if (action === "mcpElicitation" && isMcpElicitationResponse(body.mcp)) {
        const task = await runtime.respondToElicitation(requestId, body.mcp.action, body.mcp.content, actionId(request, body));
        writeJson(response, 200, { task });
        return;
      }
      if (!isApprovalAction(action)) {
        return writeJson(response, 400, { error: "requestId and a supported approval action are required" });
      }
      const task = await runtime.respondToApproval(requestId, action, actionId(request, body));
      writeJson(response, 200, { task });
      return;
    }

    if (request.method === "POST" && request.url === "/api/tasks/steer") {
      const body = await readJson(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return writeJson(response, 400, { error: "text is required" });
      const task = await runtime.steer(text, actionId(request, body));
      writeJson(response, 200, { task });
      return;
    }

    if (request.method === "POST" && request.url === "/api/tasks/interrupt") {
      const task = await runtime.interrupt(actionId(request, {}));
      writeJson(response, 200, { task });
      return;
    }

    if (request.method === "POST" && request.url === "/api/tasks/follow-up") {
      const body = await readJson(request);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return writeJson(response, 400, { error: "prompt is required" });
      const task = await runtime.followUp(prompt, actionId(request, body));
      writeJson(response, 202, { task });
      return;
    }

    writeJson(response, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    writeJson(response, 500, { error: message });
  }
});

void runtime.reconcile();

server.on("close", () => runtime.close());
server.listen(port, host, () => {
  console.log(`Agent UI backend listening at http://${host}:${port} (summary provider: ${summaryEnabled ? "enabled" : "disabled"})`);
});

function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 64 * 1024) throw new Error("request body is too large");
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function actionId(request: IncomingMessage, body: Record<string, unknown>): string | undefined {
  const bodyId = body.actionId;
  if (typeof bodyId === "string" && bodyId.trim()) return bodyId.trim();
  const headerId = request.headers["idempotency-key"];
  return typeof headerId === "string" && headerId.trim() ? headerId.trim() : undefined;
}

function isPermissionGrant(value: unknown): value is { network: boolean; readPaths: string[]; writePaths: string[]; scope: "turn" | "session" } {
  if (!value || typeof value !== "object") return false;
  const grant = value as Record<string, unknown>;
  return typeof grant.network === "boolean"
    && Array.isArray(grant.readPaths) && grant.readPaths.every((path) => typeof path === "string")
    && Array.isArray(grant.writePaths) && grant.writePaths.every((path) => typeof path === "string")
    && (grant.scope === "turn" || grant.scope === "session");
}

function isUserInputAnswers(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>)
    .every((answers) => Array.isArray(answers) && answers.every((answer) => typeof answer === "string"));
}

function isMcpElicitationResponse(value: unknown): value is { action: "accept" | "decline" | "cancel"; content: Record<string, string | number | boolean> | null } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (response.action !== "accept" && response.action !== "decline" && response.action !== "cancel") return false;
  return response.content === null || (typeof response.content === "object" && !Array.isArray(response.content));
}
