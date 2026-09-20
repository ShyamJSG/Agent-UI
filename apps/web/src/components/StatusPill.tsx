import type { TaskStatus } from "../types";

type StatusPillProps = {
  status: TaskStatus;
  label: string;
};

export function StatusPill({ status, label }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${status}`} data-testid="status-pill">
      <span className="status-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
