import type { PlanFootprint } from '@/domain/continuityMap'
import type { DrawingBoundsM, DrawingFixtureKind, DrawingPointM, DrawingPolygonM } from '@/domain/drawing/floorDrawingModel'
import type { EngineerPoint3 } from '@/domain/engineerPipes'
import type { FixtureKind, PlanBounds } from '@/domain/types'

/**
 * Frame conversions into the drawing plan frame of `FloorDrawingModel`:
 * metres, IFC X right, IFC Y up.
 *
 * Two input frames exist in the app (see `src/shared/frame/ifcSourceFrame.ts`):
 * - IFC source frame (engineer pipe endpoints): Z-up, source length unit →
 *   `xM = x·scale`, `yM = y·scale`.
 * - Viewer source frame (fixtures, risers, route segments, continuity
 *   footprints): metres, Y-up, plan = (x, z) with z = −(IFC Y) →
 *   `xM = x`, `yM = −z`.
 * Both land in the same absolute plan frame, so the two sides of the A/B
 * overlay without any further alignment. No local-origin subtraction is done
 * here; the renderer frames the drawing from `boundsM`.
 */

/** Viewer-frame plan point (x, z in metres) → drawing point. */
export function viewerPlanToDrawing(point: { x: number; z: number }): DrawingPointM {
  return { xM: point.x, yM: -point.z + 0 }
}

/** IFC-source point (source units) → drawing point in metres. */
export function ifcSourceToDrawing(point: EngineerPoint3, metersPerSourceUnit: number): DrawingPointM {
  return { xM: point.x * metersPerSourceUnit, yM: point.y * metersPerSourceUnit }
}

/** Viewer-frame plan bounds (x/z, metres) → drawing bounds (the Y axis flips, so min/max swap). */
export function viewerBoundsToDrawing(bounds: PlanBounds): DrawingBoundsM {
  return { minXM: bounds.minX, maxXM: bounds.maxX, minYM: -bounds.maxZ + 0, maxYM: -bounds.minZ + 0 }
}

/**
 * Continuity footprint (viewer frame, metres) → closed drawing polygon.
 * A bbox becomes its four corners counter-clockwise in the drawing frame.
 */
export function footprintToDrawingOutline(footprint: PlanFootprint): DrawingPolygonM {
  if (footprint.shape === 'polygon') return footprint.points.map(viewerPlanToDrawing)
  const { minX, maxX, minZ, maxZ } = footprint.bounds
  // Viewer z = −Y: minZ is the drawing's top edge (max Y). CCW in the drawing frame:
  // bottom-left → bottom-right → top-right → top-left.
  return [
    { xM: minX, yM: -maxZ + 0 },
    { xM: maxX, yM: -maxZ + 0 },
    { xM: maxX, yM: -minZ + 0 },
    { xM: minX, yM: -minZ + 0 },
  ]
}

export function unionDrawingBounds(a: DrawingBoundsM | null, b: DrawingBoundsM): DrawingBoundsM {
  if (a === null) return { ...b }
  return {
    minXM: Math.min(a.minXM, b.minXM),
    minYM: Math.min(a.minYM, b.minYM),
    maxXM: Math.max(a.maxXM, b.maxXM),
    maxYM: Math.max(a.maxYM, b.maxYM),
  }
}

export function boundsOfDrawingPoints(points: readonly DrawingPointM[]): DrawingBoundsM | null {
  if (points.length === 0) return null
  let minXM = Infinity
  let minYM = Infinity
  let maxXM = -Infinity
  let maxYM = -Infinity
  for (const point of points) {
    if (point.xM < minXM) minXM = point.xM
    if (point.xM > maxXM) maxXM = point.xM
    if (point.yM < minYM) minYM = point.yM
    if (point.yM > maxYM) maxYM = point.yM
  }
  return { minXM, minYM, maxXM, maxYM }
}

export function drawingPointInBounds(point: DrawingPointM, bounds: DrawingBoundsM, marginM = 0): boolean {
  return (
    point.xM >= bounds.minXM - marginM &&
    point.xM <= bounds.maxXM + marginM &&
    point.yM >= bounds.minYM - marginM &&
    point.yM <= bounds.maxYM + marginM
  )
}

/** Canonical fixture kinds → drawing symbol kinds. Cisterns are accessories (`other`). */
export function fixtureKindToDrawing(kind: FixtureKind): DrawingFixtureKind {
  switch (kind) {
    case 'TOILETPAN':
      return 'toilet'
    case 'WASHHANDBASIN':
      return 'basin'
    case 'SINK':
      return 'sink'
    case 'URINAL':
      return 'urinal'
    case 'BATH':
      return 'bath'
    case 'BIDET':
      return 'bidet'
    case 'CISTERN':
    case 'OTHER':
      return 'other'
  }
}
