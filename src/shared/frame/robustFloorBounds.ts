import { FAR_FROM_ORIGIN_THRESHOLD_M, type Bounds3D } from './modelFrame'

/**
 * Outlier-robust bounds for the floor viewer (W1 follow-up).
 *
 * Real IFC storeys contain meshes that are useless for camera fitting:
 *
 * - geometry misplaced kilometres away in plan (surveyor/shared coordinates
 *   baked into individual elements while the building sits elsewhere), and
 * - full-height vertical runs (vent/pipe stacks modelled as one element and
 *   assigned to the storey they start on) whose 100 m+ vertical extent makes
 *   the floor box taller than the floor plan, which both inflates the fit and
 *   flips the viewer's smallest-axis-is-up inference into a section view.
 *
 * The heuristic is median-based clustering on MESH-LEVEL bounding-box centres
 * — robust (a minority of outliers cannot drag a median) and explainable:
 *
 * 1. A mesh whose bbox centre lies further than 1 km in plan from the
 *    per-axis median centre is excluded entirely (nothing about a mesh
 *    kilometres away helps frame a floor).
 * 2. A plan-kept mesh whose bbox REACHES more than 20 m above or below the
 *    median vertical centre contributes its plan extent but not its vertical
 *    extent (its footprint is real; its multi-storey vertical reach is not
 *    floor-level information). Reach — not centre distance — is the test
 *    because shaft coverings anchored at the floor but extending ~34 m up
 *    have a centre only ~17 m out, yet still triple the floor box height.
 *    No single-storey slice is 20 m tall, so legitimate floor geometry
 *    (including double-height spaces) is never excluded.
 *
 * Known limitation, stated honestly: clustering is mesh-level. One mesh that
 * itself mixes building geometry with far-away geometry has a centre between
 * the two and cannot be split here.
 *
 * When nothing is excluded the result is exactly the union of the inputs, so
 * clean models (Duplex/ADAM) take the identity path with bit-identical bounds.
 */

/** Plan-distance threshold for excluding a mesh entirely (far-origin family). */
export const PLAN_OUTLIER_DISTANCE_M = FAR_FROM_ORIGIN_THRESHOLD_M

/** Vertical-reach threshold for excluding a mesh's Y extent from floor bounds. */
export const VERTICAL_OUTLIER_DISTANCE_M = 20

export interface RobustFloorBoundsResult {
  /** null when no mesh bounds were provided. */
  bounds: Bounds3D | null
  /** Meshes excluded entirely (plan centre >1 km from the median centre). */
  planOutlierMeshCount: number
  /** Meshes whose vertical extent was excluded (reach >20 m beyond the median centre). */
  verticalOutlierMeshCount: number
}

/**
 * Computes floor-viewer bounds from per-mesh bounding boxes, excluding far
 * outliers per the module heuristic. Deterministic for a given input order-set
 * (medians come from sorted copies). Inputs are expected to be finite —
 * NaN-vertex guarding happens upstream in the bounds accumulator.
 */
export function computeOutlierRobustFloorBounds(
  meshBounds: readonly Bounds3D[],
): RobustFloorBoundsResult {
  if (meshBounds.length === 0) {
    return { bounds: null, planOutlierMeshCount: 0, verticalOutlierMeshCount: 0 }
  }

  const centres = meshBounds.map((b) => ({
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    z: (b.minZ + b.maxZ) / 2,
  }))
  const medianX = median(centres.map((c) => c.x))
  const medianZ = median(centres.map((c) => c.z))

  const planKept: number[] = []
  for (let i = 0; i < meshBounds.length; i++) {
    const planDistance = Math.hypot(centres[i].x - medianX, centres[i].z - medianZ)
    if (planDistance <= PLAN_OUTLIER_DISTANCE_M) planKept.push(i)
  }

  // Degenerate case: no dominant cluster (e.g. two clusters both far from the
  // component-wise median point). Excluding everything would be a guess, so
  // fall back to the unfiltered union and report zero exclusions.
  if (planKept.length === 0) {
    return {
      bounds: unionBounds(meshBounds, allIndices(meshBounds.length), allIndices(meshBounds.length)),
      planOutlierMeshCount: 0,
      verticalOutlierMeshCount: 0,
    }
  }

  // Vertical median comes from the plan-kept meshes so kilometre-scale strays
  // cannot skew it. A mesh is vertical-kept only when its whole Y extent stays
  // within the reach threshold of the median centre.
  const medianY = median(planKept.map((i) => centres[i].y))
  const verticalKept = planKept.filter(
    (i) =>
      meshBounds[i].maxY <= medianY + VERTICAL_OUTLIER_DISTANCE_M &&
      meshBounds[i].minY >= medianY - VERTICAL_OUTLIER_DISTANCE_M,
  )

  // Degenerate case: every plan-kept mesh reaches beyond the threshold (e.g. a
  // storey containing only full-height shafts). Excluding all Y information
  // would produce an empty box, so fall back to the unfiltered vertical union.
  if (verticalKept.length === 0) {
    return {
      bounds: unionBounds(meshBounds, planKept, planKept),
      planOutlierMeshCount: meshBounds.length - planKept.length,
      verticalOutlierMeshCount: 0,
    }
  }

  return {
    bounds: unionBounds(meshBounds, planKept, verticalKept),
    planOutlierMeshCount: meshBounds.length - planKept.length,
    verticalOutlierMeshCount: planKept.length - verticalKept.length,
  }
}

/** Union with independent index sets: X/Z from `planIndices`, Y from `verticalIndices`. */
function unionBounds(
  meshBounds: readonly Bounds3D[],
  planIndices: readonly number[],
  verticalIndices: readonly number[],
): Bounds3D {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const i of planIndices) {
    const b = meshBounds[i]
    if (b.minX < minX) minX = b.minX
    if (b.maxX > maxX) maxX = b.maxX
    if (b.minZ < minZ) minZ = b.minZ
    if (b.maxZ > maxZ) maxZ = b.maxZ
  }

  let minY = Infinity, maxY = -Infinity
  for (const i of verticalIndices) {
    const b = meshBounds[i]
    if (b.minY < minY) minY = b.minY
    if (b.maxY > maxY) maxY = b.maxY
  }

  return { minX, minY, minZ, maxX, maxY, maxZ }
}

function allIndices(length: number): number[] {
  return Array.from({ length }, (_, i) => i)
}

/** Deterministic median: element at floor(n/2) of the ascending sort. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
