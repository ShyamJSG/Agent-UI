# Project Instructions

- `instructions/Instructions.md` is the original task specification and primary product source of truth.
- `README.md` is the public setup and architecture overview.
- `PLAN.md` is the current implementation plan. Follow it unless a technical reason requires a change.
- `PROJECT_STATE.md` is the concise handoff snapshot for a new OpenCode session.
- This project runs in WSL/Linux. Use only Linux binaries, package managers, and dependencies; never use Windows Node, npm, paths under `/mnt/c`, or Windows-installed packages.
- Important plan changes, architectural decisions, deviations, and completed phases must be reflected in `PLAN.md`.
- Never guess Codex app-server protocol fields, event payloads, request schemas, or approval responses. Use generated types from the pinned installed Codex version.
- After every meaningful implementation step, inspect changed files and run the relevant tests/checks.
- Do not begin a later phase until the current phase checkpoint is verified.
- Mark completed phases clearly and record remaining work.
- Keep secrets, credentials, local SQLite data, runtime logs, and private task data out of source control.
- Use the screenshots as visual references only; do not implement mockup-only demo controls as product features.
