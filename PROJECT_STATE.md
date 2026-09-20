# Agent UI Project State

This file is a concise handoff for a new OpenCode session. Read it together with `AGENTS.md`, `README.md`, `PLAN.md`, and `instructions/Instructions.md`.

## Current status

- Phase 0: complete.
- Phase 1: complete for recorded walkthrough fixtures.
- Phase 2: complete for the real app-server stream foundation.
- Phase 3: complete for the pinned Codex protocol scope.
- Phase 4: complete for the current implementation scope; optional live summary replacement and visual browser review remain.

The repository is ready for a first baseline Git commit. The next product direction is UI expansion toward the supplied visual references: navigation/sidebar, New chat, Recents, richer task history, and more complete review screens.

## Verified environment

Use Linux/WSL only:

- Ubuntu 24.04 under WSL2.
- Node.js `v24.21.0`.
- pnpm `12.5.1`.
- SQLite CLI `3.45.1`.
- Codex CLI `0.155.1`, independently installed as a Linux binary.
- OpenCode `v2.0.11`.

Do not use Windows Node/npm, `/mnt/c`, Windows-installed packages, or Windows paths.

Codex authentication is local-only. Verify it with:

```bash
codex login status
```

Never commit credentials, tokens, local databases, or runtime logs.

## How to run

Install dependencies:

```bash
pnpm install
```

Start frontend:

```bash
pnpm dev --host 127.0.0.1
```

Start backend in another terminal:

```bash
pnpm server
```

Visual fixture routes:

- `/?fixture=overview`
- `/?fixture=steering`
- `/?fixture=evidence`
- `/?fixture=complete`

Live route:

- `/?live=1`

Optional summary mode:

```bash
AGENT_UI_SUMMARY_ENABLED=1 AGENT_UI_SUMMARY_TIMEOUT_MS=60000 pnpm server
```

Summary mode is opt-in and isolated from the coding turn.

## Project map

- `apps/web/src/`: React UI, fixture walkthrough, live mode, progressive disclosure, approvals, steering, and tests.
- `shared/src/taskView.ts`: application-level view-model contracts shared by frontend/backend.
- `server/src/app-server/`: typed Codex app-server child-process client.
- `server/src/events/`: protocol normalization and activity classification.
- `server/src/tasks/`: task lifecycle, steering, interrupt, approvals, reconciliation, summaries, and action idempotency.
- `server/src/persistence/`: built-in SQLite schema, migrations, snapshots, logical event merging, and replay.
- `server/src/summaries/`: summary worker, provider contract, isolated Codex summary provider, and tests.
- `server/test-fixtures/`: fake app-server processes for deterministic integration tests.
- `protocol/`: generated TypeScript types from Linux Codex `0.155.1`; never edit manually.
- `instructions/`: original product specification and visual references.

## Architecture

```text
React browser UI
    <-> local Node HTTP/SSE backend
    <-> Linux codex app-server child process over JSONL stdio
    |
    +-> SQLite task/event/history store
    +-> optional isolated summary app-server context
```

The backend is authoritative. Browser refresh/reconnect must not start duplicate tasks or turns. Local event sequences are used for persistence and SSE replay. Active restored tasks remain disconnected until typed `thread/resume` reconciliation confirms their state.

## Important design rules

- Never guess Codex protocol fields; use generated `protocol/` types.
- Keep tentative findings tentative.
- Distinguish delivery from adoption for steering.
- Do not auto-approve requests or retry uncertain actions automatically.
- Do not fabricate progress percentages.
- Keep commands/output collapsed by default.
- Preserve open details, focus, and scroll position during live updates.
- Do not implement mockup-only stage controls as product features.

## Checks

```bash
pnpm typecheck
pnpm server:typecheck
pnpm test
pnpm build
pnpm audit --prod
git diff --check
```

Before starting a new phase or making architectural changes, update `PLAN.md` and record the decision.
