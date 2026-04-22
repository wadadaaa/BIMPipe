# BIMPipe Agent Contract

## Project

BIMPipe

## Mission

Build a web-first MVP for sanitary / drainage planning from IFC models.

## V0 scope

The first production slice is intentionally narrow:

1. Upload a single IFC file
2. Parse the IFC model
3. Detect toilets and kitchens
4. Automatically place risers
5. Allow manual riser repositioning
6. Export / download the resulting IFC

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

Important:

- There is currently no separate `typecheck` script.
- TypeScript checking currently happens via `pnpm build` because it runs `tsc -b`.

## Product rules

- Optimize for correctness and deterministic behavior over cleverness.
- Manual override must always win over auto-placement.
- Keep parsing, normalization, domain logic, viewer, and export separated.
- Do not silently assume units, floors, coordinate systems, or fixture naming.
- Prefer explainable heuristics over opaque automation.
- Never claim IFC export works end-to-end unless it was validated.

## Architecture bias

Prefer this flow:

`upload -> parse -> normalize -> detect -> place -> manual override -> render -> export`

Keep these concerns separate:

- `src/features`: user-facing flows like upload, placement, export
- `src/domain`: pure domain logic and algorithms
- `src/entities`: shared domain models and types
- `src/viewer`: Three.js scene, selection, drag interactions
- `src/app`, `src/pages`, `src/widgets`: app composition and screen wiring
- `src/shared`: generic shared utilities only

## Domain rules

- Use explicit types.
- Keep units explicit in names and logic.
- Keep toilet/kitchen detection centralized and testable.
- Keep riser placement logic pure and deterministic where possible.
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

## UI rules

The user should always be able to tell:

- whether upload succeeded
- whether parsing succeeded
- what fixtures were detected
- where risers were auto-placed
- what was changed manually
- whether export is ready or blocked

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
3. Trace the current flow for upload, parse, detect, place, override, export
4. Implement the smallest end-to-end slice first
5. Add or update tests for meaningful domain changes
6. Run relevant validation commands
7. Summarize what changed, what was verified, and what remains risky

## Testing expectations

Prioritize tests for:

- toilet detection
- kitchen detection
- floor grouping
- riser auto-placement
- manual override precedence
- export preparation logic
- IFC structural validity for exported files when touched

Prefer pure-function tests where possible.

## Safety and honesty

- Never fabricate repo structure, command output, or test results.
- Never say export works unless it was actually exercised.
- Call out assumptions clearly.
- If a heuristic is approximate, say so.
- If validation was skipped, say so.

## Definition of done

A task is done only when:

- the requested behavior exists
- the code is readable and fits repo conventions
- relevant tests were added or updated
- `pnpm lint`, `pnpm test`, and `pnpm build` were run when applicable
- remaining risks are explicitly called out

## Final response structure

When finishing a task, use:

1. Outcome
2. Files changed
3. Validation performed
4. Risks / follow-ups
