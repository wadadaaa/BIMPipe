# Goal progress — T0/T1/T2/T3-core

Branch: `goal/t0-t3-routing` · Started: 2026-08-28 · Status legend: ⏳ pending · 🔄 in progress · ✅ done · ⛔ blocked

| Task | Status | Notes |
| --- | --- | --- |
| Setup (deps, baseline lint+test) | 🔄 | |
| T0 — Export round-trip test | ⏳ | ADAM_10 coverage pending asset (see Blockers) |
| T1 — Un-gate routes from demo mode | ⏳ | |
| T2 — All fixture kinds + nearest-riser assignment | ⏳ | starts after T1 green |
| T3 core — Branch routing geometry (src/domain) | ⏳ | |
| T3 — Viewer wiring (2D/3D, per-floor toggle) | ⏳ | starts after T2 + T3 core |
| Final verification (`pnpm lint && pnpm test` full) | ⏳ | |

## Baseline (clean `main`, c3e6d80, 2026-08-28 22:11)

- `pnpm install`: OK (pnpm 11.15.1, node 24.18.0)
- `pnpm lint`: 0 errors, 1 pre-existing warning (`FloorViewer.tsx` react-hooks/exhaustive-deps) — left as-is
- `pnpm test`: **2 failed** / 246 passed (31 files). Pre-existing failures in `src/domain/decideRiserStrategyPerToiletRoom.bim11.test.ts`: code prefixes inherited coverage reasons with `"inherits exception coverage from primary member: "`, tests expect the bare reason string. Reconciliation assigned to the domain worker (separate `baseline:` commit) since a green suite is required by the DoD.

## Milestones

_(test results and screenshots appended per milestone)_

## Blockers

- `ADAM_10.ifc` is not present on this machine (`external/demo-assets/` does not exist; disk searched). T0's ADAM_10 clause and T2's "on ADAM_10" acceptance are deferred until the asset is placed at `external/demo-assets/ADAM_10.ifc`. Fixture/sample IFCs are used meanwhile.

## Sample assets (local-only, gitignored under `external/`)

Downloaded 2026-08-28 from buildingSMART Community-Sample-Test-Files (Duplex Apartment, IFC2X3, Revit exports) for live verification:

- `external/samples/Duplex_A_20110907.ifc` (2.3 MB, architecture; 4 storeys, 21 spaces, keyword-detectable fixtures)
- `external/samples/Duplex_MEP_20110907.ifc` (17 MB, MEP; **105 `IfcFlowTerminal` entities** — best for detection/routing verification)
- `external/samples/Duplex_Plumbing_20121113.ifc` (30 MB, plumbing distribution; no terminals)

## Screenshots

_(added per milestone under `docs/progress/`)_
