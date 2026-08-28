# Goal progress — T0/T1/T2/T3-core

Branch: `goal/t0-t3-routing` · Started: 2026-08-28 · Status legend: ⏳ pending · 🔄 in progress · ✅ done · ⛔ blocked

| Task | Status | Notes |
| --- | --- | --- |
| Setup (deps, baseline lint+test) | ✅ | baseline recorded below |
| T0 — Export round-trip test | ✅ | commit `b381bd4`; ADAM_10 coverage pending asset (see Blockers) |
| T1 — Un-gate routes from demo mode | ✅ | commit `016a92d`; live `demo:adam10` parity proven (byte-identical, see below) |
| T2 — All fixture kinds + nearest-riser assignment | ✅ | commits `43e0a1e`…`b37e77c`; live ADAM_10 check pending asset |
| T3 core — Branch routing geometry (src/domain) | ✅ | commits `d9b5f4e`, `4ac9d40`, `98d287f` |
| T3 — Viewer wiring (2D/3D, per-floor toggle) | ✅ | commit `882e18e` |
| Final verification (`pnpm lint && pnpm test` full) | ✅ | lint 0 errors · 292/292 tests · build green · live dev-flow pass on Duplex MEP with screenshots |

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

### T3 core — Branch routing geometry ✅ (2026-08-28 22:24, commits `d9b5f4e` / `4ac9d40` / `98d287f`)

- Baseline reconciliation (`d9b5f4e`): the 2 pre-existing bim11 failures were stale tests — git archaeology (`f9479dd` added the tests; `e395ee5` and `5463f21` deliberately added the "inherits exception coverage from primary member:" prefix afterward) proves the prefix is intended production behavior. Test expectations updated to the exact intended strings (`toBe`, not loosened).
- `src/domain/branchRouting.ts` (types-first commit, then algorithm): pure `computeBranchRoutes(AssignedFixture[]) -> FloorRoutes[]`. X-leg-first L-shaped runs (bend at `(riser.x, fixture.z)`), riser-datum elevations at +2% × remaining run (`DEFAULT_BRANCH_SLOPE_DROP_MM = 20` per `DEFAULT_BRANCH_SLOPE_RUN_MM = 1000`), per-(storey, riser) collinear same-direction legs merged and split at junction entries so each segment carries a constant `servedFixtureExpressIds` set (trunk when >1). Units via optional `planUnits` param or local mm/m heuristic (dependency direction shared→domain respected). No obstacle avoidance — documented approximation.
- Tests: 11 new; `pnpm test src/domain` 69/69 green (worker); coordinator re-ran branchRouting + bim11: 24/24 green. `pnpm eslint src/domain` clean; `tsc --noEmit` clean.
- Follow-up candidates recorded: no snapping tolerance on collinearity; ideal-slope (not min-invert) elevations; slope constant not yet per-call parameterized.

### T2 — All fixture kinds + nearest-riser assignment ✅ (2026-08-28 22:39, commits `43e0a1e`, `2c386c0`, `1db723c`, `b37e77c`)

- `TOILETPAN` filter removed: all kinds reach state, viewer, per-kind counts in FixturesPanel, riser suggestion, and route planning. Toilets + kitchen corners are the only riser anchors; the no-toilet clustering/k-means fallback is removed (5 fallback tests intentionally replaced with non-spawning assertions).
- New pure `src/domain/assignFixturesToRisers.ts`: discriminated-union result (assigned: riser id/stack/positions/planDistance/units; unassigned: reason `no-plan-position` / `no-riser-on-storey` / `no-riser-within-branch-length`), `MAX_BRANCH_LENGTH_MM = 4000` / `_M = 4` (documented 3–5 m branch-drain rationale), same-floor only, deterministic tie-breaks. Unassigned fixtures surfaced in UI (count + badge).
- `includeShowerFloorDrains` detection flag (default off = current behavior; enabled maps shower/floor-drain incl. `מחסום רצפה` to kind `OTHER`); 3 tests prove the flip.
- Worker validation: 123 tests / 12 focused files green; eslint clean; build green; react-doctor: only pre-existing findings.
- **Coordinator integration gate after T2 (nothing in flight): `pnpm lint` 0 errors (1 pre-existing warning) · `pnpm test` 281/281 (34 files) · `pnpm build` green.** Baseline was 246 passed + 2 failed.
- Known follow-ups: planner still skips URINAL/BIDET/CISTERN/OTHER with limitation notes; viewer markers don't distinguish unassigned (T3 candidate); assignment vs planner nearest-riser can diverge in edge cases.

### T3 — Viewer wiring ✅ (2026-08-28 22:56, commit `882e18e`)

- New pure adapter `src/shared/routes/buildBranchRoutes.ts` (assigned `FixtureRiserAssignment[]` → `AssignedFixture[]` → `computeBranchRoutes`, units passed through explicitly) + `src/viewer/branchRoutePresentation.ts` (2D plan projection; 3D world segments anchored to the same storey Y anchor as riser junction spheres, so downstream ends land exactly on riser junctions and upstream ends rise at the 2% slope).
- 2D `FloorViewer`: violet polylines (trunk stroke 5 vs branch 2.6), "N branch runs" chip, legend entry, "Runs" toolbar toggle (`aria-pressed`). 3D `Model3DViewer`: two `THREE.LineSegments` groups (trunk/branch by opacity), rebuilt on prop change, disposed with scene. Per-floor visibility as `Map<StoreyId, boolean>` in `WorkspacePage` (absent = visible, reset on upload), shared by both viewers.
- Tests: +11 (4 adapter, 6 presentation, 1 component incl. toggle hide/re-show). Existing demo-path assertions unchanged (stub-only additions).
- Full gate (worker, then coordinator re-run): `pnpm lint` 0 errors (1 pre-existing warning) · `pnpm test` **292/292** · `pnpm build` green · react-doctor only pre-existing Model3DViewer finding.
- Boot smoke check clean; full live upload flow verified separately on the Duplex MEP sample (see Live verification below).

## Blockers

- `ADAM_10.ifc` is not present on this machine (`external/demo-assets/` does not exist; disk searched). Both briefs word the asset conditionally ("if accessible" / "when asset available"), so the tasks are complete without it; when the asset lands at `external/demo-assets/ADAM_10.ifc`, the optional extras are: T0 round-trip on the real asset, T2 per-kind counts on the real asset, and a full-depth `demo:adam10` route comparison (the executable demo surface is already proven byte-identical pre/post T1, see the parity section).

## Sample assets (local-only, gitignored under `external/`)

Downloaded 2026-08-28 from buildingSMART Community-Sample-Test-Files (Duplex Apartment, IFC2X3, Revit exports) for live verification:

- `external/samples/Duplex_A_20110907.ifc` (2.3 MB, architecture; 4 storeys, 21 spaces, keyword-detectable fixtures)
- `external/samples/Duplex_MEP_20110907.ifc` (17 MB, MEP; **105 `IfcFlowTerminal` entities** — best for detection/routing verification)
- `external/samples/Duplex_Plumbing_20121113.ifc` (30 MB, plumbing distribution; no terminals)

## Live verification (dev flow on Duplex MEP sample)

Dev server `pnpm dev` on `http://localhost:5174`; model `external/samples/Duplex_MEP_20110907.ifc` (17 MB, IFC2X3, 105 IfcFlowTerminal).

**Pass 2 (2026-08-28 23:14, complete — via Playwright after the IDE-browser tooling disconnected twice in pass 1):**

- Upload + parse: OK. Storeys: Roof (6 mm), Level 2 (3 mm, auto-opened), Level 1 (0 mm). Zero console errors for the entire session (info-level only).
- **T2 per-kind counts (live)**: Level 2 fixtures panel renders "Toilets 2" (M_Water Closet…) and "Basins 4" (M_Lavatory…), "6 on plan · 6 total" — multi-kind detection working (basins were invisible before T2).
- **Riser suggestion**: "Suggest" on Level 2 placed 2 stacks. Level 2 itself shows 0 risers — correct by design: with floors [Level 1, Level 2], Level 2 is classified `penthouse` and the default profile has `penthouseRule: 'exclude_new_risers'`, so the stacks span Level 1 only.
- **T1 routes (live, non-demo)**: Level 1 shows chips "4 fixtures · 4 kitchens · 2 risers · **4 sanitary routes** · **8 branch runs**"; route labels "Ø110 toilet 2.0%", "Ø63 main 2.0%", "Ø50 branch 2.0%"; honest calibration limitation note shown for the non-ADAM model; workflow reached step 04 Export with "Download IFC" enabled.
- **T3 toggle (live)**: "Runs" button `aria-pressed` true→false→true; "8 branch runs" chip disappears/reappears; SVG line count 21→13→21 (exactly −/+8 branch polylines).
- **T3 3D (live)**: 3D canvas renders (2 riser pipes visible through the model, chips "3 floors · 2 risers"). Branch-run lines in 3D are wired and unit-tested; at the default camera zoom they are not visually distinguishable in the screenshot — noted honestly.

![Fixtures per-kind counts](docs/progress/02-fixtures-per-kind-counts.png)
![Level 1: risers, sanitary routes, branch runs](docs/progress/03-level1-risers-routes-branchruns.png)
![Level 1: branch runs hidden via Runs toggle](docs/progress/04-level1-runs-hidden.png)
![3D view with riser pipes](docs/progress/05-3d-view-risers-branchruns.png)

## T1 acceptance — `pnpm demo:adam10` output unchanged (live, 2026-08-28 23:22)

Literal check of the demo parity clause, comparing the tree immediately before T1 (`4ac9d40` = `016a92d^`) against T1 itself (`016a92d`) — comparing against final HEAD would conflate T2's intentional rendering changes, which land after this acceptance gate.

- Method: two git worktrees, each running `DEMO_MODE=true DEMO_CONFIG=demo/adam-10/demo.config.json pnpm dev` (ports 5180/5181). Same input on both: the Duplex MEP sample renamed to `ADAM_10.ifc` to satisfy the demo upload restriction (the genuine asset is absent). Full observable app text captured via browser at two checkpoints and diffed.
- Checkpoint 1 — after upload + parse: **byte-identical** (3 storeys, Level 2 auto-open, 2 toilets detected, identical chips/labels).
- Checkpoint 2 — after Suggest on the Risers tab: **byte-identical**, including the demo-scope notice ("Demo scope excluded 2 fixture(s)… outside included floors"), the ROUTE DEMO FLOW checklist ("Action needed", "Use an included demo floor before routing."), and all routing intent notes (Ø110/Ø63/Ø50, 2.0% slope, 45° joins).
- The demo scope correctly rejects non-ADAM floors, so the deeper route-generation path is not reachable with a stand-in model; that path is locked by the unchanged 18 demo-planner tests plus the new deep-equality parity test (demo wrapper vs `buildSanitaryRoutingPlan` on identical inputs). Combined: the demo surface is proven unchanged live, the planner core is proven unchanged by tests.
- Harness cleaned up afterwards (worktrees removed, servers stopped, renamed stand-in deleted to avoid confusion with the real asset).

**Pass 1 (2026-08-28 23:03, partial — browser session disconnected mid-run; resumed in pass 2):**

- Upload + parse: OK (~15 s). Storeys parsed: Roof, Level 2 (auto-opened), Level 1.
- Detection on Level 2: 6 fixtures — water closets ("M_Water Closet - Flush Tank…") and lavatories ("M_Lavatory - Oval-650 mm…"); viewer chips "2 rm · 6 fixtures · 3 storeys"; WC markers rendered in two clusters; "Place risers" available.
- Runtime note: browser automation session disconnected after screenshot #1 (tooling disconnect, not an app error — no app console errors observed up to that point).

![Workspace after parsing](docs/progress/01-workspace-after-parsing.png)

## Screenshots

_(added per milestone under `docs/progress/`)_
