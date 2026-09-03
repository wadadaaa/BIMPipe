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

/** Axis-aligned bounds in viewer metres (Y-up). */
export interface Bounds3D {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/**
 * Accumulates vertex bounds while tracking origin-artifact vertices
 * ((0,0,0)-adjacent strays) separately. `result()` returns the bounds with
 * artifacts dropped when the rest of the geometry is far from the origin;
 * for near-origin geometry (e.g. Duplex) every vertex counts, so legitimate
 * near-zero coordinates are never discarded.
 */
export interface ArtifactAwareBoundsAccumulator {
  add(x: number, y: number, z: number): void
  /** null when no vertices were added. */
  result(): Bounds3D | null
  /** Vertices skipped because a component was NaN/Infinity (broken exporter geometry). */
  nonFiniteVertexCount(): number
}

export function createArtifactAwareBoundsAccumulator(): ArtifactAwareBoundsAccumulator {
  let allMinX = Infinity, allMinY = Infinity, allMinZ = Infinity
  let allMaxX = -Infinity, allMaxY = -Infinity, allMaxZ = -Infinity
  let keptMinX = Infinity, keptMinY = Infinity, keptMinZ = Infinity
  let keptMaxX = -Infinity, keptMaxY = -Infinity, keptMaxZ = -Infinity
  let maxPlanDistance = 0
  let nonFinite = 0

  return {
    add(x, y, z) {
      // Real 096 storeys contain meshes with NaN vertices; a single NaN must
      // never poison the bounds, so the whole vertex is skipped and counted.
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        nonFinite += 1
        return
      }

      if (x < allMinX) allMinX = x
      if (x > allMaxX) allMaxX = x
      if (y < allMinY) allMinY = y
      if (y > allMaxY) allMaxY = y
      if (z < allMinZ) allMinZ = z
      if (z > allMaxZ) allMaxZ = z

      if (isOriginArtifactVertex(x, y, z)) return

      if (x < keptMinX) keptMinX = x
      if (x > keptMaxX) keptMaxX = x
      if (y < keptMinY) keptMinY = y
      if (y > keptMaxY) keptMaxY = y
      if (z < keptMinZ) keptMinZ = z
      if (z > keptMaxZ) keptMaxZ = z

      // Far-from-origin verdict comes from the non-artifact vertices (plan
      // axes X/Z in viewer metres) so artifacts cannot veto their own removal.
      const planDistance = Math.hypot(x, z)
      if (planDistance > maxPlanDistance) maxPlanDistance = planDistance
    },
    result() {
      if (!Number.isFinite(allMinX)) return null
      const useFiltered = Number.isFinite(keptMinX) && shouldDropOriginArtifacts(maxPlanDistance)
      return useFiltered
        ? { minX: keptMinX, minY: keptMinY, minZ: keptMinZ, maxX: keptMaxX, maxY: keptMaxY, maxZ: keptMaxZ }
        : { minX: allMinX, minY: allMinY, minZ: allMinZ, maxX: allMaxX, maxY: allMaxY, maxZ: allMaxZ }
    },
    nonFiniteVertexCount() {
      return nonFinite
    },
  }
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
  | 'context'
  | 'none'

/**
 * Documented ABSOLUTE frame of a model whose geometry sits near the origin
 * because the survey offset lives in the representation context's
 * WorldCoordinateSystem (Revit "Project Base Point" exports) rather than in the
 * site/building placement chain.
 *
 * web-ifc does not apply this WCS, so nothing is translated: the viewer renders
 * the geometry where it is, domain coordinates stay in project-base-point
 * space, and the export writes them back unchanged. This record exists so
 * exports and debug output can state where that space sits in the world.
 */
export interface ModelSourceFrame {
  detectedBy: 'context'
  /** WCS location in the model's declared length unit (IFC axes, Z-up). */
  offsetSourceUnits: { x: number; y: number; z: number }
  /** Same offset in metres; null when the model declares no usable length unit. */
  offsetM: { x: number; y: number; z: number } | null
  lengthUnit: LengthUnit | null
  /** TrueNorth angle from project +Y, degrees, positive toward +X; null when absent. */
  trueNorthDeg: number | null
  /** WCS RefDirection rotation about +Z, degrees counter-clockwise from +X; 0 when absent. */
  wcsRotationDeg: number
}

export interface ModelOriginDecision {
  /** Origin in viewer metres (Y-up); (0,0,0) when the model is near the origin. */
  origin: Point3D
  detectedBy: ModelOriginDetectedBy
  /**
   * Present only when `detectedBy === 'context'`. Absent (not null) otherwise
   * so decisions for placement/centroid/near-origin models stay byte-identical.
   */
  sourceFrame?: ModelSourceFrame
}

/** Structural input for {@link resolveContextSourceFrame}; matches `RepresentationContextFrame`. */
export interface ContextFrameInput {
  wcsLocationSource: { x: number; y: number; z: number }
  wcsLocationM: { x: number; y: number; z: number } | null
  lengthUnit: LengthUnit | null
  trueNorthDeg: number | null
  wcsRotationDeg: number
}

/**
 * Turns a representation-context reading into a source frame when — and only
 * when — the WCS is far from the origin (>1 km in plan). The far verdict uses
 * the declared unit; when the unit is undeclared it falls back to the same
 * magnitude convention as the placement probe (`detectPlanUnits`: raw values
 * above 1000 are treated as mm-scale, else metres). Returns null for an
 * identity/near WCS.
 */
export function resolveContextSourceFrame(context: ContextFrameInput): ModelSourceFrame | null {
  const { wcsLocationSource, wcsLocationM, lengthUnit } = context
  const verdictUnit: LengthUnit =
    lengthUnit ??
    (Math.max(Math.abs(wcsLocationSource.x), Math.abs(wcsLocationSource.y)) > 1000 ? 'mm' : 'm')
  if (!isFarFromOrigin(wcsLocationSource.x, wcsLocationSource.y, verdictUnit)) return null

  return {
    detectedBy: 'context',
    offsetSourceUnits: { ...wcsLocationSource },
    offsetM: wcsLocationM === null ? null : { ...wcsLocationM },
    lengthUnit,
    trueNorthDeg: context.trueNorthDeg,
    wcsRotationDeg: context.wcsRotationDeg,
  }
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
