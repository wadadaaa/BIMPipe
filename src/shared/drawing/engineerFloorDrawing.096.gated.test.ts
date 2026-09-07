import { describe, expect, it } from 'vitest'
import { computeGauntletMetrics } from '@/domain/gauntletMetrics'
import {
  drawingContentOutsideBounds,
  drawingLabelsContaining,
  drawingModelHasNonFinite,
} from './drawingModelChecks'
import { runGauntletFloorPipeline } from './gauntletFloorPipeline'
import { closeSpecModels, GAUNTLET_BUILTIN_FLOOR_SPECS, openSpecModels, specFilesExist } from './gauntletFloorSpecs'
import { gauntletMetricsInputFromPipeline } from './gauntletMetricsInput'

/**
 * Gated G2 regression on the first project's storey 01 (plumbing host + linked
 * architecture podium; client data under gitignored `external/`, skips cleanly
 * when absent): both drawing adapters build from the app's own pipeline, the
 * engineer sheet carries exactly V1's intersecting sanitary stacks, the two
 * storey interpretations (literal slab band vs. hang band under the slab) are
 * counted and pinned, every run lies inside the frame, slopes are derived for
 * the vast majority of extrusion runs, and no label carries a file name.
 *
 * Pinned values were measured on 2026-09-06; a change moves them on purpose.
 */
const SPEC = GAUNTLET_BUILTIN_FLOOR_SPECS['096-01']
const TEST_TIMEOUT_MS = 600_000

// Engineer risers: V1's honest storey-01 count is 15 sanitary + 1 vent
// intersecting; R1's served-stack rule keeps the 12 joined by a storey-01
// horizontal within 0.5 m (audit 2026-09-06: risers 12, 14 and 18 have no run
// of this storey within 0.5 m — the Ø160/Ø200 pair on the south edge passes
// through to upper storeys, riser 18 sits 0.54 m from a WC with no drawn run).
const PIN_ENGINEER_SANITARY_STACKS_INTERSECTING = 15
const PIN_ENGINEER_SANITARY_STACKS = 12
const PIN_ENGINEER_PASS_THROUGH = 3
const PIN_ENGINEER_VENT_STACKS = 1
// Horizontal SW-GRV runs by storey rule: 12 in the literal band, 122 in the
// 1.2 m hang band under the slab, 9 crossing the slab level (counted in both).
const PIN_SANITARY_IN_BAND = 12
const PIN_SANITARY_IN_HANG = 122
const PIN_SANITARY_BOTH = 9
const PIN_SANITARY_TOTAL = 125
// Slope coverage on extrusion-axis runs (endpoint Z over horizontal length):
// 112 of 125 — 2 runs below the 1 mm resolution, 11 outliers (ten 45° offset
// pieces at ~100 %, one at 15.6 %) drawn without a slope.
const MIN_SLOPE_COVERAGE = 0.8
const PIN_SLOPE_COVERAGE = 0.896
// Slope source (S2): this export carries a single Pset_FlowSegmentPipeSegment
// InvertElevation per pipe and no per-end Revit inverts (0 of 413 model pipes),
// so no run has a both-end invert pair and every resolved slope (112 values +
// 11 outlier verdicts) comes from centreline endpoint Z. Nothing to disagree.
const PIN_SLOPE_WITH_END_INVERTS = 0
const PIN_SLOPE_BY_SOURCE = { invert: 0, 'endpoint-z': 123 }
const PIN_SLOPE_DISAGREEMENTS = 0
// Collector role at the strict 50 mm endpoint-coincidence rule. R3 draws the
// IfcFlowFitting bodies as port connectors, so a pipe end now meets a
// connector end at the port and most junctions ARE endpoint-coincident
// (R2 pinned 2 with the fittings missing).
const PIN_COLLECTORS_STRICT = 17
// R3 fitting census on the storey (band ∪ hang band, SW-GRV): 237 IfcFlowFitting
// bodies — 200 two-port (elbows/offsets) and 37 three-port (tees/wyes), none
// skipped — drawn as 503 connectors model-wide, 160 on this storey. Free run
// ends within 50 mm of no other drawn run fell 210 → 72 (the remainder are
// fixture drops and the Ø50/Ø63 legs to unmodelled fixtures).
const PIN_R3_FITTINGS = 237
const PIN_R3_FITTINGS_BY_PORTS = { '2': 200, '3': 37 }
const PIN_R3_FITTING_CONNECTORS_ON_STOREY = 160
// Our side: 10 wet cores → 8 stacks on the storey (R1: the two cores whose
// snap window is fully obstructed are gathered into a neighbour's stack through
// a core collector instead of a flagged stack on a blocked cell; V3 pinned 10).
const PIN_OUR_STACKS = 8
const PIN_OUR_CORE_COLLECTORS = 2
// R2/R3 shared-fixture set (1.0 m serves-fixture rule on the union set, engineer
// length attributed to the nearest DIAMETER-COMPATIBLE served fixture of each
// run's upstream end and walked downstream through the 150 mm fitting-bridged
// connectivity). All 13 detected fixtures (11 WC + 2 basins) are served by both
// sides. R3 measured (2026-09-06): the 160 fitting connectors add 9.9 m to the
// engineer's union set (71.7 → 81.6 m) and, attributed like runs, pushed the R2
// ratio 0.51 → 0.43; the diameter rule (a Ø50/Ø63 run cannot serve a WC) then
// rejects 56 runs / 9.2 m that R2 had attributed to WCs, leaving 36.47 m on the
// shared set → 19.92 / 36.47 = 0.55 (0.61 at 0.75 m, 0.55 at 1.5 m: the rule
// removes the tolerance sensitivity R2 had, 0.65 / 0.51 / 0.44). 164 of the
// 285 drawn runs (45.1 m, 24 leaf ends) stay unattributed — the Ø50/Ø63
// network to basins, showers and machines no file models on this storey.
// Full-set union 0.24 (0.28 before the connectors); literal band 3.23 unchanged.
const PIN_R2_FIXTURES = 13
const PIN_R2_SHARED = 13
const PIN_R2_ONLY_ENGINEER = 0
const PIN_R2_ONLY_US = 0
const PIN_R2_OUR_SHARED_M = 19.92
const PIN_R2_ENGINEER_SHARED_M = 36.47
const PIN_R2_ENGINEER_RUNS_UNATTRIBUTED = 164
const PIN_R3_ENGINEER_RUNS_REJECTED_BY_DIAMETER = 56
const PIN_R3_ENGINEER_RUNS_REJECTED_BY_DIAMETER_M = 9.19
const PIN_R2_BRANCH_RATIO_SHARED = 0.55
const PIN_R2_BRANCH_RATIO_UNION = 0.24
const PIN_R2_BRANCH_RATIO_LITERAL = 3.23

const gated = describe.skipIf(!specFilesExist(SPEC))

gated('engineer + our floor drawings on 096 storey 01 (gated: requires local client files)', () => {
  it(
    'builds both models with pinned counts, frame containment, slope coverage and neutral labels',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const models = openSpecModels(api, SPEC)
      try {
        const result = await runGauntletFloorPipeline(api, SPEC, models)
        const { engineer, ours, metricsInput } = result
        const forbidden = [SPEC.host.fileName, ...SPEC.linked.map((ref) => ref.fileName), '096']

        console.info(`[096 drawing] engineer diagnostics ${JSON.stringify(engineer.diagnostics)}`)
        console.info(`[096 drawing] ours diagnostics ${JSON.stringify(ours.diagnostics)}`)
        console.info(
          `[096 drawing] tags engineer ${engineer.model.risers.map((r) => r.tag).join(' ')} | ours ${ours.model.risers.map((r) => r.tag).join(' ')}`,
        )
        console.info(`[096 drawing] bounds engineer ${JSON.stringify(engineer.model.boundsM)} ours ${JSON.stringify(ours.model.boundsM)}`)
        console.info(`[096 drawing] timings ${JSON.stringify(metricsInput.timingsMs)}; report ratio ${metricsInput.report.branchLengths.ratioOursToEngineer?.toFixed(3)}`)

        // --- engineer sheet ---
        expect(engineer.model.title).toBe('Storey 01 — sanitary plan')
        expect(engineer.diagnostics.risers.sanitary).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(engineer.diagnostics.risers.sanitaryPassThrough).toBe(PIN_ENGINEER_PASS_THROUGH)
        expect(metricsInput.engineerStacks.intersecting).toBe(PIN_ENGINEER_SANITARY_STACKS_INTERSECTING)
        expect(metricsInput.engineerStacks.served).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(engineer.diagnostics.risers.vent).toBe(PIN_ENGINEER_VENT_STACKS)
        expect(engineer.model.risers.filter((riser) => riser.system === 'sanitary')).toHaveLength(PIN_ENGINEER_SANITARY_STACKS)
        expect(engineer.model.risers.filter((riser) => riser.system === 'vent')).toHaveLength(PIN_ENGINEER_VENT_STACKS)
        for (const riser of engineer.model.risers) {
          expect(riser.diameterMm).not.toBeNull()
          expect(riser.diameterMm!).toBeGreaterThanOrEqual(110)
        }
        // Revit writes element ids into Tag and type names into Name: neither is a sheet number.
        expect(engineer.diagnostics.risers.tagsFromEngineer).toBe(0)
        expect(engineer.model.risers.map((riser) => riser.tag).slice(0, 3)).toEqual(['1.1ק', '1.2ק', '1.3ק'])

        const sanitaryPipes = engineer.diagnostics.pipes.sanitary
        expect(sanitaryPipes.inBand).toBe(PIN_SANITARY_IN_BAND)
        expect(sanitaryPipes.inHang).toBe(PIN_SANITARY_IN_HANG)
        expect(sanitaryPipes.both).toBe(PIN_SANITARY_BOTH)
        expect(sanitaryPipes.total).toBe(PIN_SANITARY_TOTAL)
        expect(sanitaryPipes.total).toBe(sanitaryPipes.inBand + sanitaryPipes.inHang - sanitaryPipes.both)
        expect(engineer.model.pipes.filter((pipe) => pipe.system === 'sanitary' && !pipe.fitting)).toHaveLength(PIN_SANITARY_TOTAL)
        // R3 fitting connectors: drawn apart from the runs, counted apart from the pins above.
        expect(sanitaryPipes.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(engineer.model.pipes.filter((pipe) => pipe.fitting === true)).toHaveLength(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(metricsInput.engineerStoreyHorizontals.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.fittings).toBe(PIN_R3_FITTINGS)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.byPortCount).toEqual(PIN_R3_FITTINGS_BY_PORTS)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.skipped).toEqual([])
        expect(metricsInput.engineerBranchRuns.union.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(metricsInput.engineerStoreyHorizontals.literalBandSelection.segments).toBe(PIN_SANITARY_IN_BAND)
        // Every SW-GRV segment of this file has a centreline: the containment rule never engages here.
        expect(metricsInput.engineerStoreyHorizontals.literalBandSelection.byContainmentRejected).toBe(0)

        expect(engineer.diagnostics.slope.extrusionCoverage).not.toBeNull()
        expect(engineer.diagnostics.slope.extrusionCoverage!).toBeGreaterThanOrEqual(MIN_SLOPE_COVERAGE)
        expect(engineer.diagnostics.slope.extrusionCoverage!).toBeCloseTo(PIN_SLOPE_COVERAGE, 2)
        for (const pipe of engineer.model.pipes) {
          if (pipe.slopePercent === null) continue
          expect(pipe.slopePercent).toBeGreaterThanOrEqual(0)
          expect(pipe.slopePercent).toBeLessThanOrEqual(10)
        }
        // Every outlier is a steep offset piece, never drawn as a slope.
        for (const outlier of engineer.diagnostics.slope.outliers) expect(Math.abs(outlier.rawPercent)).toBeGreaterThan(10)
        expect(engineer.diagnostics.slope.withEndInverts).toBe(PIN_SLOPE_WITH_END_INVERTS)
        expect(engineer.diagnostics.slope.withoutEndInverts).toBe(PIN_SANITARY_TOTAL)
        expect(engineer.diagnostics.slope.bySource).toEqual(PIN_SLOPE_BY_SOURCE)
        expect(engineer.diagnostics.slope.disagreements).toHaveLength(PIN_SLOPE_DISAGREEMENTS)
        expect(new Set(Object.values(engineer.diagnostics.slope.sourceByPipeId))).toEqual(new Set(['endpoint-z']))

        expect(engineer.diagnostics.collectors.count).toBe(PIN_COLLECTORS_STRICT)
        expect(engineer.diagnostics.collectors.bridged.count).toBeGreaterThanOrEqual(PIN_COLLECTORS_STRICT)
        expect(engineer.model.pipes.filter((pipe) => pipe.role === 'collector')).toHaveLength(engineer.diagnostics.collectors.count)

        expect(drawingModelHasNonFinite(engineer.model)).toBe(false)
        expect(drawingContentOutsideBounds(engineer.model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
        expect(drawingLabelsContaining(engineer.model, forbidden)).toEqual([])
        expect(JSON.stringify(engineer.model)).not.toMatch(/\.ifc/i)

        // --- our sheet ---
        expect(ours.model.title).toBe(engineer.model.title)
        expect(ours.model.risers).toHaveLength(PIN_OUR_STACKS)
        expect(ours.model.risers.map((riser) => riser.tag).slice(0, 3)).toEqual(['1.1ק', '1.2ק', '1.3ק'])
        expect(new Set(ours.model.risers.map((riser) => riser.tag)).size).toBe(ours.model.risers.length)
        expect(ours.model.pipes.length).toBeGreaterThan(0)
        for (const pipe of ours.model.pipes) expect(pipe.slopePercent).toBe(2)
        expect(ours.model.pipes.filter((pipe) => pipe.role === 'collector')).toHaveLength(ours.diagnostics.pipes.collectors)
        expect(drawingModelHasNonFinite(ours.model)).toBe(false)
        expect(drawingContentOutsideBounds(ours.model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
        expect(drawingLabelsContaining(ours.model, forbidden)).toEqual([])
        // Same frame on both sheets so the A/B overlays.
        expect(ours.model.boundsM).toEqual(engineer.model.boundsM)
        expect(ours.model.fixtures).toEqual(engineer.model.fixtures)
        expect(ours.model.structure).toEqual(engineer.model.structure)

        // Metrics input is JSON-ready and the report agrees with the V3/V5/R1 pins.
        expect(JSON.parse(JSON.stringify(metricsInput)).report.riserCounts.engineerStacksIntersectingStorey).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(metricsInput.report.riserCounts.oursStacksOnStorey).toBe(PIN_OUR_STACKS)
        // R1 core collectors: the gathered cores appear as collector runs, not stacks.
        expect(metricsInput.coreCollectors).toHaveLength(PIN_OUR_CORE_COLLECTORS)
        expect(metricsInput.continuityProbes.every((probe) => probe.probe.status !== 'blocked')).toBe(true)
        expect(metricsInput.continuityProbes.every((probe) => !probe.flagged)).toBe(true)
        const collectorRuns = metricsInput.comparisonInput.ourBranchRoutes.flatMap((floor) =>
          floor.segments.filter((segment) => segment.coreCollectorId !== undefined),
        )
        expect(new Set(collectorRuns.map((segment) => segment.coreCollectorId)).size).toBe(PIN_OUR_CORE_COLLECTORS)

        // R2 shared-fixture set (`computeSharedFixtureSet`, 1.0 m rule) — the
        // gauntlet's gated branch ratio. Measured 2026-09-06 on the union set.
        const metrics = computeGauntletMetrics(gauntletMetricsInputFromPipeline(metricsInput))
        const shared = metrics.sharedFixtures
        expect(shared.fixtures).toBe(PIN_R2_FIXTURES)
        expect(shared.shared).toBe(PIN_R2_SHARED)
        expect(shared.fixturesOnlyEngineerServes).toBe(PIN_R2_ONLY_ENGINEER)
        expect(shared.fixturesOnlyWeServe).toBe(PIN_R2_ONLY_US)
        expect(shared.ourBranchSharedM).toBeCloseTo(PIN_R2_OUR_SHARED_M, 1)
        expect(shared.engineerBranchSharedM).toBeCloseTo(PIN_R2_ENGINEER_SHARED_M, 1)
        expect(shared.engineerRunsUnattributed).toBe(PIN_R2_ENGINEER_RUNS_UNATTRIBUTED)
        expect(shared.engineerRunsRejectedByDiameter).toBe(PIN_R3_ENGINEER_RUNS_REJECTED_BY_DIAMETER)
        expect(shared.engineerRunsRejectedByDiameterM).toBeCloseTo(PIN_R3_ENGINEER_RUNS_REJECTED_BY_DIAMETER_M, 1)
        expect(metrics.branchRatio).not.toBeNull()
        expect(metrics.branchRatio!).toBeCloseTo(PIN_R2_BRANCH_RATIO_SHARED, 2)
        expect(metrics.branchRatioFullUnion).toBeCloseTo(PIN_R2_BRANCH_RATIO_UNION, 2)
        expect(metrics.branchRatioLiteralBand).toBeCloseTo(PIN_R2_BRANCH_RATIO_LITERAL, 2)
        expect(metrics.verdict).toBe('green')
      } finally {
        closeSpecModels(api, models)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
