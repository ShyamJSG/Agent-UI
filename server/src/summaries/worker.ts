import type { Finding } from "../../../shared/src/taskView";
import type { NormalizedEvent } from "../events/normalizer";

export type SummaryInput = {
  taskId: string;
  throughSequence: number;
  commentary: string[];
  completedEvents: Array<Pick<NormalizedEvent, "id" | "method" | "activity" | "itemId" | "agentDelta">>;
  previousFinding?: Finding;
};

export type SummaryResult =
  | { kind: "no-change"; throughSequence: number }
  | {
      kind: "finding";
      headline: string;
      explanation: string;
      sourceEventIds: string[];
      throughSequence: number;
      replacesFindingId?: string;
      tentative?: boolean;
    };

export type SummaryRunner = (input: SummaryInput) => Promise<SummaryResult>;

export type SummaryWorkerOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  maxInputChars?: number;
  run: SummaryRunner;
  onFinding: (taskId: string, result: Extract<SummaryResult, { kind: "finding" }>) => void;
  onFailure?: (taskId: string, error: unknown) => void;
  onResult?: (taskId: string, result: SummaryResult, accepted: boolean, reason?: string) => void;
};

type TaskJob = {
  latest: SummaryInput;
  debounceTimer?: ReturnType<typeof setTimeout>;
  maxWaitTimer?: ReturnType<typeof setTimeout>;
  running: boolean;
  dirty: boolean;
  acceptedSequence: number;
};

export class SummaryWorker {
  private readonly jobs = new Map<string, TaskJob>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly maxInputChars: number;
  private readonly run: SummaryRunner;
  private readonly onFinding: SummaryWorkerOptions["onFinding"];
  private readonly onFailure: SummaryWorkerOptions["onFailure"];
  private readonly onResult: SummaryWorkerOptions["onResult"];

  public constructor(options: SummaryWorkerOptions) {
    this.debounceMs = options.debounceMs ?? 3000;
    this.maxWaitMs = options.maxWaitMs ?? 10000;
    this.maxInputChars = options.maxInputChars ?? 20000;
    this.run = options.run;
    this.onFinding = options.onFinding;
    this.onFailure = options.onFailure;
    this.onResult = options.onResult;
  }

  public enqueue(input: SummaryInput): void {
    const bounded = boundInput(input, this.maxInputChars);
    const existing = this.jobs.get(input.taskId);
    const job: TaskJob = existing ?? { latest: bounded, running: false, dirty: false, acceptedSequence: 0 };
    job.latest = bounded;
    this.jobs.set(input.taskId, job);

    if (job.running) {
      job.dirty = true;
      return;
    }
    if (!job.debounceTimer) job.debounceTimer = setTimeout(() => void this.runTask(input.taskId), this.debounceMs);
    if (!job.maxWaitTimer) job.maxWaitTimer = setTimeout(() => void this.runTask(input.taskId), this.maxWaitMs);
  }

  public stop(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (!job) return;
    if (job.debounceTimer) clearTimeout(job.debounceTimer);
    if (job.maxWaitTimer) clearTimeout(job.maxWaitTimer);
    this.jobs.delete(taskId);
  }

  private async runTask(taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);
    if (!job || job.running) return;
    if (job.debounceTimer) clearTimeout(job.debounceTimer);
    if (job.maxWaitTimer) clearTimeout(job.maxWaitTimer);
    job.debounceTimer = undefined;
    job.maxWaitTimer = undefined;
    job.running = true;
    job.dirty = false;
    const input = job.latest;

    try {
      const result = await this.run(input);
      if (result.kind === "finding") {
        const isCurrent = result.throughSequence >= job.acceptedSequence && result.throughSequence >= input.throughSequence;
        if (isCurrent) {
          job.acceptedSequence = result.throughSequence;
          this.onResult?.(taskId, result, true);
          this.onFinding(taskId, result);
        } else this.onResult?.(taskId, result, false, "stale");
      } else {
        job.acceptedSequence = Math.max(job.acceptedSequence, result.throughSequence);
        this.onResult?.(taskId, result, true);
      }
    } catch (error) {
      this.onFailure?.(taskId, error);
    } finally {
      job.running = false;
      if (job.dirty) {
        job.debounceTimer = setTimeout(() => void this.runTask(taskId), 0);
      }
    }
  }
}

function boundInput(input: SummaryInput, maxChars: number): SummaryInput {
  let remaining = maxChars;
  const commentary = input.commentary.map((entry) => {
    const value = entry.slice(0, Math.max(0, remaining));
    remaining -= value.length;
    return value;
  }).filter(Boolean);
  const completedEvents = input.completedEvents.map((event) => {
    if (remaining <= 0) return null;
    const delta = event.agentDelta?.slice(0, remaining);
    remaining -= delta?.length ?? 0;
    return { ...event, agentDelta: delta };
  }).filter((event): event is NonNullable<typeof event> => event !== null);
  return { ...input, commentary, completedEvents };
}
