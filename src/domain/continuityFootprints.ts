import type { PlanBounds } from '@/domain/types'
import { dropIsolatedOriginVertices } from '@/shared/frame/originArtifacts'

/**
 * Pure vertex → plan-footprint math for the vertical continuity map.
 *
 * The IFC → vertex extraction (web-ifc calls) lives in
 * `src/shared/ifc/extractContinuityInputs.ts`; this module only does math so it
 * stays unit-testable without the WASM engine.
 *
 * Coordinate convention: vertices are world-space points in the same frame as
 * `Fixture.position` (see `getIfcElementPosition` in
 * `src/shared/ifc/detectFixtures.ts`). The plan plane is (x, z); y is treated
 * as the vertical axis, matching `src/shared/routes/planGeometry.ts`.
 */

export interface WorldVertex {
  x: number
  y: number
  z: number
}

/**
 * Some exporter meshes contain stray vertices sitting exactly at the world
 * origin (uninitialised data). They wreck bbox/centroid math for elements that
 * live far from the origin, so they are dropped before any footprint is
 * computed. The rule is the shared origin guard
 * (`src/shared/frame/originArtifacts.ts`): an exact-zero vertex is dropped
 * only when it is isolated from the rest of the element's geometry, so an
 * element that legitimately touches the origin keeps its vertex.
 */
export function dropStrayOriginVertices(vertices: WorldVertex[]): WorldVertex[] {
  return dropIsolatedOriginVertices(vertices)
}

export interface VertexFootprint {
  /** Axis-aligned plan bounds on the (x, z) plane. */
  bounds: PlanBounds
  /** Plan centre of the bounds. */
  center: { x: number; z: number }
  /** Vertical extent (y axis) of the surviving vertices. */
  minY: number
  maxY: number
}

/**
 * Computes the plan-plane bounding box of a vertex cloud after dropping stray
 * world-origin vertices. Returns null when no usable vertices remain.
 */
export function footprintFromWorldVertices(vertices: WorldVertex[]): VertexFootprint | null {
  const usable = dropStrayOriginVertices(vertices)
  if (usable.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const vertex of usable) {
    if (vertex.x < minX) minX = vertex.x
    if (vertex.x > maxX) maxX = vertex.x
    if (vertex.z < minZ) minZ = vertex.z
    if (vertex.z > maxZ) maxZ = vertex.z
    if (vertex.y < minY) minY = vertex.y
    if (vertex.y > maxY) maxY = vertex.y
  }

  return {
    bounds: { minX, maxX, minZ, maxZ },
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    minY,
    maxY,
  }
}
