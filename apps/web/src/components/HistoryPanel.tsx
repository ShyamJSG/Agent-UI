import { useState } from "react";
import type { Finding } from "../types";
import { FindingCard } from "./FindingCard";

type HistoryPanelProps = {
  findings: Finding[];
};

export function HistoryPanel({ findings }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="history-panel">
      <button className="history-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? "⌄" : "›"}</span>
        {findings.length} earlier {findings.length === 1 ? "finding" : "findings"}
      </button>
      {open ? (
        <div className="history-list" data-testid="history-list">
          {findings.map((finding) => (
            <FindingCard finding={finding} key={finding.id} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
