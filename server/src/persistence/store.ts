import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TaskView } from "../../../shared/src/taskView";
import type { NormalizedEvent } from "../events/normalizer";

type PersistContext = {
  view: TaskView;
  event?: NormalizedEvent;
  threadId?: string;
  turnId?: string;
};

export type RestoredTask = {
  view: TaskView;
  threadId?: string;
  activeTurnId?: string;
  sequence: number;
};

export type StoredAction = {
  actionId: string;
  kind: string;
  state: "pending" | "completed" | "failed";
  taskId?: string;
  responseJson?: string;
};

export class TaskStore {
  private readonly database: DatabaseSync;

  public constructor(filename = ":memory:") {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.migrate();
  }

  public persist(context: PersistContext): void {
    const { view, event } = context;
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO tasks (
          id, title, repository, branch, request, status, status_label,
          current_activity, next_step, current_finding_json, history_json,
          direction_json, approval_json, completion_json, fixture_label,
          cwd, thread_id, active_turn_id, sequence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          repository = excluded.repository,
          branch = excluded.branch,
          request = excluded.request,
          status = excluded.status,
          status_label = excluded.status_label,
          current_activity = excluded.current_activity,
          next_step = excluded.next_step,
          current_finding_json = excluded.current_finding_json,
          history_json = excluded.history_json,
          direction_json = excluded.direction_json,
          approval_json = excluded.approval_json,
          completion_json = excluded.completion_json,
          fixture_label = excluded.fixture_label,
          cwd = excluded.cwd,
          thread_id = COALESCE(excluded.thread_id, tasks.thread_id),
          active_turn_id = excluded.active_turn_id,
          sequence = excluded.sequence,
          updated_at = excluded.updated_at
      `).run(
        view.taskId,
        view.title,
        view.repository,
        view.branch,
        view.request,
        view.status,
        view.statusLabel,
        view.currentActivity,
        view.nextStep ?? null,
        JSON.stringify(view.currentFinding),
        JSON.stringify(view.history),
        view.direction ? JSON.stringify(view.direction) : null,
        view.approval ? JSON.stringify(view.approval) : null,
        view.completion ? JSON.stringify(view.completion) : null,
        view.fixtureLabel,
        view.cwd ?? null,
        context.threadId ?? event?.threadId ?? null,
        context.turnId ?? event?.turnId ?? null,
        event?.sequence ?? 0,
        now,
        now,
      );

      if (event) this.persistEvent(view.taskId, event);
      this.persistFindings(view, now);
      if (view.direction) this.persistDirection(view, now);
      if (view.approval) this.persistApproval(view, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public getAction(actionId: string): StoredAction | undefined {
    const row = this.database.prepare(`
      SELECT action_id, kind, state, task_id, response_json FROM actions WHERE action_id = ?
    `).get(actionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      actionId: String(row.action_id),
      kind: String(row.kind),
      state: row.state as StoredAction["state"],
      taskId: row.task_id === null ? undefined : String(row.task_id),
      responseJson: row.response_json === null ? undefined : String(row.response_json),
    };
  }

  public beginAction(actionId: string, kind: string, taskId?: string): StoredAction {
    const existing = this.getAction(actionId);
    if (existing) return existing;
    this.database.prepare(`
      INSERT INTO actions(action_id, kind, state, task_id, response_json, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, NULL, ?, ?)
    `).run(actionId, kind, taskId ?? null, new Date().toISOString(), new Date().toISOString());
    return { actionId, kind, state: "pending", taskId };
  }

  public attachActionTask(actionId: string, taskId: string): void {
    this.database.prepare("UPDATE actions SET task_id = ?, updated_at = ? WHERE action_id = ?")
      .run(taskId, new Date().toISOString(), actionId);
  }

  public completeAction(actionId: string, response: unknown): void {
    this.database.prepare("UPDATE actions SET state = 'completed', response_json = ?, updated_at = ? WHERE action_id = ?")
      .run(JSON.stringify(response), new Date().toISOString(), actionId);
  }

  public failAction(actionId: string, response: unknown): void {
    this.database.prepare("UPDATE actions SET state = 'failed', response_json = ?, updated_at = ? WHERE action_id = ?")
      .run(JSON.stringify(response), new Date().toISOString(), actionId);
  }

  public loadLatestTask(): TaskView | undefined {
    return this.loadLatest()?.view;
  }

  public loadLatest(): RestoredTask | undefined {
    const row = this.database.prepare(`
      SELECT title, repository, branch, request, status, status_label,
        current_activity, next_step, current_finding_json, history_json,
        direction_json, approval_json, completion_json, fixture_label, cwd,
        id, thread_id, active_turn_id, sequence
      FROM tasks ORDER BY updated_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    if (!row) return undefined;

    const status = row.status as TaskView["status"];
    const restoredStatus = status === "running" || status === "stopping"
      ? "disconnected"
      : status;
    return {
      threadId: row.thread_id === null ? undefined : String(row.thread_id),
      activeTurnId: row.active_turn_id === null ? undefined : String(row.active_turn_id),
      sequence: Number(row.sequence ?? 0),
      view: {
      taskId: String(row.id),
      title: String(row.title),
      repository: String(row.repository),
      cwd: row.cwd === null ? undefined : String(row.cwd),
      branch: String(row.branch),
      request: String(row.request),
      status: restoredStatus,
      statusLabel: restoredStatus === "disconnected" ? "Disconnected" : String(row.status_label),
      currentActivity: restoredStatus === "disconnected"
        ? "Backend restarted; saved task state restored"
        : String(row.current_activity),
      nextStep: row.next_step === null ? undefined : String(row.next_step),
      currentFinding: JSON.parse(String(row.current_finding_json)),
      history: JSON.parse(String(row.history_json)),
      direction: row.direction_json === null ? undefined : JSON.parse(String(row.direction_json)),
      approval: row.approval_json === null ? undefined : JSON.parse(String(row.approval_json)),
      completion: row.completion_json === null ? undefined : JSON.parse(String(row.completion_json)),
      fixtureLabel: String(row.fixture_label),
      },
    };
  }

  public listEventsAfter(taskId: string, sequence: number): NormalizedEvent[] {
    const rows = this.database.prepare(`
      SELECT payload_json FROM events
      WHERE task_id = ? AND last_sequence > ?
      ORDER BY last_sequence ASC
    `).all(taskId, sequence) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as NormalizedEvent);
  }

  public countEvents(taskId: string): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM events WHERE task_id = ?").get(taskId) as { count: number };
    return Number(row.count);
  }

  public close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        request TEXT NOT NULL,
        status TEXT NOT NULL,
        status_label TEXT NOT NULL,
        current_activity TEXT NOT NULL,
        next_step TEXT,
        current_finding_json TEXT NOT NULL,
        history_json TEXT NOT NULL,
        direction_json TEXT,
        approval_json TEXT,
        completion_json TEXT,
        fixture_label TEXT NOT NULL,
        cwd TEXT,
        thread_id TEXT,
        active_turn_id TEXT,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (task_id, turn_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        logical_key TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        method TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        item_id TEXT,
        item_type TEXT,
        activity TEXT NOT NULL,
        agent_delta TEXT,
        source_event_ids_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE(task_id, logical_key)
      );

      CREATE INDEX IF NOT EXISTS events_task_sequence ON events(task_id, last_sequence);
      CREATE INDEX IF NOT EXISTS events_item ON events(task_id, item_id);

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        headline TEXT NOT NULL,
        explanation TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS directions (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        direction_id TEXT NOT NULL,
        text TEXT NOT NULL,
        state TEXT NOT NULL,
        detail TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(task_id, direction_id)
      );

      CREATE TABLE IF NOT EXISTS approvals (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        method TEXT NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(task_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS actions (
        action_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        task_id TEXT,
        response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, datetime('now'));
    `);

    const taskColumns = this.database.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!taskColumns.some((column) => column.name === "cwd")) this.database.exec("ALTER TABLE tasks ADD COLUMN cwd TEXT");
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))").run();
  }

  private persistEvent(taskId: string, event: NormalizedEvent): void {
    const persistedEventId = `${taskId}:${event.id}`;
    const logicalKey = event.itemId
      ? `item:${event.itemId}`
      : `${event.method}:${event.threadId ?? ""}:${event.turnId ?? ""}`;
    const existing = this.database.prepare(`
      SELECT id, source_event_ids_json FROM events WHERE task_id = ? AND logical_key = ?
    `).get(taskId, logicalKey) as { id: string; source_event_ids_json: string } | undefined;
    const sourceEventIds = existing
      ? [...new Set([...JSON.parse(existing.source_event_ids_json) as string[], event.id])]
      : [event.id];

    if (existing) {
      this.database.prepare(`
        UPDATE events SET last_sequence = ?, method = ?, thread_id = ?, turn_id = ?,
          item_id = ?, item_type = ?, activity = ?, agent_delta = ?,
          source_event_ids_json = ?, payload_json = ?, received_at = ?
        WHERE id = ?
      `).run(
        event.sequence,
        event.method,
        event.threadId ?? null,
        event.turnId ?? null,
        event.itemId ?? null,
        event.itemType ?? null,
        event.activity,
        event.agentDelta ?? null,
        JSON.stringify(sourceEventIds),
        JSON.stringify(event),
        event.receivedAt,
        existing.id,
      );
      return;
    }

    this.database.prepare(`
      INSERT INTO events (
        id, task_id, logical_key, first_sequence, last_sequence, method,
        thread_id, turn_id, item_id, item_type, activity, agent_delta,
        source_event_ids_json, payload_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      persistedEventId,
      taskId,
      logicalKey,
      event.sequence,
      event.sequence,
      event.method,
      event.threadId ?? null,
      event.turnId ?? null,
      event.itemId ?? null,
      event.itemType ?? null,
      event.activity,
      event.agentDelta ?? null,
      JSON.stringify(sourceEventIds),
      JSON.stringify(event),
      event.receivedAt,
    );
  }

  private persistFindings(view: TaskView, updatedAt: string): void {
    const findings = [
      { finding: view.currentFinding, state: "current" },
      ...view.history.map((finding) => ({ finding, state: "historical" })),
    ];
    for (const { finding, state } of findings) {
      this.database.prepare(`
        INSERT INTO findings(id, task_id, state, headline, explanation, source_event_ids_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state = excluded.state, headline = excluded.headline,
          explanation = excluded.explanation, source_event_ids_json = excluded.source_event_ids_json,
          updated_at = excluded.updated_at
      `).run(
        finding.id,
        view.taskId,
        state,
        finding.headline,
        finding.explanation,
        JSON.stringify(finding.sourceEventIds),
        updatedAt,
      );
    }
  }

  private persistDirection(view: TaskView, updatedAt: string): void {
    const direction = view.direction!;
    this.database.prepare(`
      INSERT INTO directions(task_id, direction_id, text, state, detail, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, direction_id) DO UPDATE SET text = excluded.text,
        state = excluded.state, detail = excluded.detail, updated_at = excluded.updated_at
    `).run(view.taskId, `${view.taskId}-direction`, direction.text, direction.state, direction.detail, updatedAt);
  }

  private persistApproval(view: TaskView, updatedAt: string): void {
    const approval = view.approval!;
    this.database.prepare(`
      INSERT INTO approvals(task_id, request_id, method, state, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, request_id) DO UPDATE SET state = excluded.state,
        payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `).run(view.taskId, String(approval.requestId), approval.method, approval.state, JSON.stringify(approval), updatedAt);
  }
}
