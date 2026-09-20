# Agent UI Implementation Plan

Status: **Phase 4 — complete for the current implementation scope; final optional verification remains**

This plan is derived from `instructions/Instructions.md`, which is the original product specification. It is the source of truth for behavior. The screenshots in `instructions/` are visual references only; the mockup stage selector, Next button, example-direction button, sidebar demo controls, and “Behind this moment” section are not product features.

## 1. Executive Understanding

Build a local standalone web UI for following and steering one Codex coding task in one local repository.

The core experience is:

1. The user starts a task.
2. The backend starts or resumes a Codex thread and starts a turn.
3. Codex streams activity, commentary, plans, diffs, approvals, and completion events.
4. The UI presents one takeaway, one current activity line, and a short next step when known.
5. The user can progressively expand explanation, evidence, supporting steps, and command output.
6. The user can send direction while the turn is active, stop the turn, respond to approval requests, and review completed work.
7. Task state and history survive browser refreshes and reconnects.

The repository initially contains no frontend, backend, database, or Codex integration. Implementation must verify the local runtime and pinned Codex protocol before real integration.

### Environment assessment — 2026-09-20

- Operating environment: Ubuntu 24.04.5 LTS under WSL2 on x86_64 Linux kernel 6.6.87.2.
- Git: 2.43.0.
- OpenCode: v2.0.11, available in the local OpenCode environment.
- Node.js: Linux Node `v24.21.0`, installed in the local Linux user environment.
- npm: Linux npm `11.19.0`.
- Package manager: Linux pnpm `12.5.1`; `pnpm install` recreated the ignored `node_modules/` directory and generated `pnpm-lock.yaml`.
- Other inspected tooling: Yarn `4.18.0`, Bun `1.4.2`, Deno `2.9.7`, SQLite CLI `3.45.1`, Python `3.12.3`, and curl are available. Docker is absent and is not required for the initial setup.
- Codex CLI: independently installed Linux standalone binary `codex-cli 0.155.1`, available as `codex` in the local Linux environment.
- Generated protocol types: regenerated using the Linux Codex `0.155.1` binary with experimental types into `protocol/`.
- Authentication status: `codex login status` reports logged in using ChatGPT.
- Linux app-server initialization is verified. An authenticated probe completed a real no-file-change turn, observed one agent-message delta, resumed the same thread successfully, and deleted the probe thread without starting a duplicate turn.

Only Linux/WSL tools and dependencies are accepted for this project. Any earlier non-Linux runtime probe is not considered valid project verification.

## 2. Requirements Breakdown

### Functional requirements

- Support one local repository and one active task in the first version.
- Start a task, follow progress, inspect evidence, steer, stop, handle approvals, review results, and retain history across refreshes.
- Show one clear current takeaway, one activity line, and a next step when known.
- Publish prominent findings only for consequential discoveries, approach changes, important failures, or human decisions.
- Keep routine commands in activity rather than creating noisy findings.
- Provide progressive disclosure: takeaway -> explanation -> supporting steps -> commands/output.
- Keep earlier findings in collapsed history, including mistaken assumptions and their revisions.
- Preserve tentative language and never invent progress percentages.
- Keep open details, focus, and scroll position stable during streaming updates.
- Keep steering available while the task runs.
- Surface approvals without bypassing or auto-approving them.
- Explicitly represent waiting, running, stopping, stopped, failed, completed, and disconnected states.
- Restore the same task after browser refresh or reconnect without duplicating agent actions.

### Steering requirements

- Route direction using the typed `turn/steer` operation and the active expected turn ID.
- Show “Direction received” only after successful delivery.
- Confirm adoption only from later commentary/actions, never from send success alone.
- If the turn ends before delivery, retain the direction and offer an explicit follow-up send.
- If delivery is uncertain, do not retry automatically or duplicate the message.
- Show disagreement or questions instead of falsely claiming adoption.

### Stop requirements

- Use the typed `turn/interrupt` operation.
- Show stopping until completion confirms the turn stopped.
- Stopping does not undo edits.
- Continuing means a new turn in the same conversation/thread.

### Summary requirements

- Initially use the agent’s own commentary for takeaways.
- Add an independent background summary worker later.
- The worker has its own context, reads copied commentary/relevant completed events/previous summary, batches input, debounces, has a maximum wait, allows one job per task, bounds input, and returns either no change or a short finding with source IDs.
- Preserve tentative language and treat tool output as data.
- Associate results with an input sequence; stale results cannot overwrite newer findings.
- Preserve the last takeaway when summarization fails and never block coding.
- Starting timing guidance is approximately a 3-second debounce and 10-second maximum wait, both configurable.

## 3. Proposed Architecture

```text
React + TypeScript browser UI
          |
          | application commands, snapshots, event stream
          v
Node.js local backend
          |
          | JSONL over stdin/stdout
          v
codex app-server child process
          |
          v
Codex execution, tools, permissions, approvals

Node.js backend -> SQLite task/event/history store
Node.js backend -> isolated summary worker/context
```

### Frontend

The frontend consumes a normalized application view model, not raw Codex protocol messages. Major regions:

- Task/thread context and lifecycle status.
- Current takeaway.
- Current activity and next step.
- Collapsed historical findings.
- Expandable explanation, supporting evidence, and commands/output.
- Steering composer and stop action.
- Approval request panel.
- Completion/result and changed-file review.
- Connection/reconnection indicator.

### Backend

The backend is authoritative for Codex process lifecycle, protocol initialization, thread/turn state, event normalization, SQLite persistence, activity classification, browser streaming, steering, interrupts, approvals, reconnect/replay, and summary scheduling.

Use HTTP application commands plus a replayable browser event stream (SSE or WebSocket to be selected after environment setup). The browser must never decide whether a task or operation has already started.

### Codex process

Spawn `codex app-server` as a backend child process using default stdio transport. Keep stdout protocol-only and route stderr to backend diagnostics. Initialize once per connection, create/resume a thread, start turns, read notifications, and route steering/interrupt/approval responses through the same connection.

### Summary worker

Run summary work separately from the active coding turn with its own context and concurrency guard. The exact provider/app-server mechanism is an open question until the local Codex/runtime configuration is known.

## 4. Proposed Project Structure

The repository is blank, so these are proposed areas rather than existing paths. Keep names consistent with the selected build tooling.

```text
/
├── AGENTS.md
├── PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── apps/
│   └── web/                         # React + TypeScript UI
│       ├── src/
│       │   ├── components/
│       │   ├── state/
│       │   ├── transport/
│       │   └── fixtures/
│       └── tests/
├── server/
│   ├── src/
│   │   ├── app-server/              # child process and typed protocol adapter
│   │   ├── events/                   # raw ingestion, normalization, activity
│   │   ├── tasks/                    # task/thread/turn state machines
│   │   ├── steering/
│   │   ├── approvals/
│   │   ├── summaries/
│   │   ├── persistence/             # SQLite schema/repositories
│   │   └── transport/               # browser API and event stream
│   └── tests/
├── shared/
│   └── src/                          # application-level view/data contracts
├── protocol/                         # generated types for pinned Codex version
├── fixtures/                         # recorded protocol/event walkthroughs
└── migrations/                       # SQLite migrations, if the chosen driver uses them
```

Do not commit local SQLite files, credentials, runtime logs, or task data.

## 5. Dependencies and Runtime Assumptions

### Required before implementation

- Supported Linux Node.js runtime and pnpm package manager.
- React and TypeScript tooling.
- SQLite-compatible Node driver and migration strategy.
- Independently installed/pinned Linux Codex CLI with `codex app-server`.
- Generated TypeScript protocol types from that exact Codex version.
- Local model/authentication configuration supplied outside source control.

### Dependency policy

- Inspect what is already installed before adding packages.
- Do not install arbitrary packages solely because the task suggests them.
- Prefer a small dependency set and existing repository patterns; this repository currently has no patterns.
- Protocol fields must come from generated types, never guesses.

## 6. Core Data / Event Model

### Raw protocol envelope

In memory, each protocol message is represented with receipt time, local sequence candidate, JSON-RPC response/notification/request classification, method, request ID when present, and raw JSON payload. Validate/normalize it using generated protocol types.

### Logical persisted events

Persist logical event records rather than one row per streamed text chunk. Each record contains:

- Stable local event ID.
- Task ID.
- Codex thread ID.
- Codex turn ID.
- Codex item ID when available.
- First and latest local sequence.
- Event kind/method.
- Latest normalized and diagnostic raw payload.
- First/latest receipt timestamps.
- Completion status when known.

Merge updates by item ID. Agent message deltas accumulate into the same logical message record. Item start/completion update the same logical item record. Events without item IDs use a verified deterministic logical key or remain distinct when they are meaningfully separate.

### Sequence/order rules

- Allocate a monotonic task-local sequence transactionally.
- Preserve protocol arrival order; do not reorder by timestamps.
- Each merged update receives a new sequence while retaining the stable event ID.
- Replay uses the latest sequence and returns the latest logical state, not every text delta.

### Identity

- Local task ID: one user-requested task.
- Codex thread ID: one conversation, reused for follow-up turns.
- Codex turn ID: one execution run in a thread.
- Codex item ID: one action/message within a turn when supplied.

### Findings

Application-level findings should include:

- `findingId`
- `headline`
- `explanation`
- `sourceEventIds`
- `throughSequence`
- `replacesFindingId` when applicable
- origin and tentative/confirmed/revised status
- current/historical status

These fields are viewer fields, not Codex protocol fields. Earlier findings remain persisted when replaced.

### Activity classification

Classify in the backend from observable item type, command/tool metadata, paths, status, protocol method, and explicit commentary. Use labels such as “Searching files,” “Reading the handler,” “Editing the query,” and “Running tests.” Use a generic label when uncertain.

### Lean SQLite model

The planned persistence model is:

- `tasks`: local task identity, repository context, lifecycle status, active turn, sequence watermark, timestamps.
- `threads`: local task association, Codex thread ID, metadata, timestamps.
- `turns`: thread association, Codex turn ID, status, stop-request status, timestamps.
- `events`: stable logical event ID, task/thread/turn/item IDs, kind, latest payload, first/latest sequence, timestamps.
- `findings`: current/history state, headline, explanation, source event IDs, through sequence, replacement link.
- `directions`: user text, expected turn ID, delivery state, uncertain state, adoption outcome, timestamps.
- `approvals`: protocol request ID, typed request payload, task/thread/turn association, pending/resolved/delivery state.

Use foreign keys, a task sequence uniqueness constraint, and indexes on task/sequence, thread/turn, item ID, current findings, pending approvals, and active directions.

## 7. UI State Model

### Task state

```text
waiting -> running -> stopping -> stopped
running -> completed | failed | disconnected
stopping -> stopped | failed | disconnected
disconnected -> reconciled known state
stopped/completed -> waiting for an explicit follow-up turn
```

`stopping` is distinct from `stopped`; a stop request is not proof of completion.

### Activity state

No activity, classified activity, generic work, waiting for approval, waiting for input, finishing, or complete. Activity can update without replacing a finding.

### Finding state

Tentative, confirmed, revised, current, historical, superseded, or final result.

### Steering state

Draft, sending, received, delivery failed, delivery uncertain, queued for follow-up, adoption pending, adopted, agent disagreed, or agent asked a question.

### Approval state

None, pending, responding, delivered, delivery failed, or reconciliation required. Exact action shapes come from the installed protocol.

### Connection state

Track browser connection separately from app-server process state. Browser reconnect must only attach to backend state and replay events.

### Stable rendering

Key UI sections by stable IDs, keep expansion state outside streamed event arrays, preserve focus, avoid forced scrolling, and keep the steering composer mounted while running.

## 8. Codex App-Server Integration Plan

1. Locate/install and pin the intended Codex CLI.
2. Generate TypeScript protocol types from that exact version.
3. Spawn the app-server child with piped stdin/stdout and stderr diagnostics.
4. Parse newline-delimited JSON and correlate request IDs.
5. Send typed `initialize`, await the response, then send `initialized`.
6. Create or resume a thread and persist its Codex ID before starting a turn.
7. Start the turn with the user task and the task-start commentary instruction, using the exact supported protocol field.
8. Normalize `item/started`, `item/completed`, `item/agentMessage/delta`, `turn/plan/updated`, `turn/diff/updated`, `turn/completed`, and all relevant installed-version events.
9. Persist before broadcasting browser updates.
10. Route typed steering with the active expected turn ID.
11. Route typed interrupt and wait for completion confirmation.
12. Detect and persist server-initiated approval requests; never auto-respond.
13. Resume stored threads after backend/browser reconnect without starting duplicate turns.
14. Start explicit follow-up turns in the same thread after stopped/completed turns.

No protocol request field, approval schema, or event payload may be invented.

## 9. Summary / Takeaway Design

### Initial implementation

At task start, add this instruction once:

> Briefly state consequential findings and changes of approach. Separate assumptions from confirmed findings. Avoid narrating routine commands.

Use the agent’s own commentary as the initial takeaway source. Only promote meaningful findings, preserve tentative wording, and link each finding to supporting event IDs.

### Background worker

The later worker reads copied new commentary, relevant completed events, and the previous summary in an independent context. It batches updates with configurable approximately 3-second debounce and approximately 10-second maximum wait. It permits one job per task, bounds input, and returns either no change or a short finding containing the application-level fields `headline`, `explanation`, `sourceEventIds`, `throughSequence`, and `replacesFindingId`.

When a job starts, record its input sequence. Reject any result older than the current summary. On failure, preserve the prior takeaway and continue coding/activity updates.

## 10. Phased Implementation Plan

### Phase 0 — Runtime and protocol reconnaissance

**Status:** Complete.

**Goal:** Resolve runtime and protocol uncertainty before real integration.

**Expected code/configuration areas:** runtime/package setup, Codex version configuration, generated protocol types, local setup documentation.

**Dependencies:** None.

**Work:** Verify Node.js, npm/package manager, SQLite driver options, Codex CLI, exact version, app-server startup, initialization, thread start/resume, turn start/steer/interrupt, event payloads, approval requests, model/auth configuration, and generated TypeScript types.

**Validation:** Linux tooling and the standalone Codex installation are verified. The generated types are regenerated from Linux Codex `0.155.1`. Linux `initialize`/`initialized` succeeds. An authenticated persistent thread/start, real no-file-change turn, `turn/completed`, thread/resume, and cleanup sequence succeeded. One agent-message delta was observed and no duplicate turn was started.

**Demo/checkpoint:** Met. Linux runtime, pnpm, standalone Codex version, generated types, initialization, authenticated turn execution, thread resume, and cleanup are verified. Phase 1 may begin.

### Phase 1 — Recorded-event UI and application data contracts

**Status:** Complete for the recorded-event fixture scope.

**Goal:** Build the progressive-disclosure viewer against recorded pagination events.

**Expected code areas:** React/TypeScript app, shared view-model types, fixture adapter, takeaway/history/activity/evidence/command components, steering visual states, UI tests.

**Dependencies:** Runtime setup; no real Codex process required.

**Work:** Implement current takeaway, activity, next step, collapsed history, explanation/evidence/command expansion, tentative/revised labels, completion result, lifecycle visuals, and stable rendering behavior. Exclude mockup-only controls.

**Validation:** Implemented and verified normalized fixture view models, progressive disclosure, history retention, tentative language, stable expansion state, steering visibility, lifecycle rendering, and completion review. `pnpm typecheck`, `pnpm test` (6 tests), `pnpm build`, `git diff --check`, and the Linux Vite dev-server HTTP checks pass. Desktop browser automation was unavailable in this session, so visual verification was limited to the built/dev-served document and component tests.

**Demo/checkpoint:** Met through fixture URLs with no visible stage/demo controls: `/?fixture=overview`, `/?fixture=steering`, `/?fixture=evidence`, and `/?fixture=complete`. The four states are covered by the fixture model and UI tests. Phase 2 remains intentionally unstarted.

**Phase 1 decisions:** The fixture viewer is a Vite app rooted at `index.html` with source under `apps/web/src`. Fixture selection uses a query parameter for development/demo verification rather than adding mockup stage controls to the product UI. `vite.config.mts` imports `defineConfig` from `vitest/config` so the Vitest test configuration is type-checked correctly.

### Phase 2 — One real app-server task stream

**Status:** Complete for the planned stream foundation; the full pagination walkthrough is gated by Phase 3 approval handling.

**Goal:** Stream one real Codex task through the backend into the UI.

**Expected code areas:** child-process manager, JSONL adapter, request dispatcher, initialization, thread/turn adapter, event normalizer, activity classifier, browser event transport, in-memory state, fake protocol fixtures.

**Dependencies:** Phase 0 and Phase 1 contracts.

**Work completed so far:** Added a typed Linux `codex app-server` child-process client, JSONL request/response routing, typed initialization, thread/start, turn/start, developer instructions, server-request observation without auto-approval, event normalization, activity labels, in-memory task state, SSE snapshots, HTTP task start/health endpoints, Vite API proxying, and a live UI start mode at `/?live=1`. Shared view-model types now live under `shared/src/`.

**Validation:** `pnpm typecheck`, `pnpm server:typecheck`, `pnpm test` (9 tests), `pnpm build`, `pnpm audit --prod`, `pnpm install --frozen-lockfile`, and `git diff --check` pass. The Linux backend health endpoint, live task `POST`, SSE stream, and Vite `/api` proxy were manually verified with a real authenticated no-file-change Codex task that returned `BACKEND_READY`; streamed agent-message deltas were normalized and the task reached `completed`. The fake app-server integration verifies JSONL startup, thread/turn routing, item deltas, activity, completion, and the turn-completion race. A real temporary pagination fixture streamed commentary, command activity, file-edit activity, and then reached an approval request; it was intentionally not auto-approved and was cleaned up without changing the Agent UI repository.

**Demo/checkpoint:** Stream foundation checkpoint met. The controlled real stream and fake app-server integration are verified. Full real pagination completion is intentionally deferred until Phase 3 can surface and route the approval request; no approval was bypassed.

**Phase 2 decisions:** The backend uses Node’s built-in HTTP server and SSE for the first local stream, with no framework or SQLite yet. `/?live=1` is the explicit live-mode entry point; the default route remains deterministic fixture mode. Server-initiated approval requests are observed and mapped to “Waiting for approval or input,” but are not answered in this phase. Steering, interrupt, approval response, persistence, and automatic retry behavior remain deferred.

### Phase 3 — Steering, stopping, approvals, and saved history

**Status:** Complete for the pinned Codex protocol scope. Complex unsupported schemas remain visible and are never answered with fabricated payloads.

**Goal:** Add reliable controls and durable state.

**Expected code areas:** SQLite migrations/repositories, task/thread/turn/event/finding/direction/approval persistence, steering and interrupt state machines, approval router, snapshot/replay API, reconnect handling, idempotency guards, final review UI.

**Dependencies:** Phase 2 real stream and confirmed protocol types.

**Work completed so far:** Added application-level approval state, live approval presentation, explicit approval response endpoint, exact generated response mappings for modern command-execution, file-change, permission-profile, tool user-input, and MCP elicitation approvals, legacy command/patch response mappings, unsupported-request presentation without auto-approval, request-ID matching, and fake app-server approval interaction coverage. Added typed `turn/steer` routing with the active `expectedTurnId`, live steering submission, delivery states, stale-turn follow-up retention, known delivery failure handling, and fake app-server steering coverage. Added typed `turn/interrupt` routing, visible stop control, `stopping` state, completion-confirmed `stopped` state, failed interrupt recovery, and fake app-server interrupt coverage. Added built-in Linux `node:sqlite` migrations and persistence for task snapshots, merged logical events, threads, turns, findings, directions, approvals, and action idempotency records, plus restoration of active saved state as honest `disconnected` state after backend restart. Added sequence-numbered SSE updates, replay-after-cursor support, browser sequence tracking, duplicate-start protection for restored disconnected tasks, persisted working-directory/thread/turn metadata, typed `thread/resume` reconciliation without duplicate `turn/start`, explicit same-thread follow-up turns, and conservative adoption evidence detection. Repeated action IDs return the existing result and do not resend the Codex request. Unsupported complex filesystem-entry and MCP schema variants remain visible without fabricated controls.

**Validation:** `pnpm typecheck`, `pnpm server:typecheck`, `pnpm test` (25 tests), `pnpm build`, and `git diff --check` pass. Tests cover command approval detection, available actions, permission-form presentation, user-input question/answer presentation, MCP form presentation/response, explicit response routing, UI presentation, request-ID matching, steering receipt, adoption confirmation, stale-turn follow-up retention, known delivery failure, steering UI submission, interrupt request/completion separation, retained findings, failed interrupt recovery, logical event merging, restored task snapshots, saved-thread reconciliation without a duplicate turn, repeated steering action suppression, and same-thread follow-up continuation. A runtime smoke check created the ignored SQLite database with built-in `node:sqlite`, started the backend, and served `/api/health` successfully. Sequence-aware replay is covered at the store level. A final real authenticated pagination walkthrough completed in a temporary Linux repository after an explicitly approved file-change request; its four fixture tests passed, including identical-timestamp cursor behavior, and the Agent UI repository remained untouched by the task.

**Demo/checkpoint:** Met. Generated-compatible command/file/permission/user-input/MCP approvals are surfaced and explicitly routed where their schemas are supported; live direction uses `turn/steer` and shows receipt separately from adoption; stopping remains visible until an interrupted completion event arrives; task snapshots and merged events survive store recreation; SSE carries sequence IDs and replay cursors; a restored active thread resumes without a duplicate turn; repeated action IDs do not resend requests; completed tasks can start deliberate follow-up turns in the same thread; later explicit commentary can confirm adoption while ambiguous responses remain pending; and the real pagination walkthrough completed with streamed events and explicit approval.

**Phase 3 decisions:** Approval responses are keyed by the protocol request ID and are never inferred from UI attempts. Modern command/file approvals expose only generated-compatible actions. Unsupported permission/user-input/MCP requests remain visible with no fabricated response controls. Steering delivery uses the active `expectedTurnId`; successful delivery creates a received state only, while later commentary/actions are required for adoption evidence. Explicit questions and disagreement never become adoption. Interrupt success does not transition to stopped until the typed turn-completion event confirms interruption. Persistence uses the Linux Node runtime’s built-in `node:sqlite`; a task restored during backend restart is marked disconnected until typed `thread/resume` confirms an active thread/turn. Browser replay uses the persisted local sequence as the SSE event ID and cursor; restored state is shown before any continuation action is allowed. Action idempotency records are persisted before delivery and completed only after the protocol response succeeds; pending actions are never automatically retried.

### Phase 4 — Background summarization

**Status:** Complete for the current implementation scope; optional real-task finding replacement and visual browser review remain as verification follow-ups.

**Goal:** Add asynchronous summary updates without affecting coding.

**Expected code areas:** summary scheduler, debounce/max-wait config, isolated context adapter, input bounding, validator, stale-result guard, finding replacement/history persistence.

**Dependencies:** Phase 3 event/finding persistence and confirmed independent model invocation strategy.

**Work completed so far:** Added an injectable summary worker with configurable debounce and maximum wait, bounded commentary/event input, one job per task, no-change results, through-sequence tracking, stale-result rejection, and failure isolation. Added a provider-neutral prompt/JSON contract that treats tool output as data, validates provider results, and supports no-change or finding responses. Added an isolated Linux Codex app-server summary provider that uses its own child process/thread, sends no tool/approval requests, returns the summary thread’s agent message, and times out/cleans up safely. Added optional runtime integration that feeds commentary/completed events to the worker and persists accepted background findings into the existing current/history finding model. The live backend still does not configure an external summary provider by default.

**Validation so far:** `pnpm typecheck`, `pnpm server:typecheck`, `pnpm test` (33 tests), `pnpm build`, and `git diff --check` pass. Summary tests cover debounce batching, one job per task, bounded inputs, stale findings, no-change behavior, provider prompt/result validation, isolated Codex-provider routing, runtime finding replacement/history, timeout cleanup, and runner failure isolation. Opt-in real-provider smoke runs started independently, coding turns completed normally, isolated summary turns completed, and the provider returned accepted `no-change` results for controlled sequences; a previous bounded run timed out safely. The final real edge-case task completed with explicit approval and the Agent UI repository remained untouched. An isolated real-provider contract probe also returned an accepted consequential finding with source event ID and through-sequence 42.

**Demo/checkpoint:** Provider and runtime checkpoint met through deterministic, fake app-server, live no-change, and isolated real-provider finding runs. Routine/no-change, consequential finding replacement via injected and real providers, stale-result, bounded data context, isolated provider routing, timeout cleanup, and failure behaviors are tested without sending summary prompts into the coding turn. Live task-level no-change is verified, and the real provider contract has produced a validated consequential finding.

## 11. Testing Strategy

Cover the following categories:

- Event ingestion: parsing, ordering, sequence allocation, item merging, streamed messages, plan/diff/completion events, generic activity fallback.
- State transitions: waiting, running, stopping, stopped, failed, completed, disconnected, reconciliation, explicit follow-up.
- Steering: success, failure, turn-ended-before-delivery, uncertain result, adoption confirmation, disagreement/question.
- Interrupt: request versus completion, failure, retained edits, same-thread continuation.
- Approvals: detection, persistence, presentation, explicit response, no bypass, reconnect reconciliation.
- Persistence: refresh restoration, reconstruction, sequence replay, history/replacement links, direction/approval state.
- Reconnection: existing state, no duplicate task/events/actions, missed-event replay.
- Summary worker: debounce, maximum wait, one job, input bounds, no change, stale protection, failure isolation.
- UI: progressive disclosure, stable expansion/focus/scroll, history, lifecycle states, usable steering.
- End-to-end: fake app-server pagination walkthrough and real streamed Codex pagination task.

## 12. Risks and Open Questions

1. **Codex authentication/storage:** resolved for the pinned Linux CLI and controlled thread/turn/resume probe; re-check if credentials or Codex version changes.
2. **Linux runtime/native dependencies:** resolved for the current implementation; Linux Node, pnpm, SQLite CLI, and built-in `node:sqlite` are available.
3. **SQLite driver:** resolved with built-in Linux Node `node:sqlite`; no native package is required.
4. **Protocol version:** resolved for now by pinning standalone Linux Codex `0.155.1` and generating types; revisit only with an intentional version change.
5. **Approval schema:** generated types expose distinct command, file-change, permissions, tool-input, and MCP elicitation requests; inspect real traces before final UI semantics.
6. **Instruction field:** generated `ThreadStartParams` exposes `developerInstructions`; use the typed field after validating desired thread/turn behavior.
7. **Model/auth configuration:** configure outside source control.
8. **Summary invocation:** resolved with an opt-in isolated Codex app-server provider; live provider finding replacement remains optional verification.
9. **Process restart semantics unknown:** reconcile existing turns and never auto-start a duplicate.
10. **Repository path/launch configuration unknown:** define a safe local configuration.
11. **Diff/file review source unknown:** verify installed event payloads and file access requirements.
12. **Sensitive event data:** keep databases/logs/task data out of source control and consider output bounds/redaction.
13. **Browser transport choice:** select SSE or WebSocket after evaluating the chosen backend setup; replay/idempotency requirements are mandatory either way.

## 13. Definition of Done

- A new reader can explain the current approach without opening commands.
- Findings expand into evidence and retain earlier versions.
- Direction can be sent while the agent works; receipt and adoption are distinct.
- Slow or failed summaries do not delay execution or overwrite newer findings.
- Stop, completion, failed delivery, approvals, and reconnects behave correctly.
- Refresh restores the same task without duplicate actions.
- Pagination works end to end with real streamed events.
- Waiting, stopped, failed, completed, and disconnected states are explicit.
- Tentative claims remain tentative and no progress percentages are fabricated.
- Commands remain hidden unless requested.
- Open detail sections, focus, and reading position remain stable during streaming.
- No secrets, credentials, local databases, runtime logs, or private task data are committed.

## 14. Change/Completion Tracking

Each meaningful implementation step must:

1. Inspect changed files.
2. Run the relevant tests/checks.
3. Update this plan with completed work or a justified deviation.
4. Mark completed phases clearly.
5. Document architectural decisions and important deviations.

Do not begin the next phase until the current phase checkpoint has been verified.

Current completion markers:

- Phase 0 — complete: Linux runtime, authenticated Codex protocol probe, thread resume, and cleanup verified.
- Phase 1 — complete for recorded-event fixtures: UI, progressive disclosure, lifecycle presentation, tests, and build verified; desktop browser automation was unavailable.
- Phase 2 — stream foundation complete: typed bridge, live HTTP/SSE path, controlled authenticated stream, fake integration, and approval-boundary verification complete; the real pagination walkthrough was completed during Phase 3.
- Phase 3 — complete for pinned protocol scope: approval detection/response, steering receipt/failure/follow-up behavior, interrupt/stopping lifecycle, SQLite snapshot/event persistence, sequence-aware browser replay, active-thread reconciliation, action idempotency, same-thread continuation, adoption evidence, and final real walkthrough complete.
- Phase 4 — complete for current implementation scope: isolated summary scheduling, batching, bounds, provider contract validation, isolated Codex provider routing, timeout cleanup, stale-result protection, no-change handling, failure isolation, optional runtime finding integration, and real-provider contract verification complete; optional live-task replacement and visual browser review remain.
