# Agent UI Project

Local UI for following and steering a Codex coding task.

## Baseline status

This repository is the first implementation baseline. Phases 0–3 are complete and Phase 4’s scheduling, provider contract, isolated provider, runtime integration, and live no-change verification are complete. The next major product work is the richer workspace UI shown in the supplied screenshots: navigation, New chat, Recents, multi-task history, and deeper review surfaces.

## WSL/Linux development

Use the Linux/WSL toolchain only. The project uses Node.js and pnpm.

Install dependencies:

```bash
pnpm install
```

Start the frontend:

```bash
pnpm dev --host 127.0.0.1
```

Start the backend in a second terminal:

```bash
pnpm server
```

Recorded walkthroughs:

```text
http://127.0.0.1:5173/?fixture=overview
http://127.0.0.1:5173/?fixture=steering
http://127.0.0.1:5173/?fixture=evidence
http://127.0.0.1:5173/?fixture=complete
```

Live mode:

```text
http://127.0.0.1:5173/?live=1
```

Live mode requires authenticated Linux Codex:

```bash
codex login status
```

The summary provider is disabled by default. Enable it explicitly for local experiments:

```bash
AGENT_UI_SUMMARY_ENABLED=1 \
AGENT_UI_SUMMARY_TIMEOUT_MS=60000 \
pnpm server
```

The summary provider uses a separate Codex app-server context. Summary failures and timeouts do not stop coding.

## Checks

```bash
pnpm typecheck
pnpm server:typecheck
pnpm test
pnpm build
```

Protocol types under `protocol/` are generated from the pinned Linux Codex CLI. Never guess protocol fields; regenerate and inspect the types when the Codex version changes.

## What is implemented

The current baseline includes:

- Recorded pagination walkthrough fixtures with progressive disclosure.
- Live Codex task streaming through a local Node backend.
- Current takeaway, activity, next step, evidence, history, and completion views.
- Steering with separate delivery and adoption states.
- Stop/interrupt lifecycle with confirmed stopping.
- Command, file-change, permission, tool-input, and supported MCP elicitation approval flows.
- SQLite task snapshots, logical event merging, findings, directions, approvals, and action idempotency.
- Browser SSE sequence IDs, replay cursors, thread resume reconciliation, and same-thread follow-up turns.
- An opt-in isolated summary worker/provider with no-change, stale-result, bounded-input, and failure-isolation behavior.

The UI is an intentional baseline, not a finished clone of the visual references. Navigation such as New chat, Recents, and a richer multi-task workspace is planned for future UI work.

## Architecture

```text
React + TypeScript browser UI
        <-> local Node HTTP/SSE backend
        <-> Linux codex app-server child process
             JSONL over stdin/stdout

Backend -> SQLite task/event/history store
Backend -> optional isolated summary app-server context
```

The backend is authoritative. Browser refreshes and reconnects restore backend state; they must not create duplicate threads, turns, approvals, steering requests, or interrupts.

## Repository map

```text
apps/web/src/       React UI, fixtures, live mode, and UI tests
shared/src/         Frontend/backend view-model contracts
server/src/         HTTP backend, Codex bridge, normalizer, persistence, summaries
server/test-fixtures/ deterministic fake app-server processes
protocol/           generated Codex protocol TypeScript types
instructions/       original task specification and screenshots
PLAN.md             complete phased implementation plan and status
PROJECT_STATE.md    new-session handoff and operational snapshot
AGENTS.md           permanent OpenCode/project instructions
```

## Testing and verification

The project uses Vitest for UI/backend tests and Node’s built-in SQLite implementation for local persistence. The current suite covers event normalization, logical event merging, approval routing, steering, interrupt states, reconciliation, follow-up turns, summaries, progressive disclosure, and stable reading behavior.

Run all normal checks with:

```bash
pnpm typecheck && \
pnpm server:typecheck && \
pnpm test && \
pnpm build && \
pnpm audit --prod && \
git diff --check
```

## Security and repository hygiene

- Runtime databases are stored under ignored `data/`.
- `node_modules/`, build output, coverage, logs, environment files, and SQLite files are ignored.
- Credentials remain in the local Codex installation/configuration and are never stored in this repository.
- The app-server is local-only by default.
- Approval requests are never automatically approved.
- The generated protocol directory contains types/schema artifacts, not credentials.

## Current known limitations

- The OpenCode desktop browser bridge may be unavailable in API-only sessions; local browser access still works through the documented Vite URL.
- Complex MCP and filesystem permission schemas remain visible but are not answered with guessed fields.
- Live summary mode is opt-in. Live no-change behavior and the real provider contract are verified; a live task-level replacement finding remains optional follow-up verification.
- The visual workspace still needs the next UI phase: navigation, New chat, Recents, richer task history, and more complete review screens.
