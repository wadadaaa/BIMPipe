# Agent HQ controlled real execution note

This note records the intended safety envelope for small Agent HQ Hermes smoke-test tasks such as `hermes_linear_demo_autopilot`.

## Smoke-test workflow

1. Agent HQ sync should create exactly one runnable task for the selected Linear issue and task type.
2. Hermes completes safe planning before making any real repository changes.
3. Real execution happens in an isolated issue worktree, not directly on `main`.
4. The first real execution smoke test should be docs-only unless the Linear issue explicitly asks for product code.
5. Validation must run before any commit or PR handoff.
6. If a PR is opened, Hermes stops at human review and merge; it must not merge or deploy.

## Boundaries

- Do not modify product/runtime code for docs-only smoke tests.
- Do not modify secrets, `.env`, authentication files, local run state, or deployment state.
- Do not push directly to `main`.
- Treat unclear scope as a stop condition rather than expanding the task.
