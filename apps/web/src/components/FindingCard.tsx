import { useState } from "react";
import type { Finding } from "../types";

type FindingCardProps = {
  finding: Finding;
  current?: boolean;
};

export function FindingCard({ finding, current = false }: FindingCardProps) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);

  return (
    <article className={`finding-card finding-card--${finding.tone} ${current ? "finding-card--current" : ""}`}>
      <div className="finding-card__meta">
        <span className="finding-card__marker" aria-hidden="true" />
        <span>{finding.label}</span>
        <span aria-hidden="true">·</span>
        <time>{finding.time}</time>
        {finding.tentative ? <span className="finding-card__tentative">Tentative</span> : null}
      </div>

      <h2>{finding.headline}</h2>

      {current ? (
        <>
          <button
            className="disclosure-button"
            type="button"
            aria-expanded={explanationOpen}
            onClick={() => setExplanationOpen((open) => !open)}
          >
            <span aria-hidden="true">{explanationOpen ? "⌄" : "›"}</span>
            {explanationOpen ? "Hide explanation" : "What led here"}
          </button>

          {explanationOpen ? (
            <div className="finding-card__explanation" data-testid="explanation">
              <p>{finding.explanation}</p>

              <button
                className="disclosure-button disclosure-button--nested"
                type="button"
                aria-expanded={evidenceOpen}
                onClick={() => setEvidenceOpen((open) => !open)}
              >
                <span aria-hidden="true">{evidenceOpen ? "⌄" : "›"}</span>
                Supporting steps · {finding.supportingSteps.length}
              </button>

              {evidenceOpen ? (
                <div className="evidence-list" data-testid="supporting-steps">
                  {finding.supportingSteps.map((step) => (
                    <div className="evidence-item" key={`${finding.id}-${step.title}`}>
                      <strong>{step.title}</strong>
                      <span>{step.detail}</span>
                      {step.path ? <code>{step.path}</code> : null}
                    </div>
                  ))}

                  <button
                    className="disclosure-button disclosure-button--nested"
                    type="button"
                    aria-expanded={commandsOpen}
                    onClick={() => setCommandsOpen((open) => !open)}
                  >
                    <span aria-hidden="true">{commandsOpen ? "⌄" : "›"}</span>
                    Commands and output
                  </button>

                  {commandsOpen ? (
                    <div className="command-list" data-testid="commands">
                      {finding.commands.map((command) => (
                        <div className="command-item" key={`${finding.id}-${command.command}`}>
                          <code>{command.command}</code>
                          <pre>{command.output}</pre>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="finding-card__history-detail">{finding.explanation}</p>
      )}
    </article>
  );
}
