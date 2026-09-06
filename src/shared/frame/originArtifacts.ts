import type { Bounds3D } from './modelFrame'

/**
 * Shared world-origin artifact guard (V2).
 *
 * Some exporters leave stray vertices sitting exactly at the world origin
 * (uninitialised points). In a mesh that lives far from the origin such a
 * vertex drags every bounding box / centroid toward (0,0,0). Before V2 each
 * consumer had its own rule (a 1 m radius gated on a >1 km storey, a relative
 * 1e-6 x max-norm threshold, an unconditional exact-zero drop); this module is
 * the single definition used by floor-mesh bounds, fixture centroids,
 * continuity footprints and the engineer pipe mesh-bounds fallback.
 *
 * Rule — a vertex is dropped when BOTH hold:
 *   1. it is numerically exactly at the origin: every component has
 *      |c| <= ORIGIN_EXACT_EPSILON_M (1 nm; absorbs float rounding of a true
 *      zero, never a real coordinate), and
 *   2. it is ISOLATED from the rest of the mesh: the Euclidean distance from
 *      the origin to the axis-aligned bounding box of the remaining vertices
 *      is greater than ORIGIN_ARTIFACT_ISOLATION_FACTOR (10) x the largest
 *      side of that box, where the side is floored at
 *      ORIGIN_ARTIFACT_MIN_EXTENT_M (1 m) so a degenerate or sub-metre mesh
 *      still needs the origin to be at least 10 m away.
 *
 * Consequences, stated so they are not surprising:
 *   - A mesh with no exact-zero vertex is returned untouched, whatever its
 *     location (near-origin models such as Duplex never change).
 *   - A mesh whose vertices are ALL at the origin keeps them (degenerate but
 *     legitimate geometry; there is no "rest" to be isolated from).
 *   - A zero vertex inside or near the mesh's own box (distance <= 10 x extent)
 *     is kept — geometry legitimately touching the origin is not an artifact.
 *   - A large element close to the origin (e.g. a 30 m wall 200 m away) keeps
 *     a stray zero vertex; the 10x factor prefers false keeps over false drops.
 *   - The decision is per mesh (one element's vertex set), never per storey.
 *
 * All coordinates are viewer metres (web-ifc world frame, Y-up).
 */

export const ORIGIN_EXACT_EPSILON_M = 1e-9
export const ORIGIN_ARTIFACT_ISOLATION_FACTOR = 10
export const ORIGIN_ARTIFACT_MIN_EXTENT_M = 1

export interface Point3Like {
  x: number
  y: number
  z: number
}

/** True when every component is numerically zero (|c| <= 1 nm). */
export function isExactOriginVertex(x: number, y: number, z: number): boolean {
  return (
    Math.abs(x) <= ORIGIN_EXACT_EPSILON_M &&
    Math.abs(y) <= ORIGIN_EXACT_EPSILON_M &&
    Math.abs(z) <= ORIGIN_EXACT_EPSILON_M
  )
}

/** Euclidean distance from the origin to an axis-aligned box (0 when the box contains it). */
export function distanceFromOriginToBounds(bounds: Bounds3D): number {
  const dx = Math.max(bounds.minX, 0, -bounds.maxX)
  const dy = Math.max(bounds.minY, 0, -bounds.maxY)
  const dz = Math.max(bounds.minZ, 0, -bounds.maxZ)
  return Math.hypot(dx, dy, dz)
}

/** Largest side of an axis-aligned box. */
export function boundsExtent(bounds: Bounds3D): number {
  return Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  )
}

/**
 * The isolation test on the bounds of a mesh's NON-origin vertices: true when
 * the origin is farther from that box than 10x the box's largest side (floored
 * at 1 m).
 */
export function isOriginIsolatedFromBounds(restBounds: Bounds3D): boolean {
  const extent = Math.max(boundsExtent(restBounds), ORIGIN_ARTIFACT_MIN_EXTENT_M)
  return distanceFromOriginToBounds(restBounds) > ORIGIN_ARTIFACT_ISOLATION_FACTOR * extent
}

/**
 * Pure vertex-list form of the guard. Returns the SAME array instance when
 * nothing is dropped, so callers can cheaply detect "unchanged".
 */
export function dropIsolatedOriginVertices<T extends Point3Like>(vertices: readonly T[]): T[] {
  let zeroCount = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const vertex of vertices) {
    if (isExactOriginVertex(vertex.x, vertex.y, vertex.z)) {
      zeroCount += 1
      continue
    }
    if (vertex.x < minX) minX = vertex.x
    if (vertex.x > maxX) maxX = vertex.x
    if (vertex.y < minY) minY = vertex.y
    if (vertex.y > maxY) maxY = vertex.y
    if (vertex.z < minZ) minZ = vertex.z
    if (vertex.z > maxZ) maxZ = vertex.z
  }

  const input = vertices as T[]
  if (zeroCount === 0 || zeroCount === vertices.length) return input
  if (!isOriginIsolatedFromBounds({ minX, minY, minZ, maxX, maxY, maxZ })) return input
  return vertices.filter((vertex) => !isExactOriginVertex(vertex.x, vertex.y, vertex.z))
}

/**
 * Streaming form of the guard for callers that visit vertices one at a time
 * (floor-mesh streaming, fixture centroids). Feed every vertex of ONE mesh,
 * then read `result()`; non-finite vertices are skipped and counted so a NaN
 * component can never poison the box.
 */
export interface OriginGuardedBoundsAccumulator {
  add(x: number, y: number, z: number): void
  /** null when no finite vertex was added. */
  result(): Bounds3D | null
  /** Vertices skipped because a component was NaN/Infinity (broken exporter geometry). */
  nonFiniteVertexCount(): number
  /** Exact-origin vertices excluded by the last `result()`; 0 when they were kept. */
  droppedOriginVertexCount(): number
}

export function createOriginGuardedBoundsAccumulator(): OriginGuardedBoundsAccumulator {
  let allMinX = Infinity, allMinY = Infinity, allMinZ = Infinity
  let allMaxX = -Infinity, allMaxY = -Infinity, allMaxZ = -Infinity
  let restMinX = Infinity, restMinY = Infinity, restMinZ = Infinity
  let restMaxX = -Infinity, restMaxY = -Infinity, restMaxZ = -Infinity
  let zeroCount = 0
  let nonFinite = 0
  let dropped = 0

  return {
    add(x, y, z) {
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

      if (isExactOriginVertex(x, y, z)) {
        zeroCount += 1
        return
      }

      if (x < restMinX) restMinX = x
      if (x > restMaxX) restMaxX = x
      if (y < restMinY) restMinY = y
      if (y > restMaxY) restMaxY = y
      if (z < restMinZ) restMinZ = z
      if (z > restMaxZ) restMaxZ = z
    },
    result() {
      if (!Number.isFinite(allMinX)) return null
      const all: Bounds3D = {
        minX: allMinX, minY: allMinY, minZ: allMinZ,
        maxX: allMaxX, maxY: allMaxY, maxZ: allMaxZ,
      }
      dropped = 0
      if (zeroCount === 0 || !Number.isFinite(restMinX)) return all
      const rest: Bounds3D = {
        minX: restMinX, minY: restMinY, minZ: restMinZ,
        maxX: restMaxX, maxY: restMaxY, maxZ: restMaxZ,
      }
      if (!isOriginIsolatedFromBounds(rest)) return all
      dropped = zeroCount
      return rest
    },
    nonFiniteVertexCount() {
      return nonFinite
    },
    droppedOriginVertexCount() {
      return dropped
    },
  }
}
