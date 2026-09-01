import type { Point3D } from '@/shared/routes/planGeometry'

/**
 * Model-frame math for far-from-origin IFC models (W1).
 *
 * The viewer frame produced by web-ifc is metres, Y-up (X/Z is the plan plane).
 * Models placed at shared/survey coordinates (e.g. ~181 km east / ~664 km north)
 * destroy Float32 precision in the renderer and break camera fitting. The fix is
 * to render everything in a *local frame*: viewer geometry and markers have the
 * model origin subtracted, while all domain state (fixtures, risers, routes,
 * overrides, export) stays in source viewer coordinates.
 *
 * source point = local point + origin; local point = source point - origin.
 *
 * The origin is chosen so that Sterbenz's lemma applies to every coordinate near
 * the building (|coordinate| within a factor of two of |origin|), which makes the
 * source -> local -> source round trip bit-exact for the coordinates we care about.
 */

export type LengthUnit = 'mm' | 'cm' | 'm'

/** 1 km expressed in each supported IFC length unit. */
export const ONE_KILOMETRE_BY_UNIT: Record<LengthUnit, number> = {
  mm: 1_000_000,
  cm: 100_000,
  m: 1_000,
}

/** Far-from-origin threshold in the viewer frame (metres). */
export const FAR_FROM_ORIGIN_THRESHOLD_M = ONE_KILOMETRE_BY_UNIT.m

/**
 * A model is "far from origin" when its horizontal (plan) distance from (0,0)
 * exceeds 1 km, expressed in the unit the point is given in.
 */
export function isFarFromOrigin(planX: number, planY: number, unit: LengthUnit): boolean {
  return Math.hypot(planX, planY) > ONE_KILOMETRE_BY_UNIT[unit]
}

/**
 * Radius (in viewer metres) around the world origin inside which a vertex of an
 * otherwise far-from-origin mesh is treated as an exporter artifact. Real
 * geometry of a building that sits >1 km away never has vertices this close to
 * (0,0,0); stray zero vertices do, and they poison bbox/centroid math.
 */
export const ORIGIN_ARTIFACT_RADIUS_M = 1

export function isOriginArtifactVertex(x: number, y: number, z: number): boolean {
  return Math.hypot(x, y, z) < ORIGIN_ARTIFACT_RADIUS_M
}

/**
 * Origin-artifact vertices are only dropped when the mesh is otherwise far from
 * the origin — near-origin models (Duplex, ADAM demo) legitimately have geometry
 * at (0,0,0) and must never be corrupted.
 */
export function shouldDropOriginArtifacts(maxPlanDistanceM: number): boolean {
  return maxPlanDistanceM > FAR_FROM_ORIGIN_THRESHOLD_M
}

/**
 * A rendering frame for one model. `origin` is in viewer metres (Y-up). The
 * identity frame (origin 0,0,0) leaves all coordinates untouched, which keeps
 * near-origin models byte-identical to the pre-W1 behavior.
 */
export interface ModelFrame {
  readonly origin: Point3D
}

export const IDENTITY_MODEL_FRAME: ModelFrame = Object.freeze({
  origin: Object.freeze({ x: 0, y: 0, z: 0 }),
})

/**
 * Creates a frame whose origin is quantized to whole metres. Quantizing keeps
 * the origin human-readable in debug output and deterministic against tiny
 * float noise in centroid math. The vertical component is always 0: elevations
 * are small (tens of metres) and never need re-centering, and keeping Y
 * untouched means storey Y anchors and riser Y offsets are identical in both
 * frames.
 */
export function createModelFrame(origin: Point3D): ModelFrame {
  return {
    origin: {
      x: quantizeOriginComponent(origin.x),
      y: 0,
      z: quantizeOriginComponent(origin.z),
    },
  }
}

function quantizeOriginComponent(value: number): number {
  const rounded = Math.round(value)
  // Normalize -0 so identity frames compare cleanly.
  return rounded === 0 ? 0 : rounded
}

export function isIdentityModelFrame(frame: ModelFrame): boolean {
  return frame.origin.x === 0 && frame.origin.y === 0 && frame.origin.z === 0
}

/** source -> local (what the viewer renders). */
export function toLocalPoint(frame: ModelFrame, point: Point3D): Point3D {
  return {
    x: point.x - frame.origin.x,
    y: point.y - frame.origin.y,
    z: point.z - frame.origin.z,
  }
}

/** local -> source (what drag/add handlers store back into domain state). */
export function toSourcePoint(frame: ModelFrame, point: Point3D): Point3D {
  return {
    x: point.x + frame.origin.x,
    y: point.y + frame.origin.y,
    z: point.z + frame.origin.z,
  }
}

export type ModelOriginDetectedBy =
  | 'site-placement'
  | 'building-placement'
  | 'storey-geometry'
  | 'none'

export interface ModelOriginDecision {
  /** Origin in viewer metres (Y-up); (0,0,0) when the model is near the origin. */
  origin: Point3D
  detectedBy: ModelOriginDetectedBy
}

export interface ModelOriginCandidates {
  /** IfcSite placement world position, already in viewer metres, or null. */
  sitePlacement?: Point3D | null
  /** IfcBuilding placement world position, already in viewer metres, or null. */
  buildingPlacement?: Point3D | null
  /** Artifact-filtered storey-geometry centroid in viewer metres, or null. */
  storeyGeometryCentroid?: Point3D | null
}

/**
 * Chooses the model origin: prefer the site placement, then the building
 * placement, then the storey-geometry centroid. A candidate is only adopted
 * when it is far from the origin (>1 km in plan); otherwise the model is
 * treated as near-origin and the identity origin is returned.
 */
export function chooseModelOrigin(candidates: ModelOriginCandidates): ModelOriginDecision {
  const ranked: Array<[Point3D | null | undefined, ModelOriginDetectedBy]> = [
    [candidates.sitePlacement, 'site-placement'],
    [candidates.buildingPlacement, 'building-placement'],
    [candidates.storeyGeometryCentroid, 'storey-geometry'],
  ]

  for (const [candidate, detectedBy] of ranked) {
    if (!candidate) continue
    if (!isFarFromOrigin(candidate.x, candidate.z, 'm')) continue
    return { origin: createModelFrame(candidate).origin, detectedBy }
  }

  return { origin: { x: 0, y: 0, z: 0 }, detectedBy: 'none' }
}
