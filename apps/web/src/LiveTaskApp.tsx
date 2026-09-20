import { useEffect, useRef, useState } from "react";
import type { TaskView } from "./types";
import { TaskViewer } from "./components/TaskViewer";

const DEFAULT_PROMPT = "Add cursor pagination to the orders API without breaking existing clients.";

export function LiveTaskApp() {
  const [task, setTask] = useState<TaskView | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSequence = useRef(0);

  useEffect(() => {
    let mounted = true;
    const source = new EventSource(`/api/tasks/stream?after=${lastSequence.current}`);

    void fetch("/api/tasks/active")
      .then((response) => response.json() as Promise<{ task: TaskView | null; sequence?: number }>)
      .then((payload) => {
        if (mounted) {
          lastSequence.current = Math.max(lastSequence.current, payload.sequence ?? 0);
          setTask(payload.task);
        }
      })
      .catch(() => {
        if (mounted) setError("The local backend is not available. Start it with pnpm server.");
      });

    const handleStreamEvent = (event: Event) => {
      if (!mounted) return;
      const payload = JSON.parse((event as MessageEvent).data) as { view?: TaskView | null; sequence?: number } | TaskView | null;
      if (payload && "view" in payload) {
        lastSequence.current = Math.max(lastSequence.current, payload.sequence ?? 0);
        setTask(payload.view ?? null);
      } else {
        setTask(payload as TaskView | null);
      }
    };
    source.addEventListener("snapshot", handleStreamEvent);
    source.addEventListener("update", handleStreamEvent);
    source.addEventListener("replay", handleStreamEvent);
    source.onerror = () => {
      if (mounted) setError("Waiting for the local backend event stream…");
    };

    return () => {
      mounted = false;
      source.close();
    };
  }, []);

  if (task) {
    return (
      <TaskViewer
        task={task}
        onSteer={async (text) => {
          const response = await fetch("/api/tasks/steer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, actionId: crypto.randomUUID() }),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Direction delivery failed");
        }}
        onInterrupt={async () => {
          const response = await fetch("/api/tasks/interrupt", {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Stop request failed");
        }}
        onFollowUp={async (text) => {
          const response = await fetch("/api/tasks/follow-up", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: text, actionId: crypto.randomUUID() }),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Follow-up failed");
        }}
      />
    );
  }

  return (
    <main className="live-launcher">
      <div className="live-launcher__eyebrow">LIVE CODEX TASK</div>
      <h1>Start a coding task</h1>
      <p>The local backend will start Codex in the configured working directory and stream observable progress here.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setStarting(true);
          setError(null);
          void fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, actionId: crypto.randomUUID() }),
          })
            .then(async (response) => {
              const payload = (await response.json()) as { task?: TaskView; error?: string };
              if (!response.ok) throw new Error(payload.error ?? "Unable to start task");
              setTask(payload.task ?? null);
            })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to start task"))
            .finally(() => setStarting(false));
        }}
      >
        <label htmlFor="live-prompt">Task request</label>
        <textarea id="live-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
        <button type="submit" disabled={starting || !prompt.trim()}>{starting ? "Starting…" : "Start task"}</button>
      </form>
      {error ? <p className="live-launcher__error">{error}</p> : null}
      <p className="live-launcher__hint">The recorded walkthrough remains available without a backend at the default route.</p>
    </main>
  );
}
