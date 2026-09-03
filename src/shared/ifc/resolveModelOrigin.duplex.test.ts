import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStoreys } from './parseStoreys'
import { extractFloorMeshes } from './extractFloorMeshes'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import { resolveModelOriginDecision } from './resolveModelOrigin'
import { readRepresentationContextFrame } from './readRepresentationContextFrame'

// Regression lock for the bundled Duplex sample (near-origin, identity WCS):
// the origin decision object must stay byte-identical when new detection
// sources (representation-context WCS / TrueNorth) are added. The inline
// snapshot was recorded BEFORE the context source existed.
const DUPLEX_PATH = path.resolve(process.cwd(), 'public/samples/Duplex_MEP_20110907.ifc')

const TEST_TIMEOUT_MS = 60_000

describe('resolveModelOriginDecision on the bundled Duplex sample', () => {
  it(
    'returns the identity frame with detectedBy none (snapshot)',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(DUPLEX_PATH))

      try {
        const unit = await resolveModelLengthUnit(api, modelId)
        const storeys = await parseStoreys(api, modelId, 'duplex-origin-test')
        const level1 = storeys.find((storey) => /level 1/i.test(storey.name ?? ''))
        expect(level1).toBeDefined()

        const meshes = await extractFloorMeshes(api, modelId, level1!.id)
        const box = meshes.sourceBoundingBox
        expect(box.isEmpty()).toBe(false)

        const decision = await resolveModelOriginDecision(
          api,
          modelId,
          { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
          unit,
        )

        expect(decision).toMatchInlineSnapshot(`
          {
            "detectedBy": "none",
            "origin": {
              "x": 0,
              "y": 0,
              "z": 0,
            },
          }
        `)

        // The Duplex representation context carries an identity WCS, so the
        // reader must report it as near-origin and the decision above must not
        // gain a sourceFrame.
        const context = await readRepresentationContextFrame(api, modelId, unit)
        expect(context).not.toBeNull()
        expect(Math.hypot(context!.wcsLocationSource.x, context!.wcsLocationSource.y)).toBeLessThan(1)
        expect('sourceFrame' in decision!).toBe(false)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
