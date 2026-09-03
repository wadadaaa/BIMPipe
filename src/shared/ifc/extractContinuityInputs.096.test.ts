import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isShaftLikeName } from '@/domain/continuityMap'
import { listSpacesWithNames } from './extractContinuityInputs'

/**
 * Gated test against the local (gitignored) 096-A architecture model.
 * Skips cleanly when the client file is absent (e.g. CI).
 *
 * Scope is intentionally limited to storey + space parsing: full geometry
 * extraction (extractContinuityStoreyInputs) tessellates walls/slabs/columns
 * for 13 storeys of a 63.5 MB model, which is minutes-level work and does not
 * belong in a unit test. The coordinator's live check covers that path.
 */
const IFC_096A_PATH = path.resolve(process.cwd(), 'external/projects/096/096-A.ifc')
const has096A = existsSync(IFC_096A_PATH)

describe.skipIf(!has096A)('096-A continuity inputs (gated on local client file)', () => {
  it(
    'parses storeys and finds at least one shaft-named IfcSpace',
    { timeout: 300_000 },
    async () => {
      const { IfcAPI } = await import('web-ifc')
      const api = new IfcAPI()
      await api.Init()

      const modelId = api.OpenModel(new Uint8Array(readFileSync(IFC_096A_PATH)))
      try {
        const { parseStoreys } = await import('./parseStoreys')
        const storeys = await parseStoreys(api, modelId, 'gated-096a')
        expect(storeys.length).toBeGreaterThanOrEqual(1)

        const spaces = await listSpacesWithNames(api, modelId)
        expect(spaces.length).toBeGreaterThanOrEqual(1)

        const shaftNamed = spaces.filter((space) => isShaftLikeName(space.name))
        expect(shaftNamed.length).toBeGreaterThanOrEqual(1)
      } finally {
        api.CloseModel(modelId)
      }
    },
  )
})
