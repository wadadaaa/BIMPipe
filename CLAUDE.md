# BIMPipe Agent Contract

## Project

BIMPipe

## Mission

Build a web-first MVP for sanitary / drainage planning from IFC models. The product takes an architect's IFC, detects sanitary fixtures, proposes vertical risers, lets the engineer adjust them, and returns an enriched IFC for downstream use in Revit or other BIM tools. BIMPipe is a scalpel inside an existing BIM pipeline, not a replacement for Revit.

## V0 scope

The first production slice is intentionally narrow:

1. Upload a single IFC file
2. Parse the IFC model
3. Normalize units, coordinates, and fixture types
4. Detect toilets and kitchens
5. Automatically place risers with vertical alignment across floors
6. Allow manual riser repositioning
7. Validate coverage and conflicts before export
8. Export / download the resulting IFC (plumbing-only or full)

### Explicitly out of V0

- Backend, authentication, multi-user
- Persistence beyond the active session
- Sharing, collaboration, comments
- Billing, plans, paywalls
- HVAC, electrical, or non-sanitary systems
- Batch processing of multiple IFC files
- Public landing, pricing page, marketing site
- API access for third-party integrations

If a task touches anything in this list, stop and confirm before proceeding.

## Stack

- React
- TypeScript
- Vite
- Three.js
- web-ifc
- Zod
- Vitest
- ESLint

## Package manager

Prefer `pnpm` in this repository.

## Commands

Use the repo scripts exactly as they exist:

- `pnpm dev`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm preview`

Notes:

- There is currently no separate `typecheck` script.
- TypeScript checking currently happens via `pnpm build` because it runs `tsc -b`.

## Product rules

- Optimize for correctness and deterministic behavior over cleverness.
- Manual override must always win over auto-placement.
- Keep parsing, normalization, domain logic, viewer, and export separated.
- Do not silently assume units, floors, coordinate systems, or fixture naming.
- Prefer explainable heuristics over opaque automation.
- Never claim IFC export works end-to-end unless it was validated.
- Every failure path must be visible to the user with a reason, not a silent no-op.

## Architecture bias

Prefer this flow:

`upload -> parse -> normalize -> detect -> place -> manual override -> validate -> render -> export`

Keep these concerns separate:

- `src/features`: user-facing flows like upload, placement, export
- `src/domain`: pure domain logic and algorithms
- `src/entities`: shared domain models and types
- `src/viewer`: Three.js scene, selection, drag interactions
- `src/app`, `src/pages`, `src/widgets`: app composition and screen wiring
- `src/shared`: generic shared utilities only

## Normalization

Normalization is a first-class step, not optional cleanup. After parse and before any downstream domain logic:

- Convert all length units to meters. Do not propagate IFC unit metadata further down the pipeline.
- Resolve all coordinates to a single project reference frame. Document which one in the normalized model.
- Map raw IFC entity names to a canonical set of fixture types (`Toilet`, `Kitchen`, `Sink`, etc). Detection consumers never look at raw entity strings.
- Group elements by floor using `IfcBuildingStorey`, with explicit handling for elements not assigned to a storey (do not drop them silently).

Downstream code is allowed to assume normalized data. It is not allowed to defensively re-check units or re-parse coordinates.

## Unknown / ambiguous input policy

When the IFC file lacks information needed for correctness:

- **Unknown length unit**: block the flow. Show an explicit prompt asking the user to confirm units. Do not assume meters.
- **Missing coordinate reference**: block the flow. Show an explicit prompt or error.
- **No `IfcBuildingStorey`**: block the flow. The product is floor-based and cannot operate without storey information.
- **No detectable toilets and no detectable kitchens**: allow flow to continue but show a clear empty-state explaining nothing was detected, with the option to retry detection or replace the model.
- **Detected fixture without a storey**: surface as a validation warning, do not silently exclude.

Block means a clear UI state with a reason, not an alert or a console error.

## Persistence policy

V0 is single-session and in-memory only.

- No `localStorage`, `sessionStorage`, or `IndexedDB`.
- No backend, no auth, no project save/load.
- Refreshing the page restarts the flow from upload. This is intentional and must be communicated to the user with a small notice on the upload screen.

When persistence is added later, it will be a deliberate scope expansion with its own contract update.

## Manual override semantics

Auto-placed risers and manual overrides are stored separately and merged at render and export time:

- Each auto-placed riser has a stable ID derived deterministically from the input IFC.
- A manual override is keyed by the auto-riser ID it replaces, or marked as a user-added riser with no auto counterpart.
- Final riser set = (auto risers without an override) + (manual overrides) + (user-added risers).
- Re-suggest replaces only auto risers that have no override. Overrides and user-added risers are preserved.
- A destructive action that would discard overrides (full reset, model replace) requires explicit confirmation.

This rule is the heart of `manual override must always win`. Any code path that violates it is a bug.

## Vertical alignment invariant

Risers represent physical vertical shafts through the building. Therefore:

- A riser at position (x, y) on one floor implies the same (x, y) on every other floor where the shaft is present.
- Moving a riser on floor N moves it on all floors that share that shaft, by default.
- Breaking vertical alignment for a specific floor is an advanced action that requires explicit user intent and a visible indicator.
- Validation must flag risers that drift out of alignment.

The UI must always show whether vertical alignment is locked or broken for the active riser.

## Domain rules

- Use explicit types.
- Keep units explicit in names and logic (e.g. `lengthM`, not `length`).
- Keep toilet/kitchen detection centralized and testable.
- Keep riser placement logic pure and deterministic where possible. Same input IFC must produce identical riser positions, IDs, and ordering.
- Store manual overrides separately from automatic suggestions.
- Keep export preparation and IFC serialization logic separate from UI components.

## Engineering rules

- Prefer small, composable modules.
- Avoid `any` unless isolated at a boundary.
- Use Zod where external or parsed data needs validation.
- Do not put heavy parsing or placement logic inside React components.
- Do not put placement rules inside viewer scene objects.
- Reuse existing abstractions before adding new ones.
- Preserve current repo structure unless there is a strong reason to change it.

## Performance and limits

V0 supported envelope:

- IFC files up to 50 MB
- Up to roughly 500,000 IFC entities
- Up to 30 storeys

Files outside this envelope must produce an explicit error with a clear message before parsing begins, not a frozen tab. Parse and detection should be cancellable from the UI for files that take longer than 10 seconds.

## Internationalization and RTL

- All UI chrome (buttons, labels, status text, errors) is authored in English in source code. No hardcoded Hebrew strings in JSX.
- User-derived data from the IFC (floor names, fixture labels, project names) is rendered in its source language without translation. Hebrew floor names like `קומה 2` are passed through untouched.
- Mixed-direction text uses `dir="auto"` on the rendering element so Hebrew renders RTL inside an otherwise LTR UI without layout breakage.
- A future translation layer will replace English literals with i18n keys. Until then, keep strings consistent and avoid splitting them across components.

## UI rules

The user must always be able to tell:

- whether upload succeeded, and if it failed, why
- whether parsing succeeded, and if it failed, on which entity or step
- what fixtures were detected (with a clear empty state if none)
- where risers were auto-placed
- what was changed manually
- whether vertical alignment is locked or broken for the active selection
- whether export is ready or blocked, and which validation rule blocked it

Every long-running operation (parse, suggest, export) must show progress or be cancellable. No silent spinners that exceed 10 seconds.

## Validation before export

Before enabling export, run validation and surface the result. Validation rules in V0:

- Every detected toilet has a riser within a reasonable horizontal distance on its floor.
- Every detected kitchen has a riser within a reasonable horizontal distance on its floor (warning, not block).
- All risers are vertically aligned across the floors they span, or explicitly marked as misaligned by the user.
- No two risers occupy the same position on the same floor.

Each violation is shown with the floor, the affected fixture or riser, and a one-line reason.

## Orchestration rules

Use the lightest coordination model that solves the task.

### Main agent only

Use when:

- the task is small
- changes are isolated
- no parallel research is needed

### Specialized agents

Use when:

- repo exploration would flood context
- IFC parsing and UI flow need separate investigation
- placement logic needs focused review
- test or regression review is needed

## Recommended agent roles

- planner
- repo-researcher
- ifc-engineer
- placement-engineer
- viewer-builder
- qa-reviewer

## Default execution protocol

For non-trivial work:

1. Restate the requested outcome and acceptance criteria
2. Inspect the repo before proposing structural changes
3. Trace the current flow for upload, parse, normalize, detect, place, override, validate, export
4. Implement the smallest end-to-end slice first
5. Add or update tests for meaningful domain changes
6. Run relevant validation commands
7. For UI-touching changes, run `pnpm dev` and exercise the affected flow manually
8. Summarize what changed, what was verified, and what remains risky

## Testing expectations

Prioritize tests for:

- toilet detection
- kitchen detection
- floor grouping, including elements without a storey
- riser auto-placement
- vertical alignment across floors
- manual override precedence and merge logic
- re-suggest preserving overrides and user-added risers
- export preparation logic
- IFC structural validity for exported files when touched
- determinism: snapshot test for `same input IFC -> same risers (positions, IDs, ordering)`

Prefer pure-function tests where possible.

## Safety and honesty

- Never fabricate repo structure, command output, or test results.
- Never say export works unless it was actually exercised end-to-end.
- Call out assumptions clearly.
- If a heuristic is approximate, say so.
- If validation was skipped, say so.

## Definition of done

A task is done only when:

- the requested behavior exists
- the code is readable and fits repo conventions
- relevant tests were added or updated
- `pnpm lint`, `pnpm test`, and `pnpm build` were run when applicable
- for UI-touching changes, the affected flow was manually exercised in `pnpm dev`
- remaining risks are explicitly called out

## Final response structure

When finishing a task, use:

1. Outcome
2. Files changed
3. Validation performed (lint, test, build, manual smoke-check)
4. Risks / follow-ups