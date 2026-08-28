# Goal progress — T0/T1/T2/T3-core

Branch: `goal/t0-t3-routing` · Started: 2026-08-28 · Status legend: ⏳ pending · 🔄 in progress · ✅ done · ⛔ blocked

| Task | Status | Notes |
| --- | --- | --- |
| Setup (deps, baseline lint+test) | 🔄 | |
| T0 — Export round-trip test | ✅ | commit `b381bd4`; ADAM_10 coverage pending asset (see Blockers) |
| T1 — Un-gate routes from demo mode | ✅ | commit `016a92d` |
| T2 — All fixture kinds + nearest-riser assignment | 🔄 | started after T1 green |
| T3 core — Branch routing geometry (src/domain) | ⏳ | |
| T3 — Viewer wiring (2D/3D, per-floor toggle) | ⏳ | starts after T2 + T3 core |
| Final verification (`pnpm lint && pnpm test` full) | ⏳ | |

## Baseline (clean `main`, c3e6d80, 2026-08-28 22:11)

- `pnpm install`: OK (pnpm 11.15.1, node 24.18.0)
- `pnpm lint`: 0 errors, 1 pre-existing warning (`FloorViewer.tsx` react-hooks/exhaustive-deps) — left as-is
- `pnpm test`: **2 failed** / 246 passed (31 files). Pre-existing failures in `src/domain/decideRiserStrategyPerToiletRoom.bim11.test.ts`: code prefixes inherited coverage reasons with `"inherits exception coverage from primary member: "`, tests expect the bare reason string. Reconciliation assigned to the domain worker (separate `baseline:` commit) since a green suite is required by the DoD.

## Milestones

### T0 — Export round-trip test ✅ (2026-08-28 22:17, commit `b381bd4`)

- New `src/shared/ifc/exportFullIfcWithRisers.roundtrip.test.ts` (199 lines, no production code changed): exports 2 riser stacks over 2 storeys with the real web-ifc engine, reopens the bytes with a fresh `IfcAPI`, asserts schema round-trip, segment count == stack count (`IfcFlowSegment` on IFC2X3 / `IfcPipeSegment` on IFC4), `Pset_FlowSegmentOccurrence` + `Qto_PipeSegmentBaseQuantities` linkage, `BIMPipe Sanitary Stacks` system; IFC2X3 additionally 2 `IfcPipeSegmentType` with `Pset_PipeSegmentTypeCommon`; IFC4 pins the TODO(BIM-51) gap (0 type psets) so closing it later must update the test deliberately.
- Focused runs: roundtrip 2/2 passed; all 4 export test files 25/25 passed. Coordinator re-ran roundtrip independently: 2/2 passed (822ms).
- Corruption proof: temporary `stackGroups.slice(0, 1)` mutation → both tests failed (`expected [ 96 ] to have a length of 2 but got 1`); mutation reverted (empty `git diff` on the exporter), tests green again.
- The hardcoded `#24` body-context lookup did not need replacement (fixture exercises it as-is).
- ADAM_10 clause skipped: asset not on machine (see Blockers).

### T1 — Un-gate routes from demo mode ✅ (2026-08-28 22:21, commit `016a92d`)

- Route computation runs in plain dev: new exported `buildSanitaryRoutingPlan(fixtures, risers, modelFileName)` in `buildSanitaryRoutes.ts` carries the previous planner body verbatim; `buildSanitaryRoutingDemoPlan` is now a thin demo-asserting wrapper (byte-identical demo behavior). `WorkspacePage` memo short-circuit on `!demoRuntime.enabled` removed.
- No viewer/sidebar changes needed: route lines + routes chip were already ungated; `RisersPanel` already surfaces limitations when demo is off. New component test proves dev surfacing (upload `anytower.ifc`, place risers, `routes:1`, routing preview notes visible, demo section absent).
- Tests: +4 planner tests (incl. deep-equality parity demo vs non-demo on identical inputs), +1 WorkspacePage dev-flow test. Focused runs 41/41 green; zero existing assertions changed. `pnpm build` green. Coordinator re-ran 26/26 green.
- Noted for T2/T3: suggested toilet risers coincide with toilets, so toilet routes are degenerate until risers move — pre-existing planner behavior now visible in dev; dev exports now include routes in debug JSON (intended).

## Blockers

- `ADAM_10.ifc` is not present on this machine (`external/demo-assets/` does not exist; disk searched). T0's ADAM_10 clause and T2's "on ADAM_10" acceptance are deferred until the asset is placed at `external/demo-assets/ADAM_10.ifc`. Fixture/sample IFCs are used meanwhile.

## Sample assets (local-only, gitignored under `external/`)

Downloaded 2026-08-28 from buildingSMART Community-Sample-Test-Files (Duplex Apartment, IFC2X3, Revit exports) for live verification:

- `external/samples/Duplex_A_20110907.ifc` (2.3 MB, architecture; 4 storeys, 21 spaces, keyword-detectable fixtures)
- `external/samples/Duplex_MEP_20110907.ifc` (17 MB, MEP; **105 `IfcFlowTerminal` entities** — best for detection/routing verification)
- `external/samples/Duplex_Plumbing_20121113.ifc` (30 MB, plumbing distribution; no terminals)

## Screenshots

_(added per milestone under `docs/progress/`)_
