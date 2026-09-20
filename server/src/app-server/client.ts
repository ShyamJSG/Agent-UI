import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { ClientNotification } from "../../../protocol/ClientNotification";
import type { ClientRequest } from "../../../protocol/ClientRequest";
import type { InitializeResponse } from "../../../protocol/InitializeResponse";
import type { ServerNotification } from "../../../protocol/ServerNotification";
import type { ServerRequest } from "../../../protocol/ServerRequest";
import type { RequestId } from "../../../protocol/RequestId";
import type { ThreadStartResponse } from "../../../protocol/v2/ThreadStartResponse";
import type { ThreadResumeResponse } from "../../../protocol/v2/ThreadResumeResponse";
import type { AskForApproval } from "../../../protocol/v2/AskForApproval";
import type { TurnStartResponse } from "../../../protocol/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../../../protocol/v2/TurnSteerResponse";
import type { TurnInterruptResponse } from "../../../protocol/v2/TurnInterruptResponse";

const COMMENTARY_INSTRUCTION =
  "Briefly state consequential findings and changes of approach. Separate assumptions from confirmed findings. Avoid narrating routine commands.";

type JsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type JsonRpcResponse = {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
};

type AppServerClientOptions = {
  executable?: string;
  args?: string[];
  onNotification: (message: ServerNotification) => void;
  onServerRequest: (message: ServerRequest) => void;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class CodexAppServerClient {
  private readonly executable: string;
  private readonly args: string[];
  private readonly onNotification: AppServerClientOptions["onNotification"];
  private readonly onServerRequest: AppServerClientOptions["onServerRequest"];
  private readonly onStderr: (line: string) => void;
  private readonly onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  private process: ChildProcessWithoutNullStreams | undefined;
  private stdoutReader: Interface | undefined;
  private initializedResponse: InitializeResponse | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();

  public constructor(options: AppServerClientOptions) {
    this.executable = options.executable ?? "codex";
    this.args = options.args ?? ["app-server", "--stdio"];
    this.onNotification = options.onNotification;
    this.onServerRequest = options.onServerRequest;
    this.onStderr = options.onStderr ?? (() => undefined);
    this.onExit = options.onExit ?? (() => undefined);
  }

  public async initialize(): Promise<InitializeResponse> {
    if (this.initializedResponse) return this.initializedResponse;
    this.startProcess();

    const response = await this.request<InitializeResponse>({
      method: "initialize",
      id: this.allocateRequestId(),
      params: {
        clientInfo: {
          name: "agentui",
          title: "Agent UI",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    });

    this.notify({ method: "initialized" });
    this.initializedResponse = response;
    return response;
  }

  public async startThread(cwd: string, developerInstructions = COMMENTARY_INSTRUCTION, approvalPolicy?: AskForApproval): Promise<ThreadStartResponse> {
    return this.request<ThreadStartResponse>({
      method: "thread/start",
      id: this.allocateRequestId(),
      params: {
        cwd,
        ephemeral: false,
        developerInstructions,
        approvalPolicy,
      },
    });
  }

  public async resumeThread(threadId: string, cwd?: string): Promise<ThreadResumeResponse> {
    return this.request<ThreadResumeResponse>({
      method: "thread/resume",
      id: this.allocateRequestId(),
      params: { threadId, cwd: cwd ?? null },
    });
  }

  public async startTurn(threadId: string, text: string): Promise<TurnStartResponse> {
    return this.request<TurnStartResponse>({
      method: "turn/start",
      id: this.allocateRequestId(),
      params: {
        threadId,
        input: [{ type: "text", text, text_elements: [] }],
      },
    });
  }

  public async steer(threadId: string, expectedTurnId: string, text: string): Promise<TurnSteerResponse> {
    return this.request<TurnSteerResponse>({
      method: "turn/steer",
      id: this.allocateRequestId(),
      params: {
        threadId,
        expectedTurnId,
        input: [{ type: "text", text, text_elements: [] }],
      },
    });
  }

  public async interrupt(threadId: string, turnId: string): Promise<TurnInterruptResponse> {
    return this.request<TurnInterruptResponse>({
      method: "turn/interrupt",
      id: this.allocateRequestId(),
      params: { threadId, turnId },
    });
  }

  public notify(message: ClientNotification): void {
    this.write(message);
  }

  public respond(requestId: RequestId, result: unknown): void {
    this.writeRaw({ id: requestId, result });
  }

  public close(): void {
    this.stdoutReader?.close();
    this.stdoutReader = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex app-server connection closed"));
    }
    this.pending.clear();
    this.process?.kill("SIGTERM");
    this.process = undefined;
    this.initializedResponse = undefined;
  }

  private startProcess(): void {
    if (this.process) return;

    const child = spawn(this.executable, this.args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.stdoutReader = createInterface({ input: child.stdout });
    this.stdoutReader.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.onStderr(text);
    });
    child.on("error", (error) => this.rejectPending(error));
    child.on("exit", (code, signal) => {
      this.process = undefined;
      this.initializedResponse = undefined;
      this.rejectPending(new Error(`Codex app-server exited: ${code ?? signal ?? "unknown"}`));
      this.onExit(code, signal);
    });
  }

  private request<TResponse>(message: ClientRequest): Promise<TResponse> {
    const id = message.id;
    return new Promise<TResponse>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.write(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: ClientRequest | ClientNotification): void {
    this.writeRaw(message);
  }

  private writeRaw(message: unknown): void {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error("Codex app-server is not running");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse | { method: string; id?: string | number; params?: unknown };
    try {
      message = JSON.parse(line) as JsonRpcResponse | { method: string; id?: string | number; params?: unknown };
    } catch {
      this.onStderr("Codex app-server emitted a non-JSON stdout line");
      return;
    }

    if ("id" in message && !("method" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!("method" in message)) return;
    if ("id" in message && message.id !== undefined) {
      this.onServerRequest(message as ServerRequest);
    } else {
      this.onNotification(message as ServerNotification);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private allocateRequestId(): number {
    return this.nextRequestId++;
  }
}

export { COMMENTARY_INSTRUCTION };
