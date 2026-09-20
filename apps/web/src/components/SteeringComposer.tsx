import { useState } from "react";
import type { TaskStatus } from "../types";

type SteeringComposerProps = {
  status: TaskStatus;
  enabled?: boolean;
  onSubmit?: (text: string) => Promise<void>;
};

export function SteeringComposer({ status, enabled = false, onSubmit }: SteeringComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRunning = status === "running";
  const isComplete = status === "completed";

  async function submit(): Promise<void> {
    if (!onSubmit || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(draft.trim());
      setDraft("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Direction delivery failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="steering-composer" aria-label="Steer the active task">
      <label htmlFor="direction">{isComplete ? "Ask a follow-up" : "Steer the agent as it works"}</label>
      <textarea
        id="direction"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={isComplete ? "Ask a follow-up…" : "Give direction without stopping the task…"}
        rows={2}
      />
      {error ? <p className="steering-composer__error">{error}</p> : null}
      <div className="steering-composer__footer">
        <span>{sending ? "Sending direction…" : isComplete ? "Start a follow-up turn" : "Direction stays available while work runs"}</span>
        <button type="button" onClick={() => void submit()} disabled={!enabled || sending || !draft.trim() || (!isRunning && !isComplete)} aria-label="Send direction">
          {sending ? "…" : "↑"}
        </button>
      </div>
    </section>
  );
}
