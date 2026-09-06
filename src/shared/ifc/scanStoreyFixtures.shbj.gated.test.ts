import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStoreys } from './parseStoreys'
import { chooseInitialStoreyByFixtures } from './scanStoreyFixtures'

// Gated regression against the second real project (client data, gitignored).
// Skips cleanly when the file is absent. The sanitary model has 34 storeys
// (sea level, two basements, L00..L29, two roof storeys) and exactly one
// fixture-bearing storey, L04. The chooser must open L04 — not the lowest
// storey, not a roof — and stay deterministic.
const IFC_SHBJ_SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')

const TEST_TIMEOUT_MS = 180_000

describe.skipIf(!existsSync(IFC_SHBJ_SA_PATH))('shbj-SA initial storey chooser (gated: requires local client file)', () => {
  it(
    'opens the only fixture-bearing storey L04',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(IFC_SHBJ_SA_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, 'shbj-test')
        expect(storeys).toHaveLength(34)

        const decision = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        console.info(
          `[shbj chooser] chose "${decision.storeyName}" in ${decision.scanMs} ms — ${decision.reason}`,
        )

        expect(decision.storeyName).toBe('L04')
        expect(decision.reason).toContain('1 family among 1 candidate(s)')

        const second = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        expect(second.storeyId).toBe(decision.storeyId)
        expect(second.reason).toBe(decision.reason)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
