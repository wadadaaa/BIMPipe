import type { IfcAPI } from 'web-ifc'
import { detectPlanUnits, type Point3D } from '@/shared/routes/planGeometry'
import {
  chooseModelOrigin,
  isFarFromOrigin,
  type ModelOriginDecision,
} from '@/shared/frame/modelFrame'
import { resolveLocalPlacementWorldMatrix } from './localPlacementMatrix'

export interface PlanBoundsM {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface PlacementOriginProbe {
  /** Placement world position in raw IFC source units (Z-up, unknown unit). */
  sourcePoint: { x: number; y: number; z: number }
  entity: 'site' | 'building'
  /**
   * Far verdict using the detectPlanUnits convention (coords > 1000 are treated
   * as mm-scale, otherwise metres). The real unit assignment is not read here —
   * that belongs to the units task — so this is a detection signal only; the
   * origin value always comes from geometry, which web-ifc already normalizes
   * to metres.
   */
  farFromOrigin: boolean
}

/**
 * Reads the IfcSite (preferred) or IfcBuilding ObjectPlacement world position.
 * Returns null when neither exists or the placement chain is unresolvable —
 * detection then falls back to the storey-geometry centroid alone.
 */
export async function readPlacementOriginProbe(
  api: IfcAPI,
  modelId: number,
): Promise<PlacementOriginProbe | null> {
  const { IFCSITE, IFCBUILDING } = await import('web-ifc')

  for (const [typeConstant, entity] of [
    [IFCSITE, 'site'],
    [IFCBUILDING, 'building'],
  ] as const) {
    try {
      const ids = api.GetLineIDsWithType(modelId, typeConstant)
      for (let i = 0; i < ids.size(); i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const line = api.GetLine(modelId, ids.get(i), false) as any
        const placementId: number | undefined = line?.ObjectPlacement?.value
        if (typeof placementId !== 'number') continue

        const matrix = resolveLocalPlacementWorldMatrix(api, modelId, placementId)
        const elements = matrix.elements
        const sourcePoint = { x: elements[12], y: elements[13], z: elements[14] }
        // IFC placements are Z-up: the horizontal plan axes are X and Y.
        const unitGuess = detectPlanUnits([{ x: sourcePoint.x, y: 0, z: sourcePoint.y }])
        return {
          sourcePoint,
          entity,
          farFromOrigin: isFarFromOrigin(sourcePoint.x, sourcePoint.y, unitGuess),
        }
      }
    } catch {
      // Malformed placement chains must not break floor loading; fall through.
    }
  }

  return null
}

/**
 * Decides the model origin for local-frame rendering, once per model.
 *
 * Detection prefers the site/building placement (per product spec); the origin
 * *value* is always the artifact-filtered storey-geometry plan centre, because
 * geometry is the one signal that is reliably in viewer metres without a unit
 * reader. Both signals are deterministic for a given IFC file.
 *
 * Returns null when the storey has no usable geometry bounds — the caller
 * should retry on the next storey instead of freezing a wrong origin.
 */
export async function resolveModelOriginDecision(
  api: IfcAPI,
  modelId: number,
  sourcePlanBoundsM: PlanBoundsM | null,
): Promise<ModelOriginDecision | null> {
  if (sourcePlanBoundsM === null) return null
  const { minX, maxX, minZ, maxZ } = sourcePlanBoundsM
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX > maxX || minZ > maxZ) {
    return null
  }

  const centroid: Point3D = { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 }

  if (!isFarFromOrigin(centroid.x, centroid.z, 'm')) {
    // Near-origin model: identity frame, no placement probe needed.
    return { origin: { x: 0, y: 0, z: 0 }, detectedBy: 'none' }
  }

  const probe = await readPlacementOriginProbe(api, modelId)
  if (probe?.farFromOrigin) {
    return chooseModelOrigin({
      // The placement provides the detection label; the centroid provides the
      // metric value (see the module docstring on the unit gap).
      [probe.entity === 'site' ? 'sitePlacement' : 'buildingPlacement']: centroid,
    })
  }

  return chooseModelOrigin({ storeyGeometryCentroid: centroid })
}
