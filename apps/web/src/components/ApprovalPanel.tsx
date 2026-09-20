import { useState } from "react";
import type { ApprovalAction, ApprovalRequest } from "../types";

type ApprovalPanelProps = {
  approval: ApprovalRequest;
};

const labels: Record<ApprovalAction, string> = {
  accept: "Allow once",
  acceptForSession: "Allow for session",
  decline: "Decline",
  cancel: "Cancel",
};

export function ApprovalPanel({ approval }: ApprovalPanelProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState(false);
  const [readPaths, setReadPaths] = useState<string[]>(approval.permissionRequest?.readPaths ?? []);
  const [writePaths, setWritePaths] = useState<string[]>(approval.permissionRequest?.writePaths ?? []);
  const [scope, setScope] = useState<"turn" | "session">("turn");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [mcpValues, setMcpValues] = useState<Record<string, string | number | boolean>>({});
  const actionable = approval.availableActions.length > 0 && approval.state !== "resolved";

  async function respond(action: ApprovalAction): Promise<void> {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: approval.requestId, action, actionId: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Approval response failed");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Approval response failed");
    } finally {
      setSending(false);
    }
  }

  async function grantPermissions(): Promise<void> {
    if (!approval.permissionRequest) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: approval.requestId,
          action: "grantPermissions",
          actionId: crypto.randomUUID(),
          permissions: { network, readPaths, writePaths, scope },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Permission response failed");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Permission response failed");
    } finally {
      setSending(false);
    }
  }

  async function answerUserInput(): Promise<void> {
    if (!approval.userInputRequest) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: approval.requestId, action: "answerUserInput", actionId: crypto.randomUUID(), answers }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Answer delivery failed");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Answer delivery failed");
    } finally {
      setSending(false);
    }
  }

  async function respondMcp(action: "accept" | "decline" | "cancel"): Promise<void> {
    if (!approval.mcpElicitation) return;
    setSending(true);
    setError(null);
    const content = action === "accept" && approval.mcpElicitation.formSupported ? mcpValues : null;
    try {
      const response = await fetch("/api/tasks/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: approval.requestId, action: "mcpElicitation", actionId: crypto.randomUUID(), mcp: { action, content } }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "MCP response failed");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "MCP response failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`approval-panel approval-panel--${approval.state}`} data-testid="approval-panel">
      <div className="approval-panel__eyebrow">Human decision needed</div>
      <h2>{approval.title}</h2>
      <p>{approval.detail}</p>
      {approval.command ? <code className="approval-panel__command">{approval.command}</code> : null}
      {approval.cwd ? <span className="approval-panel__cwd">Working directory: {approval.cwd}</span> : null}

      {approval.state === "unsupported" ? (
        <p className="approval-panel__notice">This request is visible, but its typed response form is not enabled yet. It will not be auto-approved.</p>
      ) : null}
      {approval.permissionRequest && approval.state !== "unsupported" ? (
        <div className="permission-form">
          {approval.permissionRequest.networkRequested ? (
            <label><input type="checkbox" checked={network} onChange={(event) => setNetwork(event.target.checked)} /> Allow network access</label>
          ) : null}
          {approval.permissionRequest.readPaths.length > 0 ? (
            <label><input type="checkbox" checked={readPaths.length > 0} onChange={(event) => setReadPaths(event.target.checked ? approval.permissionRequest!.readPaths : [])} /> Read requested paths</label>
          ) : null}
          {approval.permissionRequest.writePaths.length > 0 ? (
            <label><input type="checkbox" checked={writePaths.length > 0} onChange={(event) => setWritePaths(event.target.checked ? approval.permissionRequest!.writePaths : [])} /> Write requested paths</label>
          ) : null}
          <label>Grant scope
            <select value={scope} onChange={(event) => setScope(event.target.value as "turn" | "session")}>
              <option value="turn">This turn</option>
              <option value="session">This session</option>
            </select>
          </label>
          <button type="button" disabled={sending || approval.state === "resolved"} onClick={() => void grantPermissions()}>
            {sending ? "Sending…" : "Grant selected permissions"}
          </button>
        </div>
      ) : null}
      {approval.userInputRequest && approval.state !== "unsupported" ? (
        <div className="user-input-form">
          {approval.userInputRequest.questions.map((question) => (
            <fieldset key={question.id}>
              <legend>{question.header}</legend>
              <p>{question.question}</p>
              {question.options?.map((option) => (
                <label key={option.label}>
                  <input
                    type="checkbox"
                    checked={(answers[question.id] ?? []).includes(option.label)}
                    onChange={(event) => setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.checked
                        ? [...(current[question.id] ?? []), option.label]
                        : (current[question.id] ?? []).filter((value) => value !== option.label),
                    }))}
                  />
                  {option.label}
                </label>
              ))}
              {question.isOther || !question.options ? (
                <input
                  type={question.isSecret ? "password" : "text"}
                  aria-label={question.question}
                  placeholder="Your answer"
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: [event.target.value] }))}
                />
              ) : null}
            </fieldset>
          ))}
          <button type="button" disabled={sending || approval.state === "resolved"} onClick={() => void answerUserInput()}>
            {sending ? "Sending…" : "Send answers"}
          </button>
        </div>
      ) : null}
      {approval.mcpElicitation ? (
        <div className="mcp-form">
          {approval.mcpElicitation.url ? <a href={approval.mcpElicitation.url} target="_blank" rel="noreferrer">Open requested URL</a> : null}
          {approval.mcpElicitation.challenge ? <code>{approval.mcpElicitation.challenge}</code> : null}
          {approval.mcpElicitation.fields.map((field) => (
            <label key={field.key}>{field.label}
              <input
                type={field.type === "boolean" ? "checkbox" : "text"}
                required={field.required}
                checked={field.type === "boolean" ? Boolean(mcpValues[field.key]) : undefined}
                value={field.type === "boolean" ? undefined : String(mcpValues[field.key] ?? "")}
                onChange={(event) => setMcpValues((current) => ({
                  ...current,
                  [field.key]: field.type === "boolean" ? event.target.checked : field.type === "number" ? Number(event.target.value) : event.target.value,
                }))}
              />
            </label>
          ))}
          <div className="mcp-form__actions">
            <button type="button" disabled={sending || approval.state === "resolved" || (!approval.mcpElicitation.formSupported && approval.mcpElicitation.mode === "form")} onClick={() => void respondMcp("accept")}>Accept</button>
            <button type="button" disabled={sending || approval.state === "resolved"} onClick={() => void respondMcp("decline")}>Decline</button>
            <button type="button" disabled={sending || approval.state === "resolved"} onClick={() => void respondMcp("cancel")}>Cancel</button>
          </div>
        </div>
      ) : null}
      {approval.state === "resolved" ? <p className="approval-panel__notice">Decision sent to Codex. Waiting for the next task event.</p> : null}
      {approval.error ? <p className="approval-panel__error">{approval.error}</p> : null}

      {actionable ? (
        <div className="approval-panel__actions">
          {approval.availableActions.map((action) => (
            <button key={action} type="button" disabled={sending} onClick={() => void respond(action)}>
              {sending ? "Sending…" : labels[action]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
