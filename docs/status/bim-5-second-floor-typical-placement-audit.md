# BIM-5 audit: current 2nd-floor typical riser placement logic

Date: 2026-05-03
Scope: audit-only, no production behavior changes.

## Outcome

This document maps the current end-to-end flow used by BIMPipe to place risers from a "typical" floor (currently biased to floor 2), duplicate them across storeys, allow manual edits, and pass results into IFC export.

## 1) Riser placement entry points

Primary entry points are in `src/pages/WorkspacePage.tsx`:

- `handleFileAccepted(...)` loads IFC and chooses a default storey via `findDefaultStoreyId(...)`.
- `openStorey(...)` loads geometry and detects fixtures/kitchens for the selected storey.
- `handleSuggestRisers(...)` is the user-triggered auto-placement entry point.
- `buildSuggestedRisers(...)` calls `suggestRiserPositions(...)` and expands each suggested plan point into a full vertical stack via `buildRiserStack(...)`.
- `handleAddRiser(...)`, `handleMoveRiser(...)`, and `handleRemoveRiser(...)` are manual override entry points.

Current behavior: riser auto-placement does **not** run automatically after detection; it runs only when user clicks Suggest/Place.

## 2) How the typical floor is selected

Typical floor selection currently happens in `findDefaultStoreyId(...)` and helpers in `src/pages/WorkspacePage.tsx`.

Mechanism:

1. Every parsed storey is scored by `getSecondFloorMatchScore(...)`.
2. Score requires a numeric token `2` in the storey name (`extractSignedNumericTokens(...)`).
3. Basement-like names are excluded (`isBasementStoreyName(...)`).
4. Remaining candidates get higher score for above-ground keywords (`hasAboveGroundFloorKeyword(...)`) and non-negative elevation.
5. Best score wins; ties are resolved by lower elevation.

Implication: this is a **name/elevation heuristic**, not a true typology/classification pipeline.

## 3) How toilet fixtures are detected

Detection path:

- `openStorey(...)` calls `detectFixtures(...)` and `detectKitchens(...)` in parallel.
- `detectFixtures(...)` (in `src/shared/ifc/detectFixtures.ts`) scans storey elements, derives fixture kind from IFC class/text, computes positions, and deduplicates nearby low-confidence duplicates.
- In `WorkspacePage`, detected fixtures are narrowed to toilets only:
  - `const toiletFixtures = fixturesResult.filter((fixture) => fixture.kind === 'TOILETPAN')`
  - `setFixtures(toiletFixtures)`

Important detail:

- Although `detectFixtures(...)` can classify many fixture kinds, auto-placement input in the page-level flow keeps only TOILETPAN fixtures for the `fixtures` state.
- Kitchens are fed separately via `kitchens` state and later merged into riser suggestion logic.

## 4) How riser candidates are created

Candidate generation is centralized in `src/shared/routes/suggestRisers.ts` via `suggestRiserPositions(fixtures, kitchens, floorPlanBounds)`.

Current strategy:

- If toilets exist: return one dedicated riser per toilet + dedicated kitchen risers.
- If no toilets: cluster non-kitchen-sink fixtures and derive count/centroids with bounded clustering / k-means fallback.
- Kitchen risers are corner-biased using kitchen geometry and floor bounds when available.

Then `buildSuggestedRisers(...)` in `WorkspacePage` converts 2D/plan suggestions into full building stacks:

- Calls `buildRiserStack(...)` (`src/shared/routes/buildRiserStacks.ts`).
- One stack ID per suggestion.
- Duplicates that stack across **all storeys** using same X/Z and per-storey Y computed from storey elevation + source-floor vertical offset.

## 5) How existing risers are detected, reused, duplicated, or skipped

There is no IFC-native "existing riser detection" or geometric merge with already-modeled pipes in this flow.

Current app-level behavior:

- **Reuse in-session/manual edits**: risers persist across floor selection (`openStorey` intentionally does not clear risers).
- **Duplication across floors**: every suggested/manual seed point is expanded to all storeys by `buildRiserStack(...)`.
- **Resuggest behavior**: `handleSuggestRisers(...)` resets labels and replaces current risers with a fresh generated set.
- **Deletion**: removing one riser removes entire stack across floors via `removeRiserStack(...)`.
- **Move**: moving one riser propagates X/Z to all members of same stack, preserving each member's Y.
- **Skip conditions**: suggest is a no-op when no selected storey or when both fixtures and kitchens are empty.

## 6) Where IFC export receives generated risers

Export entry is `handleDownloadIfc(...)` in `WorkspacePage`.

- It passes full `risers` state (all floors, not current floor only) to:
  - `exportFullIfcWithRisersWithDebug(...)` in `src/shared/ifc/exportFullIfcWithRisers.ts`.
- Export groups risers by stack, computes bottom/top storeys, writes one continuous riser element per stack, and returns IFC bytes + debug mapping artifact.

So export consumes the same in-memory riser stacks produced/edited in workspace flow.

## 7) Current data flow (concise map)

`upload -> parseStoreys -> findDefaultStoreyId(2nd-floor heuristic) -> openStorey -> detectFixtures/detectKitchens -> filter TOILETPAN fixtures -> suggestRiserPositions -> buildRiserStack(all storeys) -> manual add/move/remove stack ops -> exportFullIfcWithRisersWithDebug`

## 8) Weak points and known limitations

1. Typical floor selection is lexical heuristic around "2" rather than configurable rule profile.
2. No explicit floor class model (standard/basement/roof/penthouse) used by placement/export.
3. Auto-stack expansion assumes suggested shaft applies to all storeys uniformly in X/Z.
4. Non-standard floors (setbacks, shifted cores) are not represented in stack generation logic.
5. Existing IFC plumbing/riser reuse is not currently inferred before creating BIMPipe risers.
6. Resuggest replaces riser set; preservation logic is stack-level manual editing, not rule-aware diffing.

## 9) Foundation recommendations for BIM-6 / BIM-7 (no behavior change here)

For BIM-6 (configurable rule profile):

- Extract `findDefaultStoreyId/getSecondFloorMatchScore` into a placement-profile module with explicit inputs/outputs and deterministic tests.
- Introduce rule-profile object for:
  - default-storey selection policy,
  - stack propagation scope (all floors vs selected class),
  - kitchen/toilet weighting switches.

For BIM-7 (floor classification):

- Add a normalized floor classification stage immediately after `parseStoreys`.
- Persist `storeyClass` metadata (e.g., `standard | basement | roof | penthouse | unknown`) and use it in default floor selection and later stack propagation policy.
- Keep classification separate from suggestion geometry module to preserve separation of concerns.

## 10) Files reviewed in this audit

- `src/pages/WorkspacePage.tsx`
- `src/shared/ifc/detectFixtures.ts`
- `src/shared/ifc/detectKitchens.ts`
- `src/shared/routes/suggestRisers.ts`
- `src/shared/routes/buildRiserStacks.ts`
- `src/shared/ifc/exportFullIfcWithRisers.ts`
- `src/shared/ifc/parseStoreys.ts`
