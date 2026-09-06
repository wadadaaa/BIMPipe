import { describe, expect, it } from 'vitest'
import {
  drawingContentOutsideBounds,
  drawingLabelsContaining,
  drawingModelHasNonFinite,
} from './drawingModelChecks'
import { runGauntletFloorPipeline } from './gauntletFloorPipeline'
import { closeSpecModels, GAUNTLET_BUILTIN_FLOOR_SPECS, openSpecModels, specFilesExist } from './gauntletFloorSpecs'

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

const PIN_ENGINEER_SANITARY_STACKS = 9
const PIN_ENGINEER_VENT_STACKS = 2
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
// No two horizontal runs meet within 50 mm on this model (every joint is a fitting).
const PIN_COLLECTORS_STRICT = 0
// Our side: 7 wet cores → 7 stacks on the storey (V3 pin).
const PIN_OUR_STACKS = 7

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
        expect(engineer.model.pipes.filter((pipe) => pipe.system === 'sanitary')).toHaveLength(PIN_SANITARY_TOTAL)
        // The 6 unresolved cut-face pipes (V1b) are vertical stacks, never horizontals: nothing is lost here.
        expect(metricsInput.engineerStoreyHorizontals.literalBandSelection.segments).toBeGreaterThanOrEqual(PIN_SANITARY_IN_BAND)

        expect(engineer.diagnostics.slope.extrusionCoverage).not.toBeNull()
        expect(engineer.diagnostics.slope.extrusionCoverage!).toBeCloseTo(PIN_SLOPE_COVERAGE, 3)
        expect(engineer.diagnostics.slope.flat).toBe(4)
        expect(engineer.diagnostics.slope.belowResolution).toBe(5)
        expect(engineer.diagnostics.slope.outliers).toHaveLength(5)
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
      } finally {
        closeSpecModels(api, models)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
