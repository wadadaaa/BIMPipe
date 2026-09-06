import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import type { FixtureKind } from '@/domain/types'
import { parseStoreys } from './parseStoreys'
import { classifyFixtureText, detectFixtures, readLineText, type FixtureTextClassification } from './detectFixtures'
import { scanStoreyFixtureCounts } from './scanStoreyFixtures'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'

// Gated regression against the real SHBJ project (client data, gitignored).
// Skips cleanly when the files are absent. Revit IFC2X3 exports in CENTIMETRE;
// every plumbing fixture is an IfcFlowTerminal named `Category : Family : Type`
// with a bilingual (English family / Hebrew type) label.
//
// Before this classifier fix storey L04 of the sanitary model reported 21
// toilets and 0 basins: every wall-hung basin family carries a bare `WC`
// token (`…-Sink-WC-…`) that the toilet rule matched first. The architecture
// model double-counted each flushing tank as a toilet and missed the
// multi-bowl sink families entirely.
const SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')
const AR_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-AR.ifc')
const STOREY_NAME = 'L04'

const TEST_TIMEOUT_MS = 180_000

interface StoreyProfile {
  detected: Partial<Record<FixtureKind, number>>
  scanned: Partial<Record<FixtureKind, number>>
  detectedTotal: number
  flowTerminalCount: number
  /** Every IfcFlowTerminal of the storey by text classification outcome. */
  flowTerminalOutcomes: Record<string, number>
}

async function profileStorey(api: IfcAPI, filePath: string): Promise<StoreyProfile> {
  const ifc = await import('web-ifc')
  const modelId = api.OpenModel(readFileSync(filePath))
  try {
    const storeys = await parseStoreys(api, modelId, 'shbj-test')
    const storey = storeys.find((candidate) => candidate.name === STOREY_NAME)
    expect(storey, `storey ${STOREY_NAME} in ${path.basename(filePath)}`).toBeDefined()

    const fixtures = await detectFixtures(api, modelId, storey!.id)
    const detected: Partial<Record<FixtureKind, number>> = {}
    for (const fixture of fixtures) detected[fixture.kind] = (detected[fixture.kind] ?? 0) + 1

    const scan = await scanStoreyFixtureCounts(api, modelId, [storey!.id])

    const { elementIds } = await collectSpatialTreeElements(api, modelId, storey!.id)
    const flowTerminalIds = api.GetLineIDsWithType(modelId, ifc.IFCFLOWTERMINAL)
    const flowTerminalOutcomes: Record<string, number> = {}
    let flowTerminalCount = 0
    for (let i = 0; i < flowTerminalIds.size(); i++) {
      const expressId = flowTerminalIds.get(i)
      if (!elementIds.has(expressId)) continue
      flowTerminalCount += 1
      const line = api.GetLine(modelId, expressId, false)
      const outcome = describeOutcome(classifyFixtureText(readLineText(line)))
      flowTerminalOutcomes[outcome] = (flowTerminalOutcomes[outcome] ?? 0) + 1
    }

    return {
      detected,
      scanned: scan.get(storey!.id)?.countsByKind ?? {},
      detectedTotal: fixtures.length,
      flowTerminalCount,
      flowTerminalOutcomes,
    }
  } finally {
    api.CloseModel(modelId)
  }
}

function describeOutcome(classification: FixtureTextClassification): string {
  if (classification.type === 'fixture') return `fixture:${classification.kind}`
  if (classification.type === 'excluded') return `excluded:${classification.reason}`
  return 'unmatched'
}

async function openApi(): Promise<IfcAPI> {
  const ifc = await import('web-ifc')
  const api = new ifc.IfcAPI()
  await api.Init()
  return api
}

describe.skipIf(!existsSync(SA_PATH))('shbj-SA fixture classification (gated: requires local client file)', () => {
  it(
    `storey ${STOREY_NAME}: 11 toilets, 10 basins, 1 slop sink; traps/drains/fire excluded with a reason`,
    async () => {
      const api = await openApi()
      const profile = await profileStorey(api, SA_PATH)
      console.info(`[shbj-SA ${STOREY_NAME}]`, JSON.stringify(profile))

      // 10 wall-hung WCs + 1 accessible WC (Hebrew construct form אסלת).
      expect(profile.detected.TOILETPAN).toBe(11)
      // 10 wall-hung oval basins from the `…-Sink-WC-…` family (Hebrew כיור → WASHHANDBASIN).
      expect(profile.detected.WASHHANDBASIN).toBe(10)
      // The slop sink (עביט שפכין) is a drainage-connected utility fixture → SINK, not a kitchen sink.
      expect(profile.detected.SINK).toBe(1)
      expect(profile.detected.URINAL).toBeUndefined()
      expect(profile.detected.CISTERN).toBeUndefined()
      expect(profile.detected.OTHER).toBeUndefined()
      expect(profile.detectedTotal).toBe(22)

      // The position-free scan agrees (no proxies to dedupe on this storey).
      expect(profile.scanned).toEqual({ TOILETPAN: 11, WASHHANDBASIN: 10, SINK: 1 })

      // All 42 IfcFlowTerminals on the storey are accounted for explicitly:
      // 22 fixtures, 11 P-traps (accessory), 9 floor traps / drains / roof outlets.
      expect(profile.flowTerminalCount).toBe(42)
      expect(profile.flowTerminalOutcomes).toEqual({
        'fixture:TOILETPAN': 11,
        'fixture:WASHHANDBASIN': 10,
        'fixture:SINK': 1,
        'excluded:accessory': 11,
        'excluded:floor-drain': 9,
      })
      expect(profile.flowTerminalOutcomes.unmatched).toBeUndefined()
    },
    TEST_TIMEOUT_MS,
  )
})

describe.skipIf(!existsSync(AR_PATH))('shbj-AR fixture classification (gated: requires local client file)', () => {
  it(
    `storey ${STOREY_NAME}: 17 toilets, 2 urinals, 2 multi-bowl sinks; flushing tank and fire cabinets excluded`,
    async () => {
      const api = await openApi()
      const profile = await profileStorey(api, AR_PATH)
      console.info(`[shbj-AR ${STOREY_NAME}]`, JSON.stringify(profile))

      // 10 standard + 1 disabled + 5 chemical wall WCs + 1 commercial wall toilet.
      // The single `Flushing-Tank-for-Toilet` accessory is NOT counted (was 18).
      expect(profile.detected.TOILETPAN).toBe(17)
      expect(profile.detected.URINAL).toBe(2)
      // `Multi-Sinks : 4 Sinks` and `: 5 Sinks` — ONE SINK fixture per IfcFlowTerminal,
      // never one per bowl.
      expect(profile.detected.SINK).toBe(2)
      expect(profile.detected.WASHHANDBASIN).toBeUndefined()
      expect(profile.detected.CISTERN).toBeUndefined()
      expect(profile.detected.OTHER).toBeUndefined()
      expect(profile.detectedTotal).toBe(21)
      expect(profile.scanned).toEqual({ TOILETPAN: 17, URINAL: 2, SINK: 2 })

      // 28 IfcFlowTerminals: 21 fixtures, 1 flushing tank, 6 hydrant fire cabinets.
      expect(profile.flowTerminalCount).toBe(28)
      expect(profile.flowTerminalOutcomes).toEqual({
        'fixture:TOILETPAN': 17,
        'fixture:URINAL': 2,
        'fixture:SINK': 2,
        'excluded:accessory': 1,
        'excluded:fire-protection': 6,
      })
    },
    TEST_TIMEOUT_MS,
  )
})
