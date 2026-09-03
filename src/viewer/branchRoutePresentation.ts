import type { FloorRoutes, RouteSegment, RouteSegmentKind } from '@/domain/branchRouting'
import type { StoreyId } from '@/domain/types'

/**
 * A branch route segment mapped to viewer coordinates, ready to draw.
 * `from`/`to` follow the viewer convention: X/Z is the plan plane, Y is vertical.
 */
export interface BranchRouteViewSegment {
  key: string
  kind: RouteSegmentKind
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
}

export interface BranchRoutePresentationState {
  hasRoutes: boolean
  visibleSegments: BranchRouteViewSegment[]
}

/**
 * Maps one floor's branch route segments for the top-down 2D plan overlay.
 * The relative slope elevation is intentionally dropped (y = 0): the 2D viewer
 * flattens every overlay point onto the plan plane before projecting, so only
 * the X/Z run matters. `hasRoutes` stays true while hidden so the toggle
 * control can still be offered.
 */
export function getBranchRoutePresentation({
  segments,
  visible,
}: {
  segments: RouteSegment[]
  visible: boolean
}): BranchRoutePresentationState {
  const hasRoutes = segments.length > 0
  if (!hasRoutes || !visible) return { hasRoutes, visibleSegments: [] }

  return {
    hasRoutes,
    visibleSegments: segments.map((segment) => ({
      key: segment.id,
      kind: segment.kind,
      from: { x: segment.start.x, y: 0, z: segment.start.z },
      to: { x: segment.end.x, y: 0, z: segment.end.z },
    })),
  }
}

/**
 * Maps per-floor branch routes into 3D world coordinates for the model viewer.
 *
 * Elevation mapping: world Y = the storey's geometry-derived Y anchor (the same
 * level the riser junction spheres use) + the segment endpoint's elevation
 * relative to the riser connection datum (riser end = 0, upstream ends rise at
 * the 2% design slope). Both come from the same coordinate space, so no unit
 * conversion is needed.
 *
 * Floors are skipped when their per-floor visibility is false (absent = visible)
 * or when no Y anchor is known yet (geometry for that storey not loaded).
 */
export function buildBranchRouteWorldSegments({
  floors,
  storeyYAnchors,
  visibilityByStorey,
}: {
  floors: FloorRoutes[]
  storeyYAnchors: ReadonlyMap<StoreyId, number>
  visibilityByStorey: ReadonlyMap<StoreyId, boolean>
}): BranchRouteViewSegment[] {
  const worldSegments: BranchRouteViewSegment[] = []

  for (const floor of floors) {
    if (!(visibilityByStorey.get(floor.storeyId) ?? true)) continue
    const anchorY = storeyYAnchors.get(floor.storeyId)
    if (anchorY === undefined) continue

    for (const segment of floor.segments) {
      worldSegments.push({
        key: segment.id,
        kind: segment.kind,
        from: { x: segment.start.x, y: anchorY + segment.start.elevation, z: segment.start.z },
        to: { x: segment.end.x, y: anchorY + segment.end.elevation, z: segment.end.z },
      })
    }
  }

  return worldSegments
}
