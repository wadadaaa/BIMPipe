import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { IfcAPI } from 'web-ifc'
import { parseGauntletFloorSpec, type GauntletFloorSpec, type GauntletOpenedModels } from './gauntletFloorPipeline'

/**
 * The two gauntlet floors, by file code only (client files live under the
 * gitignored `external/`; these specs skip cleanly when the files are absent).
 * Neutral sheet labels; the storey selectors match the gated placement tests.
 */
export const GAUNTLET_BUILTIN_FLOOR_SPECS: Readonly<Record<string, GauntletFloorSpec>> = {
  '096-01': parseGauntletFloorSpec({
    floor: '096-01',
    host: { path: 'external/projects/096/096-P.ifc', fileName: '096-P.ifc' },
    linked: [{ path: 'external/projects/096/096-A.ifc', fileName: '096-A.ifc' }],
    storey: { name: '01' },
    storeyLabel: 'Storey 01',
    typology: 'residential',
  }),
  'shbj-L04': parseGauntletFloorSpec({
    floor: 'shbj-L04',
    host: { path: 'external/projects/shbj/shbj-SA.ifc', fileName: 'SA.ifc' },
    linked: [
      { path: 'external/projects/shbj/shbj-AR.ifc', fileName: 'AR.ifc' },
      { path: 'external/projects/shbj/shbj-ST.ifc', fileName: 'ST.ifc' },
    ],
    storey: { name: 'L04', elevationSource: 1800 },
    storeyLabel: 'Storey 04',
    typology: 'office',
  }),
}

export function resolveSpecPaths(spec: GauntletFloorSpec, rootDir: string = process.cwd()): string[] {
  return [spec.host, ...spec.linked].map((ref) => path.resolve(rootDir, ref.path))
}

export function specFilesExist(spec: GauntletFloorSpec, rootDir: string = process.cwd()): boolean {
  return resolveSpecPaths(spec, rootDir).every((file) => existsSync(file))
}

/** Opens the spec's files in web-ifc (host first). Caller closes them. */
export function openSpecModels(api: IfcAPI, spec: GauntletFloorSpec, rootDir: string = process.cwd()): GauntletOpenedModels {
  const [hostPath, ...linkedPaths] = resolveSpecPaths(spec, rootDir)
  const host = api.OpenModel(readFileSync(hostPath))
  const linked = linkedPaths.map((file) => api.OpenModel(readFileSync(file)))
  return { host, linked }
}

export function closeSpecModels(api: IfcAPI, models: GauntletOpenedModels): void {
  api.CloseModel(models.host)
  for (const id of models.linked) api.CloseModel(id)
}
