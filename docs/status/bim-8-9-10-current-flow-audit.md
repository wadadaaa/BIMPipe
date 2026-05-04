# BIM-8/BIM-9/BIM-10 audit: current fixture-to-riser flow and implementation foundation

## Scope

Audit-only continuation from BIM-5. This document inspects current implementation points needed for:

- **BIM-8:** detect toilet rooms and plumbing fixtures on all relevant floors
- **BIM-9:** build vertical wet-room and riser groups
- **BIM-10:** decide riser strategy per toilet room

No production placement behavior is changed in this issue.

## 1) Current entry points

### Upload → parse storeys

- `WorkspacePage.handleFileAccepted` parses storeys and selects a default floor. (`src/pages/WorkspacePage.tsx`)
- IFC storey parsing is centralized in `parseStoreys`. (`src/shared/ifc/parseStoreys.ts`)

### Floor open → detection

- `WorkspacePage.openStorey` lazily loads:
  - `extractFloorMeshes`
  - `detectFixtures`
  - `detectKitchens`
- Toilets are currently narrowed to `fixture.kind === 'TOILETPAN'` before being stored in UI state.

### Manual trigger → placement

- `WorkspacePage.handleSuggestRisers` calls `buildSuggestedRisers` only for selected floor detections.
- `buildSuggestedRisers` calls `suggestRiserPositions(fixtures, kitchens, bounds)` and then `buildRiserStack(...)` for each suggested position.

### Stack lifecycle

- add: `buildRiserStack`
- move: `handleMoveRiser` propagates X/Z across stackId
- delete: `removeRiserStack`

### Export handoff

- Download handler calls `exportFullIfcWithRisersWithDebug(...)` with full `risers` array and selected storey metadata.

## 2) BIM-8 status (toilet rooms + fixtures on relevant floors)

### What exists now

- Fixture detection currently happens **only for the selected storey** during `openStorey`.
- Toilet-like fixtures are filtered to `TOILETPAN` in `WorkspacePage`.
- Kitchen areas are detected separately via `detectKitchens`.

### Gaps vs BIM-8

1. No multi-floor detection pass.
2. No explicit toilet-room entity/model; only fixture points + kitchen areas.
3. No storey-level relevance filtering pipeline that combines floor class + fixture evidence.
4. No persisted detection graph usable by later strategy decisions.

## 3) BIM-9 status (vertical wet-room + riser grouping)

### What exists now

- Vertical behavior is currently stack propagation by `buildRiserStack` across all storeys.
- Group identity is `stackId`; geometry is duplicated per storey with shared X/Z intent.

### Gaps vs BIM-9

1. No wet-room grouping model (horizontal room groups or vertical clusters).
2. No alignment/offset tolerance model for shifted fixtures between floors.
3. No grouping confidence or reasons for why floors are tied together.
4. No policy boundary between existing riser reuse and new riser generation.

## 4) BIM-10 status (per-room riser strategy)

### What exists now

- Strategy is implicit and global:
  - generate from selected floor suggestions,
  - duplicate across all storeys.
- Manual override precedence is preserved by direct user add/move/remove operations.

### Gaps vs BIM-10

1. No explicit strategy type per toilet room/group (reuse existing / generate new / skip).
2. No decision log/reasoning object for explainability.
3. No exceptions policy wiring at room/group level (e.g., non-standard floors).
4. No orchestration stage that converts grouped rooms into strategy decisions before stack creation.

## 5) Minimal implementation foundation recommended next

### BIM-8 incremental foundation

1. Add a pure detection aggregator to run `detectFixtures`/`detectKitchens` across eligible storeys and return typed per-storey summaries.
2. Introduce typed `DetectedToiletCluster`/`DetectedWetArea` entities in domain layer (still heuristic, explainable fields).
3. Keep UI behavior unchanged initially by consuming only selected storey slice while persisting all-storey detection results for debug.

### BIM-9 incremental foundation

1. Add pure `groupWetAreasVertically(...)` module in `src/shared/routes` (or `src/domain`) with deterministic tolerance config.
2. Output typed `VerticalWetGroup[]` with member storeys + centroid/extent + confidence reasons.
3. Keep current stack builder untouched; add adapter that can later feed it from group results.

### BIM-10 incremental foundation

1. Add typed strategy enum/object:
   - `reuse-existing-riser`
   - `generate-new-riser`
   - `skip-auto-generation`
2. Add `decideRiserStrategyForGroup(...)` pure function using profile + floor class + detection/group evidence.
3. Emit debug snapshot (profile, floor class map, group ids, chosen strategy reasons) without changing placement output until fully adopted.

## 6) Risk notes

- Current selected-floor-only detection makes cross-floor correctness fragile for non-typical layouts.
- Current stack duplication to all floors can over-generate risers in excluded/exception floors unless guarded by strategy stage.
- Without explicit grouping + strategy decisions, behavior is hard to audit and tune.

## 7) Suggested file touch plan for next implementation PRs

- BIM-8:
  - `src/shared/ifc/` detection aggregation module + tests
  - `src/domain/types.ts` typed detection/grouping entities
  - `src/pages/WorkspacePage.tsx` non-breaking integration + debug output
- BIM-9:
  - `src/shared/routes/` (or `src/domain/`) vertical grouping module + tests
- BIM-10:
  - `src/shared/routes/` strategy decision module + tests
  - wiring in `WorkspacePage`/placement pipeline once validated
