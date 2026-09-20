import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerNotification } from "../../../protocol/ServerNotification";
import type { ServerRequest } from "../../../protocol/ServerRequest";
import type { CommandExecutionRequestApprovalResponse } from "../../../protocol/v2/CommandExecutionRequestApprovalResponse";
import type { CommandExecutionApprovalDecision } from "../../../protocol/v2/CommandExecutionApprovalDecision";
import type { FileChangeRequestApprovalResponse } from "../../../protocol/v2/FileChangeRequestApprovalResponse";
import type { FileChangeApprovalDecision } from "../../../protocol/v2/FileChangeApprovalDecision";
import type { ApplyPatchApprovalResponse } from "../../../protocol/ApplyPatchApprovalResponse";
import type { ExecCommandApprovalResponse } from "../../../protocol/ExecCommandApprovalResponse";
import type { ReviewDecision } from "../../../protocol/ReviewDecision";
import type { PermissionsRequestApprovalResponse } from "../../../protocol/v2/PermissionsRequestApprovalResponse";
import type { ToolRequestUserInputResponse } from "../../../protocol/v2/ToolRequestUserInputResponse";
import type { McpServerElicitationRequestResponse } from "../../../protocol/v2/McpServerElicitationRequestResponse";
import type { McpServerElicitationAction } from "../../../protocol/v2/McpServerElicitationAction";
import type { JsonValue } from "../../../protocol/serde_json/JsonValue";
import type { GrantedPermissionProfile } from "../../../protocol/v2/GrantedPermissionProfile";
import type { PermissionGrantScope } from "../../../protocol/v2/PermissionGrantScope";
import type { RequestId } from "../../../protocol/RequestId";
import type { ApprovalAction, ApprovalRequest, McpElicitationView, PermissionRequestView, TaskStatus, TaskView, UserInputQuestionView } from "../../../shared/src/taskView";
import { CodexAppServerClient } from "../app-server/client";
import { normalizeProtocolMessage, type NormalizedEvent, type ProtocolMessage } from "../events/normalizer";
import { TaskStore, type StoredAction } from "../persistence/store";
import { SummaryWorker, type SummaryResult, type SummaryRunner } from "../summaries/worker";

type RuntimeListener = (view: TaskView, event?: NormalizedEvent) => void;

type TaskRuntimeOptions = {
  executable?: string;
  args?: string[];
  store?: TaskStore;
  summaryRunner?: SummaryRunner;
  summaryDebounceMs?: number;
  summaryMaxWaitMs?: number;
  summaryDiagnostics?: (message: string) => void;
};

export class TaskRuntime {
  private readonly listeners = new Set<RuntimeListener>();
  private readonly client: CodexAppServerClient;
  private readonly store: TaskStore | undefined;
  private readonly summaryWorker: SummaryWorker | undefined;
  private readonly events: NormalizedEvent[] = [];
  private readonly agentMessages = new Map<string, string>();
  private sequence = 0;
  private activeThreadId: string | undefined;
  private activeTurnId: string | undefined;
  private pendingApproval: ApprovalRequest | undefined;
  private starting = false;
  private reconciling = false;
  private closed = false;
  private readonly actions = new Map<string, StoredAction>();
  private view: TaskView | undefined;

  public constructor(options: TaskRuntimeOptions = {}) {
    this.store = options.store;
    const restored = this.store?.loadLatest();
    this.view = restored?.view;
    this.activeThreadId = restored?.threadId;
    this.activeTurnId = restored?.activeTurnId;
    this.sequence = restored?.sequence ?? 0;
    if (options.summaryRunner) {
      this.summaryWorker = new SummaryWorker({
        run: options.summaryRunner,
        debounceMs: options.summaryDebounceMs,
        maxWaitMs: options.summaryMaxWaitMs,
        onFinding: (_taskId, result) => this.applySummaryFinding(result),
        onFailure: (_taskId, error) => console.error(`[summary] ${error instanceof Error ? error.message : "summary failed"}`),
        onResult: (_taskId, result, accepted, reason) => options.summaryDiagnostics?.(`${result.kind}:${accepted ? "accepted" : reason ?? "rejected"}:${result.throughSequence}`),
      });
    }
    this.client = new CodexAppServerClient({
      executable: options.executable,
      args: options.args,
      onNotification: (message) => this.handleMessage(message),
      onServerRequest: (message) => this.handleMessage(message),
      onStderr: (line) => console.error(`[codex] ${line}`),
      onExit: () => {
        if (!this.closed && this.view?.status === "running") {
          this.updateView({ status: "disconnected", statusLabel: "Disconnected", currentActivity: "Codex app-server disconnected" });
        }
      },
    });
  }

  public getView(): TaskView | undefined {
    return this.view;
  }

  public getEvents(): readonly NormalizedEvent[] {
    return this.events;
  }

  public getSequence(): number {
    return this.sequence;
  }

  public replayAfter(sequence: number): NormalizedEvent[] {
    if (!this.view) return [];
    if (this.store) return this.store.listEventsAfter(this.view.taskId, sequence);
    return this.events.filter((event) => event.sequence > sequence);
  }

  public subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async start(prompt: string, cwd: string, actionId = randomUUID() as string): Promise<TaskView> {
    const existing = this.beginAction(actionId, "start");
    if (existing?.state === "completed" && this.view) return this.view;
    if (this.starting || this.reconciling || (this.view && ["waiting", "running", "stopping", "disconnected"].includes(this.view.status))) {
      this.failAction(actionId, "A task is already active");
      throw new Error("A task is already active");
    }

    this.starting = true;
    this.events.length = 0;
    this.agentMessages.clear();
    this.sequence = 0;
    this.activeThreadId = undefined;
    this.activeTurnId = undefined;
    this.pendingApproval = undefined;
    this.view = createInitialView(prompt, cwd);
    this.attachActionTask(actionId, this.view.taskId);
    this.emit();

    try {
      await this.client.initialize();
      const thread = await this.client.startThread(cwd);
      this.activeThreadId = thread.thread.id;
      this.updateView({ currentActivity: "Starting the first turn" });
      const turn = await this.client.startTurn(this.activeThreadId, prompt);
      if (this.view.status === "waiting" || this.view.status === "running") {
        this.activeTurnId = turn.turn.id;
        this.updateView({ status: "running", statusLabel: "Working", currentActivity: "Waiting for the first update" });
      }
      this.completeAction(actionId, this.view);
      return this.view;
    } catch (error) {
      this.updateView({
        status: "failed",
        statusLabel: "Failed",
        currentActivity: error instanceof Error ? error.message : "Unable to start the task",
      });
      this.failAction(actionId, error instanceof Error ? error.message : "Unable to start the task");
      throw error;
    } finally {
      this.starting = false;
    }
  }

  public close(): void {
    this.closed = true;
    if (this.view) this.summaryWorker?.stop(this.view.taskId);
    this.client.close();
    this.store?.close();
  }

  public async reconcile(): Promise<TaskView | undefined> {
    if (!this.view || this.view.status !== "disconnected" || !this.activeThreadId || !this.view.cwd) return this.view;
    if (this.reconciling) return this.view;

    this.reconciling = true;
    this.updateView({ currentActivity: "Reconnecting to the saved Codex thread" });
    try {
      await this.client.initialize();
      const resumed = await this.client.resumeThread(this.activeThreadId, this.view.cwd);
      if (resumed.thread.status.type === "active" && this.activeTurnId) {
        this.updateView({
          status: "running",
          statusLabel: "Working",
          currentActivity: "Reconnected to the active Codex turn",
        });
      } else {
        this.updateView({ currentActivity: "Saved Codex thread reconnected; no active turn was confirmed" });
      }
      return this.view;
    } catch (error) {
      this.updateView({ currentActivity: error instanceof Error ? `Reconnection failed: ${error.message}` : "Reconnection failed" });
      return this.view;
    } finally {
      this.reconciling = false;
    }
  }

  public async followUp(prompt: string, actionId = randomUUID() as string): Promise<TaskView> {
    const text = prompt.trim();
    if (!text) throw new Error("Follow-up prompt cannot be empty");
    const existing = this.beginAction(actionId, "follow-up");
    if (existing?.state === "completed" && this.view) return this.view;
    if (!this.view || !this.activeThreadId || ["running", "waiting", "stopping"].includes(this.view.status)) {
      this.failAction(actionId, "The saved conversation is not ready for a follow-up turn");
      throw new Error("The saved conversation is not ready for a follow-up turn");
    }

    try {
      await this.client.initialize();
      if (this.view.status === "disconnected") {
        if (!this.view.cwd) throw new Error("The saved task has no working directory");
        await this.client.resumeThread(this.activeThreadId, this.view.cwd);
      }

      const previous = this.view.currentFinding;
      this.updateView({
        status: "waiting",
        statusLabel: "Starting follow-up",
        currentActivity: "Starting a follow-up turn in the same thread",
        currentFinding: {
          ...previous,
          id: `finding-follow-up-${Date.now()}`,
          label: "Follow-up requested",
          time: clockTime(),
          headline: "A follow-up turn is starting in the same conversation.",
          explanation: text,
          tentative: true,
          sourceEventIds: [],
        },
        history: [previous, ...this.view.history],
      });

      const turn = await this.client.startTurn(this.activeThreadId, text);
      this.activeTurnId = turn.turn.id;
      if (this.view.status === "waiting" || this.view.status === "running") {
        this.updateView({ status: "running", statusLabel: "Working", currentActivity: "Waiting for the follow-up update" });
      }
      this.completeAction(actionId, this.view);
      return this.view;
    } catch (error) {
      this.updateView({ status: "failed", statusLabel: "Failed", currentActivity: error instanceof Error ? error.message : "Follow-up failed" });
      this.failAction(actionId, error instanceof Error ? error.message : "Follow-up failed");
      throw error;
    }
  }

  public async respondToApproval(requestId: string | number, action: ApprovalAction, actionId = randomUUID() as string): Promise<TaskView> {
    const existing = this.beginAction(actionId, "approval");
    if (existing?.state === "completed" && this.view) return this.view;
    const approval = this.pendingApproval;
    if (!approval || approval.availableActions.length === 0) {
      this.failAction(actionId, "This approval request does not have an available response in this phase");
      throw new Error("This approval request does not have an available response in this phase");
    }
    if (approval.requestId !== requestId) {
      this.failAction(actionId, "That approval request is no longer active");
      throw new Error("That approval request is no longer active");
    }
    if (!approval.availableActions.includes(action)) {
      this.failAction(actionId, "That approval response is not available for this request");
      throw new Error("That approval response is not available for this request");
    }

    const sending = { ...approval, state: "sending" as const, error: undefined };
    this.updateView({ approval: sending, currentActivity: "Sending the approval decision" });
    try {
      this.client.respond(approval.requestId, approvalResult(approval.method, action));
      this.pendingApproval = undefined;
      const resolved = { ...sending, state: "resolved" as const };
      this.updateView({ approval: resolved, currentActivity: "Approval decision received by Codex" });
      this.completeAction(actionId, this.view);
      return this.view!;
    } catch (error) {
      const failed = {
        ...sending,
        state: "failed" as const,
        error: error instanceof Error ? error.message : "Approval response failed",
      };
      this.updateView({ approval: failed, currentActivity: "Approval response failed" });
      this.failAction(actionId, error instanceof Error ? error.message : "Approval response failed");
      throw error;
    }
  }

  public async respondToPermissions(
    requestId: string | number,
    grant: { network: boolean; readPaths: string[]; writePaths: string[]; scope: "turn" | "session" },
    actionId = randomUUID() as string,
  ): Promise<TaskView> {
    const existing = this.beginAction(actionId, "permission-approval");
    if (existing?.state === "completed" && this.view) return this.view;
    const approval = this.pendingApproval;
    if (!approval?.permissionRequest || approval.requestId !== requestId || approval.permissionRequest.hasUnsupportedEntries) {
      this.failAction(actionId, "This permission request cannot be answered by the current form");
      throw new Error("This permission request cannot be answered by the current form");
    }

    const permissions: GrantedPermissionProfile = {};
    if (approval.permissionRequest.networkRequested) permissions.network = { enabled: grant.network };
    if (approval.permissionRequest.readPaths.length > 0 || approval.permissionRequest.writePaths.length > 0) {
      permissions.fileSystem = {
        read: grant.readPaths,
        write: grant.writePaths,
      };
    }
    const response: PermissionsRequestApprovalResponse = {
      permissions,
      scope: grant.scope as PermissionGrantScope,
    };
    this.updateView({ approval: { ...approval, state: "sending" }, currentActivity: "Sending the permission decision" });
    try {
      this.client.respond(approval.requestId, response);
      this.pendingApproval = undefined;
      this.updateView({ approval: { ...approval, state: "resolved" }, currentActivity: "Permission decision received by Codex" });
      this.completeAction(actionId, this.view);
      return this.view!;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Permission response failed";
      this.updateView({ approval: { ...approval, state: "failed", error: message }, currentActivity: "Permission response failed" });
      this.failAction(actionId, message);
      throw error;
    }
  }

  public async steer(text: string, actionId = randomUUID() as string): Promise<TaskView> {
    const direction = text.trim();
    if (!direction) throw new Error("Direction cannot be empty");
    const existing = this.beginAction(actionId, "steer");
    if (existing?.state === "completed" && this.view) return this.view;

    if (!this.view || this.view.status !== "running" || !this.activeThreadId || !this.activeTurnId) {
      const queued: TaskView["direction"] = {
        text: direction,
        state: "queuedForFollowUp",
        detail: "The turn ended before delivery. Send this direction explicitly as a follow-up turn.",
      };
      this.updateView({ direction: queued, currentActivity: "Direction retained for a follow-up turn" });
      this.completeAction(actionId, this.view);
      return this.view!;
    }

    this.updateView({
      direction: {
        text: direction,
        state: "sending",
        detail: "Sending direction to the active turn…",
      },
      currentActivity: "Sending direction to Codex",
    });

    try {
      await this.client.steer(this.activeThreadId, this.activeTurnId, direction);
      this.updateView({
        direction: {
          text: direction,
          state: "received",
          detail: "Direction received. Waiting for later agent output to confirm adoption.",
        },
        currentActivity: "Direction received",
      });
      this.completeAction(actionId, this.view);
      return this.view!;
    } catch (error) {
      this.updateView({
        direction: {
          text: direction,
          state: "deliveryFailed",
          detail: error instanceof Error ? error.message : "Direction delivery failed",
        },
        currentActivity: "Direction delivery failed",
      });
      this.failAction(actionId, error instanceof Error ? error.message : "Direction delivery failed");
      throw error;
    }
  }

  public async interrupt(actionId = randomUUID() as string): Promise<TaskView> {
    const existing = this.beginAction(actionId, "interrupt");
    if (existing?.state === "completed" && this.view) return this.view;
    if (!this.view || this.view.status !== "running" || !this.activeThreadId || !this.activeTurnId) {
      this.failAction(actionId, "There is no active turn to stop");
      throw new Error("There is no active turn to stop");
    }

    const threadId = this.activeThreadId;
    const turnId = this.activeTurnId;
    this.updateView({ status: "stopping", statusLabel: "Stopping", currentActivity: "Stop requested" });

    try {
      await this.client.interrupt(threadId, turnId);
      this.completeAction(actionId, this.view);
      return this.view;
    } catch (error) {
      this.updateView({
        status: "running",
        statusLabel: "Working",
        currentActivity: error instanceof Error ? `Stop request failed: ${error.message}` : "Stop request failed",
      });
      this.failAction(actionId, error instanceof Error ? error.message : "Stop request failed");
      throw error;
    }
  }

  public async respondToUserInput(
    requestId: string | number,
    answers: Record<string, string[]>,
    actionId = randomUUID() as string,
  ): Promise<TaskView> {
    const existing = this.beginAction(actionId, "user-input");
    if (existing?.state === "completed" && this.view) return this.view;
    const approval = this.pendingApproval;
    if (!approval?.userInputRequest || approval.requestId !== requestId) {
      this.failAction(actionId, "This user-input request is no longer active");
      throw new Error("This user-input request is no longer active");
    }
    const response: ToolRequestUserInputResponse = {
      answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }])),
    };
    this.updateView({ approval: { ...approval, state: "sending" }, currentActivity: "Sending answers to Codex" });
    try {
      this.client.respond(approval.requestId, response);
      this.pendingApproval = undefined;
      this.updateView({ approval: { ...approval, state: "resolved" }, currentActivity: "Answers received by Codex" });
      this.completeAction(actionId, this.view);
      return this.view!;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Answer delivery failed";
      this.updateView({ approval: { ...approval, state: "failed", error: message }, currentActivity: "Answer delivery failed" });
      this.failAction(actionId, message);
      throw error;
    }
  }

  public async respondToElicitation(
    requestId: string | number,
    action: McpServerElicitationAction,
    content: Record<string, string | number | boolean> | null,
    actionId = randomUUID() as string,
  ): Promise<TaskView> {
    const existing = this.beginAction(actionId, "mcp-elicitation");
    if (existing?.state === "completed" && this.view) return this.view;
    const approval = this.pendingApproval;
    if (!approval?.mcpElicitation || approval.requestId !== requestId) {
      this.failAction(actionId, "This MCP elicitation request is no longer active");
      throw new Error("This MCP elicitation request is no longer active");
    }
    if (action === "accept" && !approval.mcpElicitation.formSupported && approval.mcpElicitation.mode === "form") {
      this.failAction(actionId, "This MCP form schema is not supported by the current form");
      throw new Error("This MCP form schema is not supported by the current form");
    }
    const response: McpServerElicitationRequestResponse = {
      action,
      content: action === "accept" ? content as JsonValue : null,
      _meta: null,
    };
    this.updateView({ approval: { ...approval, state: "sending" }, currentActivity: "Sending MCP elicitation response" });
    try {
      this.client.respond(approval.requestId, response);
      this.pendingApproval = undefined;
      this.updateView({ approval: { ...approval, state: "resolved" }, currentActivity: "MCP response received by Codex" });
      this.completeAction(actionId, this.view);
      return this.view!;
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP response failed";
      this.updateView({ approval: { ...approval, state: "failed", error: message }, currentActivity: "MCP response failed" });
      this.failAction(actionId, message);
      throw error;
    }
  }

  private beginAction(actionId: string, kind: string): StoredAction | undefined {
    const existing = this.actions.get(actionId) ?? this.store?.getAction(actionId);
    if (existing) {
      this.actions.set(actionId, existing);
      if (existing.state === "completed") return existing;
      throw new Error(`Action ${actionId} is already ${existing.state}; it will not be retried automatically`);
    }
    const action = this.store?.beginAction(actionId, kind) ?? { actionId, kind, state: "pending" as const };
    this.actions.set(actionId, action);
    return undefined;
  }

  private attachActionTask(actionId: string, taskId: string): void {
    const action = this.actions.get(actionId);
    if (action) this.actions.set(actionId, { ...action, taskId });
    this.store?.attachActionTask(actionId, taskId);
  }

  private completeAction(actionId: string, response: unknown): void {
    const action = this.actions.get(actionId);
    if (action) this.actions.set(actionId, { ...action, state: "completed", responseJson: JSON.stringify(response) });
    this.store?.completeAction(actionId, response);
  }

  private failAction(actionId: string, response: unknown): void {
    const action = this.actions.get(actionId);
    if (action) this.actions.set(actionId, { ...action, state: "failed", responseJson: JSON.stringify(response) });
    this.store?.failAction(actionId, response);
  }

  private handleMessage(message: ProtocolMessage): void {
    const event = normalizeProtocolMessage(message, ++this.sequence);
    this.events.push(event);

    if (!this.view) return;

    if (isApprovalRequest(message)) {
      const approval = approvalFromRequest(message);
      if (approval) {
        this.pendingApproval = approval;
        this.updateView({ approval, currentActivity: "Waiting for approval or input" }, event);
      }
      return;
    }

    if (message.method === "turn/started") {
      this.activeThreadId = message.params.threadId;
      this.activeTurnId = message.params.turn.id;
      this.updateView({ status: "running", statusLabel: "Working", currentActivity: event.activity }, event);
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const text = `${this.agentMessages.get(message.params.itemId) ?? ""}${message.params.delta}`;
      this.agentMessages.set(message.params.itemId, text);
      this.updateAgentFinding(message.params.itemId, text, event);
      return;
    }

    if (message.method === "turn/completed") {
      const status = taskStatusForTurn(message.params.turn.status);
      this.activeTurnId = undefined;
      this.updateView({ status, statusLabel: statusLabel(status), currentActivity: event.activity }, event);
      this.enqueueSummary();
      return;
    }

    if (message.method === "item/completed") this.enqueueSummary();

    this.updateView({ currentActivity: event.activity }, event);
  }

  private updateAgentFinding(itemId: string, text: string, event: NormalizedEvent): void {
    if (!this.view) return;
    const headline = compactText(text) || "The agent is preparing its first update.";
    const previous = this.view.currentFinding;
    const nextFinding = {
      ...previous,
      id: `finding-${itemId}`,
      label: "Working understanding",
      time: clockTime(),
      headline,
      explanation: text || "The agent has started a message but has not reported a conclusion yet.",
      tentative: true,
      sourceEventIds: [...new Set([...previous.sourceEventIds, event.id])],
    };

    const history = previous.id === nextFinding.id || previous.headline.startsWith("Waiting for")
      ? this.view.history
      : [previous, ...this.view.history];
    this.updateView({
      currentFinding: nextFinding,
      history,
      currentActivity: event.activity,
      direction: this.directionAfterEvidence(this.view.direction, text),
    }, event);
    this.enqueueSummary();
  }

  private enqueueSummary(): void {
    if (!this.summaryWorker || !this.view) return;
    this.summaryWorker.enqueue({
      taskId: this.view.taskId,
      throughSequence: this.sequence,
      commentary: [...this.agentMessages.values()],
      completedEvents: this.events
        .filter((event) => event.method === "item/completed" || event.method === "turn/completed")
        .slice(-50)
        .map(({ id, method, activity, itemId, agentDelta }) => ({ id, method, activity, itemId, agentDelta })),
      previousFinding: this.view.currentFinding,
    });
  }

  private applySummaryFinding(result: Extract<SummaryResult, { kind: "finding" }>): void {
    if (this.closed || !this.view || result.throughSequence < this.sequence) return;
    const previous = this.view.currentFinding;
    const finding = {
      ...previous,
      id: `finding-summary-${result.throughSequence}`,
      label: "Background summary",
      time: clockTime(),
      headline: result.headline,
      explanation: result.explanation,
      sourceEventIds: result.sourceEventIds,
      throughSequence: result.throughSequence,
      replacesFindingId: result.replacesFindingId ?? previous.id,
      origin: "background-summary" as const,
      tentative: result.tentative,
    };
    this.updateView({ currentFinding: finding, history: [previous, ...this.view.history] });
  }

  private directionAfterEvidence(direction: TaskView["direction"], commentary: string): TaskView["direction"] {
    if (!direction || !["received", "adoptionPending"].includes(direction.state)) return direction;

    const normalized = commentary.toLowerCase();
    if (/\?\s*$|\bshould i\b|\bdo you want\b|\bwhich approach\b/.test(normalized)) {
      return {
        ...direction,
        state: "agentAskedQuestion",
        detail: "The agent asked a question instead of confirming adoption.",
      };
    }
    if (/\bi disagree\b|\bi cannot\b|\bi can't\b|\bwon't\b|\bnot follow\b/.test(normalized)) {
      return {
        ...direction,
        state: "agentDisagreed",
        detail: "The agent did not adopt the direction.",
      };
    }

    const directionWords = meaningfulWords(direction.text);
    const commentaryWords = new Set(meaningfulWords(commentary));
    const overlap = directionWords.filter((word) => commentaryWords.has(word));
    const hasApproachCue = /\b(use|using|follow|adopt|adopting|match|matching|switch|incorporat|implement|reuse|reusing)\b/.test(normalized);
    if (hasApproachCue && (overlap.length >= 2 || directionWords.some((word) => word.length >= 8 && commentaryWords.has(word)))) {
      return {
        ...direction,
        state: "adopted",
        detail: "Later agent commentary confirmed the changed approach.",
      };
    }

    return {
      ...direction,
      state: "adoptionPending",
      detail: "The agent responded, but adoption of this direction is not confirmed yet.",
    };
  }

  private updateView(patch: Partial<TaskView>, event?: NormalizedEvent): void {
    if (!this.view) return;
    this.view = { ...this.view, ...patch };
    this.emit(event);
  }

  private emit(event?: NormalizedEvent): void {
    if (!this.view) return;
    if (this.store) {
      try {
        this.store.persist({
          view: this.view,
          event,
          threadId: this.activeThreadId,
          turnId: this.activeTurnId,
        });
      } catch (error) {
        console.error(`[persistence] ${error instanceof Error ? error.message : "unable to save task state"}`);
      }
    }
    for (const listener of this.listeners) listener(this.view, event);
  }
}

function isApprovalRequest(message: ProtocolMessage): message is ServerRequest {
  return "id" in message && (
    message.method.includes("requestApproval") ||
    message.method === "applyPatchApproval" ||
    message.method === "execCommandApproval" ||
    message.method === "item/tool/requestUserInput" ||
    message.method === "mcpServer/elicitation/request"
  );
}

function approvalFromRequest(message: ServerRequest): ApprovalRequest | undefined {
  if (message.method === "item/commandExecution/requestApproval") {
    const params = message.params;
    const availableActions = (params.availableDecisions ?? []).filter(isApprovalAction);
    return {
      requestId: message.id,
      method: message.method,
      title: "Codex requests command approval",
      detail: params.reason ?? "Codex wants to run a command in the task workspace.",
      command: params.command ?? undefined,
      cwd: params.cwd ?? undefined,
      availableActions,
      state: availableActions.length > 0 ? "pending" : "unsupported",
    };
  }

  if (message.method === "item/fileChange/requestApproval") {
    const params = message.params;
    return {
      requestId: message.id,
      method: message.method,
      title: "Codex requests file-change approval",
      detail: params.reason ?? "Codex wants to apply file changes in the task workspace.",
      cwd: params.grantRoot ?? undefined,
      availableActions: ["accept", "acceptForSession", "decline", "cancel"],
      state: "pending",
    };
  }

  if (message.method === "applyPatchApproval" || message.method === "execCommandApproval") {
    return {
      requestId: message.id,
      method: message.method,
      title: message.method === "applyPatchApproval" ? "Codex requests patch approval" : "Codex requests command approval",
      detail: "This Codex approval uses the legacy response shape. The common approve/decline actions are available.",
      availableActions: ["accept", "acceptForSession", "decline", "cancel"],
      state: "pending",
    };
  }

  if (message.method === "item/permissions/requestApproval") {
    const permissionRequest = permissionRequestView(message.params.permissions);
    return {
      requestId: message.id,
      method: message.method,
      title: "Codex requests additional permissions",
      detail: message.params.reason ?? "Codex requested an additional permission profile.",
      cwd: message.params.cwd,
      availableActions: [],
      permissionRequest,
      state: permissionRequest.hasUnsupportedEntries ? "unsupported" : "pending",
    };
  }

  if (message.method === "item/tool/requestUserInput") {
    const userInputRequest = {
      questions: message.params.questions.map((question): UserInputQuestionView => ({
        id: question.id,
        header: question.header,
        question: question.question,
        isOther: question.isOther,
        isSecret: question.isSecret,
        options: question.options,
      })),
    };
    return {
      requestId: message.id,
      method: message.method,
      title: "Codex is asking for input",
      detail: `${message.params.questions.length} question(s) require an answer.`,
      availableActions: [],
      userInputRequest,
      state: "pending",
    };
  }

  if (message.method === "mcpServer/elicitation/request") {
    const mcpElicitation = mcpElicitationView(message.params);
    return {
      requestId: message.id,
      method: message.method,
      title: `Input requested by ${message.params.serverName}`,
      detail: message.params.mode === "url" ? message.params.message : message.params.mode === "openai/userVerification" ? message.params.description : "MCP requested structured input.",
      availableActions: [],
      mcpElicitation,
      state: mcpElicitation.formSupported || message.params.mode !== "form" ? "pending" : "unsupported",
    };
  }

  return undefined;
}

function permissionRequestView(profile: {
  network: { enabled: boolean | null } | null;
  fileSystem: { read: string[] | null; write: string[] | null; entries?: unknown[] } | null;
}): PermissionRequestView {
  return {
    networkRequested: profile.network?.enabled === true,
    readPaths: profile.fileSystem?.read ?? [],
    writePaths: profile.fileSystem?.write ?? [],
    hasUnsupportedEntries: Boolean(profile.fileSystem?.entries && profile.fileSystem.entries.length > 0),
  };
}

function mcpElicitationView(params: Extract<ServerRequest, { method: "mcpServer/elicitation/request" }>['params']): McpElicitationView {
  if (params.mode === "openai/userVerification") {
    return { mode: params.mode, serverName: params.serverName, title: params.title, challenge: params.challenge, fields: [], formSupported: true };
  }
  if (params.mode === "url") {
    return { mode: params.mode, serverName: params.serverName, message: params.message, url: params.url, fields: [], formSupported: true };
  }
  const schema = params.requestedSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { mode: params.mode, serverName: params.serverName, message: params.message, fields: [], formSupported: false };
  }
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return { mode: params.mode, serverName: params.serverName, message: params.message, fields: [], formSupported: false };
  }
  const required = new Set(Array.isArray(record.required) ? record.required.filter((key): key is string => typeof key === "string") : []);
  const fields = Object.entries(properties as Record<string, unknown>).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const definition = value as Record<string, unknown>;
    if (definition.type !== "string" && definition.type !== "number" && definition.type !== "boolean") return [];
    return [{ key, label: typeof definition.title === "string" ? definition.title : key, type: definition.type as "string" | "number" | "boolean", required: required.has(key) }];
  });
  return { mode: params.mode, serverName: params.serverName, message: params.message, fields, formSupported: fields.length === Object.keys(properties).length };
}

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
}

function approvalResult(method: string, action: ApprovalAction): unknown {
  if (method === "item/commandExecution/requestApproval") {
    const decision: CommandExecutionApprovalDecision = action;
    const response: CommandExecutionRequestApprovalResponse = { decision };
    return response;
  }

  if (method === "item/fileChange/requestApproval") {
    const decision: FileChangeApprovalDecision = action;
    const response: FileChangeRequestApprovalResponse = { decision };
    return response;
  }

  const decision: ReviewDecision = action === "accept"
    ? "approved"
    : action === "acceptForSession"
      ? "approved_for_session"
      : action === "cancel"
        ? "abort"
        : { denied: { rejection: "The user declined the request." } };

  if (method === "applyPatchApproval") {
    const response: ApplyPatchApprovalResponse = { decision };
    return response;
  }
  if (method === "execCommandApproval") {
    const response: ExecCommandApprovalResponse = { decision };
    return response;
  }

  throw new Error(`No approval response mapping exists for ${method}`);
}

function createInitialView(prompt: string, cwd: string): TaskView {
  return {
    taskId: `live-${Date.now()}`,
    title: "Live Codex task",
    repository: basename(cwd),
    cwd,
    branch: "local working tree",
    request: prompt,
    status: "waiting",
    statusLabel: "Starting",
    currentActivity: "Starting Codex app-server…",
    currentFinding: {
      id: "finding-waiting",
      label: "Waiting",
      time: clockTime(),
      headline: "Codex is preparing the task.",
      explanation: "The first confirmed understanding will appear after the agent reports it.",
      tone: "neutral",
      tentative: true,
      sourceEventIds: [],
      supportingSteps: [],
      commands: [],
    },
    history: [],
    fixtureLabel: "Live Codex task",
  };
}

function taskStatusForTurn(status: "completed" | "interrupted" | "failed" | "inProgress"): TaskStatus {
  if (status === "completed") return "completed";
  if (status === "interrupted") return "stopped";
  if (status === "failed") return "failed";
  return "running";
}

function statusLabel(status: TaskStatus): string {
  if (status === "completed") return "Complete";
  if (status === "stopped") return "Stopped";
  if (status === "failed") return "Failed";
  if (status === "disconnected") return "Disconnected";
  return "Working";
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

function meaningfulWords(text: string): string[] {
  const ignored = new Set(["the", "and", "for", "with", "that", "this", "use", "using", "will", "only", "when"]);
  return [...new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])]
    .filter((word) => !ignored.has(word));
}

function clockTime(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
