import { describe, expect, it } from 'vitest'
import {
  drawingContentOutsideBounds,
  drawingLabelsContaining,
  drawingModelHasNonFinite,
} from './drawingModelChecks'
import { runGauntletFloorPipeline } from './gauntletFloorPipeline'
import { closeSpecModels, GAUNTLET_BUILTIN_FLOOR_SPECS, openSpecModels, specFilesExist } from './gauntletFloorSpecs'

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

// Engineer risers: V1's honest storey-01 count (15 sanitary + 1 vent intersecting).
const PIN_ENGINEER_SANITARY_STACKS = 15
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
// Collector role at the strict 50 mm endpoint-coincidence rule (Revit joins
// pipes through fittings, so most junctions are not endpoint-coincident).
const PIN_COLLECTORS_STRICT = 2
// Our side: 10 wet cores → 10 stacks on the storey (V3 pin).
const PIN_OUR_STACKS = 10

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
        expect(engineer.model.pipes.filter((pipe) => pipe.system === 'sanitary')).toHaveLength(PIN_SANITARY_TOTAL)
        expect(metricsInput.engineerStoreyHorizontals.literalBandSelection.segments).toBe(PIN_SANITARY_IN_BAND)

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

        // Metrics input is JSON-ready and the report agrees with the V3/V5 pins.
        expect(JSON.parse(JSON.stringify(metricsInput)).report.riserCounts.engineerStacksIntersectingStorey).toBe(PIN_ENGINEER_SANITARY_STACKS)
        expect(metricsInput.report.riserCounts.oursStacksOnStorey).toBe(PIN_OUR_STACKS)
      } finally {
        closeSpecModels(api, models)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
