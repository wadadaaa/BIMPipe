import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Gated timing + unit-frame verification for the W5 continuity build against
 * the local (gitignored) 096-A architecture model. Skips cleanly when the
 * client file is absent (e.g. CI).
 *
 * Verifies empirically (never assumed):
 * - extracted footprints are in METRES (plan extents of a 096 storey are tens
 *   of metres, not thousands of cm units),
 * - a storey-scoped window builds a usable map (blocked cells + candidates),
 * and logs extraction/build timings that drive the app's scoping decision.
 */
const IFC_096A_PATH = path.resolve(process.cwd(), 'external/projects/096/096-A.ifc')
const has096A = existsSync(IFC_096A_PATH)

describe.skipIf(!has096A)('096-A continuity map build (gated on local client file)', () => {
  it(
    'extracts a scoped storey window in metres and builds the map',
    { timeout: 600_000 },
    async () => {
      const { IfcAPI } = await import('web-ifc')
      const api = new IfcAPI()
      await api.Init()

      const modelId = api.OpenModel(new Uint8Array(readFileSync(IFC_096A_PATH)))
      try {
        const { parseStoreys } = await import('./parseStoreys')
        const { extractContinuityStoreyInputs } = await import('./extractContinuityInputs')
        const { buildContinuityMap } = await import('@/domain/continuityMap')

        const storeys = await parseStoreys(api, modelId, 'gated-096a-continuity')
        expect(storeys.length).toBeGreaterThanOrEqual(4)

        // Open storey ±3 window around a mid-building storey.
        const midIndex = Math.floor(storeys.length / 2)
        const windowStoreys = storeys.slice(Math.max(0, midIndex - 3), midIndex + 4)
        const windowIds = new Set(windowStoreys.map((storey) => storey.id))

        const singleStart = performance.now()
        const single = await extractContinuityStoreyInputs(api, modelId, {
          storeyIds: new Set([storeys[midIndex].id]),
        })
        const singleMs = performance.now() - singleStart

        const windowStart = performance.now()
        const windowExtraction = await extractContinuityStoreyInputs(api, modelId, {
          storeyIds: windowIds,
        })
        const windowMs = performance.now() - windowStart

        // Full-model extraction is what the app actually runs (measured well
        // under the 10 s UI budget, so no storey scoping is needed on 096-A).
        const fullStart = performance.now()
        const extraction = await extractContinuityStoreyInputs(api, modelId)
        const fullMs = performance.now() - fullStart

        expect(single.storeys).toHaveLength(1)
        expect(windowExtraction.storeys).toHaveLength(windowStoreys.length)
        expect(extraction.storeys).toHaveLength(storeys.length)

        // Unit-frame check: GetFlatMesh footprints must be metres. A 096
        // storey plan spans tens of metres; raw cm would span thousands.
        const obstructions = extraction.storeys.flatMap((storey) => storey.obstructions)
        expect(obstructions.length).toBeGreaterThan(0)
        let minX = Infinity
        let maxX = -Infinity
        for (const obstruction of obstructions) {
          if (obstruction.footprint.shape !== 'bbox') continue
          minX = Math.min(minX, obstruction.footprint.bounds.minX)
          maxX = Math.max(maxX, obstruction.footprint.bounds.maxX)
        }
        const planSpanX = maxX - minX
        expect(planSpanX).toBeGreaterThan(5)
        expect(planSpanX).toBeLessThan(1000)

        const buildStart = performance.now()
        const map = buildContinuityMap({ units: 'm', storeys: extraction.storeys })
        const buildMs = performance.now() - buildStart

        const blockedCells = map.grids.reduce(
          (sum, grid) => sum + grid.blocked.reduce<number>((acc, cell) => acc + cell, 0),
          0,
        )
        expect(blockedCells).toBeGreaterThan(0)
        expect(map.shaftCandidates.length).toBeGreaterThan(0)

        console.log(
          `[096-A continuity timings] single storey extract: ${Math.round(singleMs)} ms; ` +
            `${windowStoreys.length}-storey window extract: ${Math.round(windowMs)} ms; ` +
            `full ${storeys.length}-storey extract: ${Math.round(fullMs)} ms; ` +
            `buildContinuityMap (${extraction.storeys.length} storeys): ${Math.round(buildMs)} ms; ` +
            `obstructions=${obstructions.length}, blockedCells=${blockedCells}, ` +
            `shaftCandidates=${map.shaftCandidates.length}, planSpanX=${planSpanX.toFixed(1)} m`,
        )
      } finally {
        api.CloseModel(modelId)
      }
    },
  )
})
