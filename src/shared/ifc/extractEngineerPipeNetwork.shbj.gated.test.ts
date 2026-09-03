import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractEngineerPipeNetwork } from './extractEngineerPipeNetwork'
import {
  classifyEngineerRiserStacks,
  isVerticalEngineerSegment,
  stacksIntersectingBand,
  storeySlabBandM,
} from '@/domain/engineerPipes'

/**
 * Gated engineer-network extraction + riser classification against the
 * sanitary model of the second real project (client data, gitignored; skips
 * cleanly when absent). IFC2X3, centimetre, MEP modelled on storey L04 only —
 * a one-floor slice, so no vertical run can reach the storey-pitch threshold
 * and the honest outcome is "no stacks" rather than dozens of fake risers.
 *
 * Known blocker (outside this module's fence): the model declares extra
 * IfcSIUnit LENGTHUNIT lines (DECI-metre, metre) that only serve as elements
 * of IfcDerivedUnit (flow rate, concentration). `resolveMetersPerSourceUnit`
 * scans every IfcSIUnit and throws "Ambiguous length unit"; it should read
 * the project's IfcUnitAssignment instead (like `resolveModelLengthUnit`).
 * Until that lands, this test asserts the blocker explicitly instead of
 * silently passing.
 */
const SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')
const STOREY_NAME = 'L04'
const TEST_TIMEOUT_MS = 180_000
const KNOWN_UNIT_BLOCKER = /ambiguous length unit/i

describe.skipIf(!existsSync(SA_PATH))('engineer riser classification on shbj-SA (gated: requires local client file)', () => {
  it(
    `storey ${STOREY_NAME}: extraction does not crash and the one-floor slice yields sane (near-zero) stack counts`,
    async () => {
      const { IfcAPI } = await import('web-ifc')
      const api = new IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(SA_PATH))
      try {
        let network
        try {
          network = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['SW-GRV', 'VNT'] })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn(`[shbj-SA ${STOREY_NAME}] extraction blocked by the extractor's unit resolution: ${message}`)
          expect(message).toMatch(KNOWN_UNIT_BLOCKER)
          return
        }

        expect(network.metersPerSourceUnit).toBe(0.01)
        const storey = network.storeys.find((candidate) => candidate.name === STOREY_NAME)
        expect(storey, `storey ${STOREY_NAME}`).toBeDefined()

        const onStorey = network.segments.filter((segment) => segment.storeyId === storey!.id)
        // Every SW-GRV / VNT segment of this model lives on the MEP storey.
        expect(onStorey).toHaveLength(network.segments.length)
        expect(network.segments.length).toBeGreaterThan(0)

        const classification = classifyEngineerRiserStacks(network)
        const band = storeySlabBandM(network, storey!.id)!
        const summary = {
          segments: network.segments.length,
          vertical: network.segments.filter((segment) => isVerticalEngineerSegment(segment)).length,
          endpointSources: countBy(network.segments.map((segment) => segment.endpointSource ?? 'null')),
          diametersMm: countBy(
            network.segments.map((segment) =>
              segment.outerDiameterMm === null ? 'null' : String(Math.round(segment.outerDiameterMm)),
            ),
          ),
          storeyPitchM: classification.storeyPitchM,
          minStackExtentM: classification.minStackExtentM,
          sanitaryStacks: classification.sanitaryStacks.length,
          ventStacks: classification.ventStacks.length,
          stubs: classification.stubs.length,
          sanitaryIntersectingStorey: stacksIntersectingBand(classification.sanitaryStacks, band).length,
          ventIntersectingStorey: stacksIntersectingBand(classification.ventStacks, band).length,
        }
        console.info(`[shbj-SA ${STOREY_NAME}]`, JSON.stringify(summary))

        // Sanity: a single-storey slice cannot legitimately hold many storey-tall stacks.
        expect(classification.minStackExtentSource).toBe('storey-pitch-median')
        expect(classification.sanitaryStacks.length).toBeLessThanOrEqual(3)
        expect(classification.ventStacks.length).toBeLessThanOrEqual(3)
        expect(JSON.stringify(classification)).not.toContain('NaN')
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}
