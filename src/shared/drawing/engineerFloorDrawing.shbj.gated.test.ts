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
 * Gated G2 regression on the second project's MEP storey (sanitary host +
 * architecture + structure, IFC2X3 in centimetres; client data under the
 * gitignored `external/`, skips cleanly when absent). Same assertions as the
 * 096 test: V1b's 9 intersecting sanitary stacks, both storey interpretations
 * counted and pinned, frame containment, slope coverage on extrusion runs,
 * neutral labels, and our 7 wet-core stacks from the app's own path.
 *
 * Pinned values were measured on 2026-09-06.
 */
const SPEC = GAUNTLET_BUILTIN_FLOOR_SPECS['shbj-L04']
const TEST_TIMEOUT_MS = 600_000

// R1 served-stack rule: 9 sanitary stacks intersect the L04 band, but only 5
// are joined by an L04 horizontal within 0.5 m (audit 2026-09-06: risers 2, 6,
// 7, 8 have no run of this storey within 0.5 m — nearest fixture 1.5 / 18.9 /
// 10.5 / 17.6 m — they pass through to other storeys' fixtures / roof).
const PIN_ENGINEER_SANITARY_STACKS_INTERSECTING = 9
const PIN_ENGINEER_SANITARY_STACKS = 5
const PIN_ENGINEER_PASS_THROUGH = 4
const PIN_ENGINEER_VENT_STACKS = 2
// Literal band: 14 resolved runs by Z + 6 geometry-less pieces contained in
// L04 carrying 124.35 m of Pset length. Their inverts: 5 sit 12–19 m BELOW
// the storey (full-height stacks filed on L04 → rejected, 121.65 m), 1 sits
// 0.42 m under the slab (kept, 2.70 m). Literal band total 132.06 → 10.41 m.
const PIN_LITERAL_BAND_SEGMENTS = 15
const PIN_LITERAL_BAND_REJECTED = 5
const PIN_LITERAL_BAND_REJECTED_M = 121.65
const PIN_LITERAL_BAND_TOTAL_M = 10.41
// Horizontal SW-GRV runs by storey rule: 14 in the literal 4 m band, 35 in the
// 1.2 m hang band under the slab, 0 crossing the slab level → 49 drawn.
const PIN_SANITARY_IN_BAND = 14
const PIN_SANITARY_IN_HANG = 35
const PIN_SANITARY_BOTH = 0
const PIN_SANITARY_TOTAL = 49
// Slope coverage on extrusion-axis runs: 39 of 49 = 79.6 % — 4 measured flats
// (0 %), 5 pieces shorter than 100 mm (null: unresolvable at 1 mm), 5 steep 45°
// offset pieces (~100 %, flagged as outliers, drawn without a slope). This
// floor MISSES the 80 % target by one run; the measured value is pinned as-is
// rather than tuned.
const PIN_SLOPE_COVERAGE = 39 / 49
// Slope source (S2): every pipe in this export carries Revit's per-end
// `Upper/Lower End Invert Elevation` (87 of 87 model pipes; all 49 drawn runs).
// The 44 resolved slopes (39 values + 5 outlier verdicts) are drawn from the
// invert pair; the 5 below-resolution pieces stay null from either source. The
// invert slope agrees with the centreline endpoint-Z slope within 0.1 pp on all
// 44 (max |diff| 0.0000 pp), so no label changed and nothing disagrees at the
// 0.5 pp tolerance.
const PIN_SLOPE_WITH_END_INVERTS = 49
const PIN_SLOPE_BY_SOURCE = { invert: 44, 'endpoint-z': 0 }
const PIN_SLOPE_AGREEMENT_HISTOGRAM = { '<=0.1': 44, '<=0.5': 0, '<=1': 0, '>1': 0 }
const PIN_SLOPE_DISAGREEMENTS = 0
// No two horizontal runs meet within 50 mm on this model (every joint is a
// fitting); R3's connectors keep the collector role on the pipes, and no pipe
// gathers two feeders through one body at the strict rule here.
const PIN_COLLECTORS_STRICT = 0
// R3 fitting census on the storey (band ∪ hang band, SW-GRV): 46 IfcFlowFitting
// bodies — 5 single-port caps (skipped: nothing to bridge), 26 two-port, 14
// three-port, 1 four-port — 97 connectors model-wide, 74 on this storey. Free
// run ends within 50 mm of no other drawn run fell 98 → 25.
const PIN_R3_FITTINGS = 46
const PIN_R3_FITTINGS_BY_PORTS = { '1': 5, '2': 26, '3': 14, '4': 1 }
const PIN_R3_FITTINGS_SKIPPED = 5
const PIN_R3_FITTING_CONNECTORS_ON_STOREY = 74
// Our side: 7 wet cores → 7 stacks on the storey (V3 pin).
const PIN_OUR_STACKS = 7
// Office typology (G3) through the harness: 5 row collectors → 70 route segments / 59.6 m.
const PIN_OUR_OFFICE_SEGMENTS = 70
const PIN_OUR_OFFICE_BRANCH_M = 59.6
// R2/R3 shared-fixture set (1.0 m serves-fixture rule on the union set; see the
// 096 test for the attribution rule). R3 measured (2026-09-06): the 74 fitting
// connectors add 7.6 m to the engineer's union set (25.55 → 33.17 m); under the
// diameter rule one WC whose only engineer run within 1.0 m is Ø50 is no longer
// served by the engineer (that run attributes to a compatible basin instead,
// 0 rejected) → 24 of the 33 detected fixtures shared, 9 served only by us (the
// engineer's L04 slice has no run to them — the R1 audit's model gap), 0 only
// by the engineer; every one of the 123 drawn runs is attributed. Our 44.74 m
// to the shared fixtures over the engineer's 33.17 m → 1.35 (R2: 1.77; full
// union 1.80, literal band 5.73). Sensitivity 0.75 / 1.0 / 1.5 m: 1.35 each;
// rule off 1.36 each.
const PIN_R2_FIXTURES = 33
const PIN_R2_SHARED = 24
const PIN_R2_ONLY_ENGINEER = 0
const PIN_R2_ONLY_US = 9
const PIN_R2_OUR_SHARED_M = 44.74
const PIN_R2_ENGINEER_SHARED_M = 33.17
const PIN_R2_ENGINEER_RUNS_UNATTRIBUTED = 0
const PIN_R2_BRANCH_RATIO_SHARED = 1.35
const PIN_R2_BRANCH_RATIO_UNION = 1.8
const PIN_R2_BRANCH_RATIO_LITERAL = 5.73

const gated = describe.skipIf(!specFilesExist(SPEC))

gated('engineer + our floor drawings on the second project MEP storey (gated: requires local client files)', () => {
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
        const forbidden = [SPEC.host.fileName, ...SPEC.linked.map((ref) => ref.fileName), 'shbj']

        console.info(`[shbj drawing] engineer diagnostics ${JSON.stringify(engineer.diagnostics)}`)
        console.info(`[shbj drawing] ours diagnostics ${JSON.stringify(ours.diagnostics)}`)
        console.info(
          `[shbj drawing] tags engineer ${engineer.model.risers.map((r) => r.tag).join(' ')} | ours ${ours.model.risers.map((r) => r.tag).join(' ')}`,
        )
        console.info(`[shbj drawing] bounds ${JSON.stringify(engineer.model.boundsM)}; structure ${engineer.model.structure.length} elements`)
        console.info(`[shbj drawing] timings ${JSON.stringify(metricsInput.timingsMs)}; report ratio ${metricsInput.report.branchLengths.ratioOursToEngineer?.toFixed(3)}; diagnostics ${JSON.stringify(metricsInput.diagnostics)}`)

        // --- engineer sheet ---
        expect(engineer.model.title).toBe('Storey 04 — sanitary plan')
        expect(engineer.diagnostics.risers.sanitary).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(engineer.diagnostics.risers.sanitaryPassThrough).toBe(PIN_ENGINEER_PASS_THROUGH)
        expect(metricsInput.engineerStacks.intersecting).toBe(PIN_ENGINEER_SANITARY_STACKS_INTERSECTING)
        expect(metricsInput.engineerStacks.served).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(metricsInput.engineerStacks.passThrough).toHaveLength(PIN_ENGINEER_PASS_THROUGH)
        expect(engineer.diagnostics.risers.vent).toBe(PIN_ENGINEER_VENT_STACKS)
        expect(engineer.model.risers.filter((riser) => riser.system === 'sanitary')).toHaveLength(PIN_ENGINEER_SANITARY_STACKS)
        expect(engineer.model.risers.filter((riser) => riser.system === 'vent')).toHaveLength(PIN_ENGINEER_VENT_STACKS)
        expect(engineer.diagnostics.risers.tagsFromEngineer).toBe(0)
        expect(engineer.model.risers.map((riser) => riser.tag).slice(0, 2)).toEqual(['4.1ק', '4.2ק'])

        const sanitaryPipes = engineer.diagnostics.pipes.sanitary
        expect(sanitaryPipes.inBand).toBe(PIN_SANITARY_IN_BAND)
        expect(sanitaryPipes.inHang).toBe(PIN_SANITARY_IN_HANG)
        expect(sanitaryPipes.both).toBe(PIN_SANITARY_BOTH)
        expect(sanitaryPipes.total).toBe(PIN_SANITARY_TOTAL)
        expect(engineer.model.pipes.filter((pipe) => pipe.system === 'sanitary' && !pipe.fitting)).toHaveLength(PIN_SANITARY_TOTAL)
        // R3 fitting connectors: drawn apart from the runs, counted apart from the pins above.
        expect(sanitaryPipes.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(engineer.model.pipes.filter((pipe) => pipe.fitting === true)).toHaveLength(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(metricsInput.engineerStoreyHorizontals.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.fittings).toBe(PIN_R3_FITTINGS)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.byPortCount).toEqual(PIN_R3_FITTINGS_BY_PORTS)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.skipped).toHaveLength(PIN_R3_FITTINGS_SKIPPED)
        expect(metricsInput.engineerStoreyHorizontals.fittingSummary.skipped.every((entry) => entry.reason === 'single port')).toBe(true)
        expect(metricsInput.engineerBranchRuns.union.fittingConnectors).toBe(PIN_R3_FITTING_CONNECTORS_ON_STOREY)
        // The 6 unresolved cut-face pipes (V1b) are vertical stacks, never
        // horizontals; R1 rejects the 5 whose invert contradicts the containment
        // and keeps the 1 that hangs 0.42 m under the slab.
        const literal = metricsInput.engineerStoreyHorizontals.literalBandSelection
        expect(literal.segments).toBe(PIN_LITERAL_BAND_SEGMENTS)
        expect(literal.byGeometry).toBe(PIN_SANITARY_IN_BAND)
        expect(literal.byContainment).toBe(1)
        expect(literal.byContainmentRejected).toBe(PIN_LITERAL_BAND_REJECTED)
        expect(literal.byContainmentRejectedLengthM).toBeCloseTo(PIN_LITERAL_BAND_REJECTED_M, 1)
        expect(metricsInput.engineerBranchRuns.literalBand.totalM).toBeCloseTo(PIN_LITERAL_BAND_TOTAL_M, 1)

        expect(engineer.diagnostics.slope.extrusionCoverage).not.toBeNull()
        expect(engineer.diagnostics.slope.extrusionCoverage!).toBeCloseTo(PIN_SLOPE_COVERAGE, 3)
        expect(engineer.diagnostics.slope.flat).toBe(4)
        expect(engineer.diagnostics.slope.belowResolution).toBe(5)
        expect(engineer.diagnostics.slope.outliers).toHaveLength(5)
        expect(engineer.diagnostics.slope.withEndInverts).toBe(PIN_SLOPE_WITH_END_INVERTS)
        expect(engineer.diagnostics.slope.withoutEndInverts).toBe(0)
        expect(engineer.diagnostics.slope.bySource).toEqual(PIN_SLOPE_BY_SOURCE)
        expect(engineer.diagnostics.slope.agreementHistogram).toEqual(PIN_SLOPE_AGREEMENT_HISTOGRAM)
        expect(engineer.diagnostics.slope.disagreements).toHaveLength(PIN_SLOPE_DISAGREEMENTS)
        expect(new Set(Object.values(engineer.diagnostics.slope.sourceByPipeId))).toEqual(new Set(['invert']))
        for (const pipe of engineer.model.pipes) {
          if (pipe.slopePercent === null) continue
          expect(pipe.slopePercent).toBeGreaterThanOrEqual(0)
          expect(pipe.slopePercent).toBeLessThanOrEqual(10)
        }
        expect(engineer.diagnostics.collectors.count).toBe(PIN_COLLECTORS_STRICT)

        expect(drawingModelHasNonFinite(engineer.model)).toBe(false)
        expect(drawingContentOutsideBounds(engineer.model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
        expect(drawingLabelsContaining(engineer.model, forbidden)).toEqual([])
        expect(JSON.stringify(engineer.model)).not.toMatch(/\.ifc/i)
        // Structure reaches the sheet from the linked files (walls from AR, slab openings from ST).
        expect(engineer.model.structure.filter((element) => element.kind === 'wall').length).toBeGreaterThan(0)
        expect(engineer.model.structure.filter((element) => element.kind === 'slab-opening').length).toBeGreaterThanOrEqual(20)

        // --- our sheet ---
        expect(ours.model.risers).toHaveLength(PIN_OUR_STACKS)
        expect(ours.model.risers.map((riser) => riser.tag).slice(0, 2)).toEqual(['4.1ק', '4.2ק'])
        expect(new Set(ours.model.risers.map((riser) => riser.tag)).size).toBe(ours.model.risers.length)
        expect(ours.model.pipes.length).toBeGreaterThan(0)
        expect(drawingModelHasNonFinite(ours.model)).toBe(false)
        expect(drawingContentOutsideBounds(ours.model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
        expect(drawingLabelsContaining(ours.model, forbidden)).toEqual([])
        expect(ours.model.boundsM).toEqual(engineer.model.boundsM)
        expect(ours.model.structure).toEqual(engineer.model.structure)

        expect(metricsInput.report.riserCounts.engineerStacksIntersectingStorey).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(metricsInput.report.riserCounts.oursStacksOnStorey).toBe(PIN_OUR_STACKS)

        // --- typology (G4 wiring of G3's office switch through the harness) ---
        // The spec says office: every stack sits on a core shaft, the fixture
        // rows drain through collectors (G3 pins: 7 shafts, 70 segments / 59.6 m).
        expect(metricsInput.spec.typology).toBe('office')
        expect(metricsInput.continuityProbes.map((probe) => probe.placementRule)).toEqual(Array<string>(PIN_OUR_STACKS).fill('shaft'))
        expect(metricsInput.continuityProbes.every((probe) => probe.probe.status === 'free')).toBe(true)
        expect(ours.model.pipes).toHaveLength(PIN_OUR_OFFICE_SEGMENTS)
        expect(metricsInput.report.branchLengths.oursTotalM).toBeCloseTo(PIN_OUR_OFFICE_BRANCH_M, 1)
        expect(metricsInput.diagnostics.some((line) => line.includes('typology "office" applied'))).toBe(true)

        // R2 shared-fixture set — the gauntlet's gated branch ratio (measured 2026-09-06).
        const metrics = computeGauntletMetrics(gauntletMetricsInputFromPipeline(metricsInput))
        const shared = metrics.sharedFixtures
        expect(shared.fixtures).toBe(PIN_R2_FIXTURES)
        expect(shared.shared).toBe(PIN_R2_SHARED)
        expect(shared.fixturesOnlyEngineerServes).toBe(PIN_R2_ONLY_ENGINEER)
        expect(shared.fixturesOnlyWeServe).toBe(PIN_R2_ONLY_US)
        expect(shared.ourBranchSharedM).toBeCloseTo(PIN_R2_OUR_SHARED_M, 1)
        expect(shared.engineerBranchSharedM).toBeCloseTo(PIN_R2_ENGINEER_SHARED_M, 1)
        expect(shared.engineerRunsUnattributed).toBe(PIN_R2_ENGINEER_RUNS_UNATTRIBUTED)
        expect(shared.engineerRunsRejectedByDiameter).toBe(0)
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
