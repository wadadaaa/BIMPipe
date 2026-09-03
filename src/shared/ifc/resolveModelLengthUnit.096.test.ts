import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import { parseStoreys } from './parseStoreys'
import { formatLengthM } from '@/shared/lengthUnits'

// Gated on local client data: external/projects/ is gitignored, so this suite
// skips cleanly on machines without the 096 reference files (e.g. CI).
// Vitest runs with cwd at the repo root (where vite.config.ts lives).
const IFC_096_P_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')
const has096P = existsSync(IFC_096_P_PATH)

describe.skipIf(!has096P)('096-P.ifc length unit (gated on local client data)', () => {
  // 17 MB IFC2X3 Revit export — parsing takes tens of seconds; keep a generous timeout.
  it(
    'resolves CENTIMETRE and formats storey 01 elevation as 30.15 m',
    async () => {
      const { IfcAPI } = await import('web-ifc')
      const api = new IfcAPI()
      await api.Init()

      const modelId = api.OpenModel(new Uint8Array(readFileSync(IFC_096_P_PATH)))
      try {
        const unit = await resolveModelLengthUnit(api, modelId)
        expect(unit).toBe('cm')

        const storeys = await parseStoreys(api, modelId, 'model-096-p')
        const storey01 = storeys.find((storey) => storey.name === '01')
        expect(storey01).toBeDefined()

        // Elevation is a raw IFC attribute in source units (cm), ~3015.
        expect(storey01!.elevation).toBeCloseTo(3015, 6)
        // The single converter is what turns it into the required display string.
        expect(formatLengthM(storey01!.elevation, unit!)).toBe('30.15 m')
      } finally {
        api.CloseModel(modelId)
      }
    },
    180_000,
  )
})
