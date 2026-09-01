import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStoreys } from './parseStoreys'
import { chooseInitialStoreyByFixtures, scanStoreyFixtureCounts } from './scanStoreyFixtures'

// Gated regression against the real 096 project (client data, gitignored).
// Skips cleanly when the file is absent. The model has 44 storeys (Sea Level,
// B1, R2, GF, 01..38, R0, R1); the old "floor named 2" heuristic wrongly
// opened the technical roof storey R2. The scan + chooser must open a member
// of the residential 01..38 group — never R2/R0/R1 — without generating any
// floor meshes.
const IFC_096_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')

const TEST_TIMEOUT_MS = 180_000

const RESIDENTIAL_NAME = /^(0[1-9]|[12][0-9]|3[0-8])$/

describe.skipIf(!existsSync(IFC_096_PATH))('096-P initial storey chooser (gated: requires local client file)', () => {
  it(
    'auto-select scan picks a residential storey 01..38, never R2/R0/R1 or roof',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(IFC_096_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, '096-test')
        expect(storeys).toHaveLength(44)

        const decision = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        console.info(
          `[096 chooser] chose "${decision.storeyName}" in ${decision.scanMs} ms — ${decision.reason}`,
        )

        // Member of the residential group; implicitly excludes R2/R0/R1, GF,
        // B1 and Sea Level. Observed data note: in 096-P fixtures exist on
        // only five storeys (Sea Level: 2 WCs, 01: 11, 08: 3, 37: 3, 38: 1 —
        // cross-checked against full detectFixtures), so the largest exact-
        // fingerprint group is {08, 37} and the chooser picks "08". Sea Level
        // has genuine toilets but loses to the larger residential group.
        expect(decision.storeyName).toMatch(RESIDENTIAL_NAME)
        expect(['R2', 'R0', 'R1']).not.toContain(decision.storeyName)

        // Determinism: a second scan+choose pass yields the identical choice.
        const second = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        expect(second.storeyId).toBe(decision.storeyId)
        expect(second.reason).toBe(decision.reason)

        // The scan itself must agree with the known reference fact: storey
        // "01" carries 11 toilets (position-free counting, pre-dedupe).
        const storey01 = storeys.find((storey) => storey.name === '01')
        expect(storey01).toBeDefined()
        const counts = await scanStoreyFixtureCounts(api, modelId, [storey01!.id])
        expect(counts.get(storey01!.id)?.toiletCount).toBe(11)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
