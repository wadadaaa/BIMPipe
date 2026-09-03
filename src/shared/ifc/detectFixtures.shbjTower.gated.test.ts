import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FixtureKind } from '@/domain/types'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'
import { classifyFixtureText, detectFixtures, readLineText } from './detectFixtures'
import { parseStoreys } from './parseStoreys'

// Gated regression against the architecture tower band of the second real
// project (client data, gitignored; skips cleanly when absent): a three-storey
// slice (L10-L12) whose typical floor repeats the same sanitary layout. Each
// floor carries one flushing-tank accessory next to its toilets; it must be
// excluded with a reason and never counted as a fixture.
const TOWER_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-AR-tower-L10-12.ifc')
const STOREY_NAME = 'L11'

const TEST_TIMEOUT_MS = 300_000

describe.skipIf(!existsSync(TOWER_PATH))('shbj tower band fixture detection (gated: requires local client file)', () => {
  it(
    `storey ${STOREY_NAME}: 11 toilets, 2 multi-bowl sinks, 2 urinals; the flushing tank is excluded`,
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(TOWER_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, 'shbj-tower')
        expect(storeys.map((s) => s.name)).toEqual(['L10', 'L11', 'L12'])
        const storey = storeys.find((s) => s.name === STOREY_NAME)!

        const fixtures = await detectFixtures(api, modelId, storey.id)
        const counts: Partial<Record<FixtureKind, number>> = {}
        for (const fixture of fixtures) counts[fixture.kind] = (counts[fixture.kind] ?? 0) + 1

        const { elementIds } = await collectSpatialTreeElements(api, modelId, storey.id)
        const flowTerminalIds = api.GetLineIDsWithType(modelId, ifc.IFCFLOWTERMINAL)
        const outcomes: Record<string, number> = {}
        for (let i = 0; i < flowTerminalIds.size(); i++) {
          const expressId = flowTerminalIds.get(i)
          if (!elementIds.has(expressId)) continue
          const classification = classifyFixtureText(readLineText(api.GetLine(modelId, expressId, false)))
          const key =
            classification.type === 'fixture'
              ? `fixture:${classification.kind}`
              : classification.type === 'excluded'
                ? `excluded:${classification.reason}`
                : 'unmatched'
          outcomes[key] = (outcomes[key] ?? 0) + 1
        }
        console.info(`[shbj tower ${STOREY_NAME}]`, JSON.stringify(counts), JSON.stringify(outcomes))

        expect(counts).toEqual({ TOILETPAN: 11, SINK: 2, URINAL: 2 })
        expect(fixtures).toHaveLength(15)
        expect(outcomes).toEqual({
          'fixture:TOILETPAN': 11,
          'fixture:SINK': 2,
          'fixture:URINAL': 2,
          'excluded:accessory': 1,
        })
        // 0 tanks as fixtures: nothing typed CISTERN, nothing left as OTHER.
        expect(counts.CISTERN).toBeUndefined()
        expect(counts.OTHER).toBeUndefined()
        expect(fixtures.every((fixture) => fixture.position !== null)).toBe(true)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
