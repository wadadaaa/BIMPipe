import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStoreys } from './parseStoreys'
import { chooseInitialStoreyByFixtures } from './scanStoreyFixtures'

// Real-engine test against the bundled Duplex sample (no gating): the scan +
// chooser must auto-open "Level 1" — the lowest fixture-bearing storey — and
// never the roof. The old name heuristic opened "Level 2" via the name match;
// this pins the intended new behaviour for plain dev mode.
const DUPLEX_PATH = path.resolve(process.cwd(), 'public/samples/Duplex_MEP_20110907.ifc')

const TEST_TIMEOUT_MS = 60_000

describe('chooseInitialStoreyByFixtures on the bundled Duplex sample', () => {
  it(
    'picks Level 1 (lowest fixture-bearing storey), not Level 2 or the roof',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(DUPLEX_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, 'duplex-test')
        expect(storeys.length).toBeGreaterThanOrEqual(3)

        const decision = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        console.info(
          `[duplex chooser] chose "${decision.storeyName}" in ${decision.scanMs} ms — ${decision.reason}`,
        )

        expect(decision.storeyName).toMatch(/level 1/i)
        expect(decision.storeyName).not.toMatch(/roof/i)
        expect(decision.reason).not.toHaveLength(0)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
