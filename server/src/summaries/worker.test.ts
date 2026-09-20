import { describe, expect, it, vi } from "vitest";
import { SummaryWorker, type SummaryInput } from "./worker";

const input: SummaryInput = {
  taskId: "task-1",
  throughSequence: 4,
  commentary: ["A consequential discovery."],
  completedEvents: [{ id: "event-4", method: "item/completed", activity: "Running a command", itemId: "item-1", agentDelta: "test output" }],
};

describe("SummaryWorker", () => {
  it("debounces updates and runs one job per task", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ kind: "no-change", throughSequence: 4 });
    const worker = new SummaryWorker({ debounceMs: 3000, maxWaitMs: 10000, run, onFinding: vi.fn() });

    worker.enqueue(input);
    worker.enqueue({ ...input, throughSequence: 5, commentary: ["A newer discovery."] });
    await vi.advanceTimersByTimeAsync(2999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].throughSequence).toBe(5);
    vi.useRealTimers();
  });

  it("rejects stale findings and keeps the previous accepted sequence", async () => {
    vi.useFakeTimers();
    const onFinding = vi.fn();
    const run = vi.fn()
      .mockResolvedValueOnce({ kind: "finding", headline: "New", explanation: "New", sourceEventIds: ["event-4"], throughSequence: 4 })
      .mockResolvedValueOnce({ kind: "finding", headline: "Old", explanation: "Old", sourceEventIds: ["event-3"], throughSequence: 3 });
    const worker = new SummaryWorker({ debounceMs: 1, maxWaitMs: 10, run, onFinding });

    worker.enqueue(input);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    worker.enqueue({ ...input, throughSequence: 5 });
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(onFinding).toHaveBeenCalledTimes(1);
    expect(onFinding.mock.calls[0][1].headline).toBe("New");
    vi.useRealTimers();
  });

  it("keeps coding independent when a summary runner fails", async () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const worker = new SummaryWorker({ debounceMs: 1, maxWaitMs: 10, run: vi.fn().mockRejectedValue(new Error("summary failed")), onFinding: vi.fn(), onFailure });
    worker.enqueue(input);
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(onFailure).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
