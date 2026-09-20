import type { TaskView } from "../types";
import { ApprovalPanel } from "./ApprovalPanel";
import { FindingCard } from "./FindingCard";
import { HistoryPanel } from "./HistoryPanel";
import { StatusPill } from "./StatusPill";
import { SteeringComposer } from "./SteeringComposer";

type TaskViewerProps = {
  task: TaskView;
  onSteer?: (text: string) => Promise<void>;
  onFollowUp?: (text: string) => Promise<void>;
  onInterrupt?: () => Promise<void>;
};

export function TaskViewer({ task, onSteer, onFollowUp, onInterrupt }: TaskViewerProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RECORDED WALKTHROUGH · ORDERS API</p>
          <p className="fixture-label">{task.fixtureLabel}</p>
        </div>
        <StatusPill status={task.status} label={task.statusLabel} />
      </header>

      <main className="viewer-card">
        <header className="task-header">
          <div className="task-header__title">
            <span className="repo-icon" aria-hidden="true">⌘</span>
            <div>
              <h1>{task.title}</h1>
              <p>{task.repository}</p>
            </div>
          </div>
          <span className="branch-label">⑂ {task.branch}</span>
        </header>

        <div className="task-content">
          <div className="request-bubble">{task.request}</div>

          <p className="agent-intro">I’ll check the existing API contract, add pagination, and verify compatibility.</p>

          {task.direction ? (
            <div className={`direction-banner direction-banner--${task.direction.state}`} data-testid="direction-status">
              <strong>
                {task.direction.state === "adopted"
                  ? "✓ Your direction changed the approach"
                  : task.direction.state === "agentAskedQuestion"
                    ? "The agent asked a question"
                    : task.direction.state === "agentDisagreed"
                      ? "The agent did not adopt this direction"
                      : task.direction.state === "adoptionPending"
                        ? "Direction received · adoption pending"
                        : "Direction status"}
              </strong>
              <p>{task.direction.text}</p>
              <span>{task.direction.detail}</span>
            </div>
          ) : null}

          {task.approval ? <ApprovalPanel approval={task.approval} /> : null}

          <HistoryPanel findings={task.history} />

          <FindingCard finding={task.currentFinding} current />

          <div className="activity-line">
            <span className="activity-line__pulse" aria-hidden="true" />
            <span>{task.currentActivity}</span>
          </div>

          {onInterrupt && (task.status === "running" || task.status === "stopping") ? (
            <button
              className="stop-button"
              type="button"
              disabled={task.status === "stopping"}
              onClick={() => void onInterrupt()}
            >
              {task.status === "stopping" ? "Stopping…" : "Stop task"}
            </button>
          ) : null}

          {task.nextStep ? (
            <p className="next-step">
              <strong>Next</strong>
              <span>·</span>
              {task.nextStep}
            </p>
          ) : null}

          {task.completion ? (
            <section className="completion-panel" data-testid="completion-panel">
              <div className="completion-panel__header">
                <span>✓</span>
                <div>
                  <p>Result</p>
                  <h2>{task.completion.headline}</h2>
                </div>
              </div>
              <p>{task.completion.detail}</p>
              <div className="completion-checks">
                {task.completion.checks.map((check) => <span key={check}>{check}</span>)}
              </div>
              <details>
                <summary>Review changes · {task.completion.changedFiles.length} files</summary>
                <ul>
                  {task.completion.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}
                </ul>
              </details>
            </section>
          ) : null}

          <SteeringComposer
            status={task.status}
            enabled={Boolean(task.status === "completed" ? onFollowUp : onSteer)}
            onSubmit={task.status === "completed" ? onFollowUp : onSteer}
          />
        </div>
      </main>
    </div>
  );
}
