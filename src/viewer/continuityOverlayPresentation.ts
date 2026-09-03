import type {
  ContinuityMap,
  ShaftCandidateSource,
  StoreyObstructionGrid,
} from '@/domain/continuityMap'
import type { StoreyId } from '@/domain/types'
import type { Point3D } from '@/shared/routes/planGeometry'

/**
 * 2D debug-overlay presentation of the continuity map (W5).
 *
 * Pure module: converts the open storey's obstruction grid and shaft
 * candidates (map units, SOURCE plan frame — same frame as Fixture.position)
 * into the viewer's LOCAL frame in metres, ready to draw. Blocked cells are
 * merged into per-row runs so the viewer renders a few thousand rectangles
 * instead of one per cell (~70k on a 096 storey).
 */

/** Axis-aligned plan rectangle in the LOCAL viewer frame, metres. */
export interface ContinuityOverlayRect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface ContinuityShaftMarker {
  key: string
  /** Local viewer plan centre — the snap target position. */
  x: number
  z: number
  /** Local plan bbox for the fill/outline rectangle. */
  bounds: ContinuityOverlayRect
  source: ShaftCandidateSource
  /** English source label; `name` carries the raw space name when present. */
  label: string
  /** Raw matched space name (shaft-named spaces only), any language. */
  name: string | null
  storeyCount: number
}

export interface ContinuityOverlayPresentation {
  hasMap: boolean
  /** True when the map contains a non-empty grid for the open storey. */
  gridAvailable: boolean
  blockedRects: ContinuityOverlayRect[]
  blockedCellCount: number
  shaftMarkers: ContinuityShaftMarker[]
}

const EMPTY_PRESENTATION: Omit<ContinuityOverlayPresentation, 'hasMap' | 'gridAvailable'> = {
  blockedRects: [],
  blockedCellCount: 0,
  shaftMarkers: [],
}

function shaftSourceLabel(source: ShaftCandidateSource): string {
  switch (source) {
    case 'slab-opening':
      return 'Slab opening'
    case 'shaft-named-space':
      return 'Shaft-named space'
    case 'aligned-void':
      return 'Aligned vertical void'
  }
}

/**
 * Merges the blocked cells of one grid row-wise: consecutive blocked cells in
 * a row become one rectangle. Deterministic (row-major scan). Coordinates come
 * out in map units, NOT yet localized.
 */
export function mergeBlockedCellsIntoRowRuns(grid: StoreyObstructionGrid): Array<{
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}> {
  const rects: Array<{ minX: number; minZ: number; maxX: number; maxZ: number }> = []
  for (let row = 0; row < grid.rows; row++) {
    let runStart = -1
    for (let col = 0; col <= grid.columns; col++) {
      const blocked = col < grid.columns && grid.blocked[row * grid.columns + col] === 1
      if (blocked && runStart === -1) {
        runStart = col
      } else if (!blocked && runStart !== -1) {
        rects.push({
          minX: grid.origin.x + runStart * grid.cellSize,
          maxX: grid.origin.x + col * grid.cellSize,
          minZ: grid.origin.z + row * grid.cellSize,
          maxZ: grid.origin.z + (row + 1) * grid.cellSize,
        })
        runStart = -1
      }
    }
  }
  return rects
}

export function getContinuityOverlayPresentation({
  map,
  storeyId,
  frameOrigin,
  visible,
}: {
  map: ContinuityMap
  /** HOST storey ID of the open floor (map storeys are host-remapped). */
  storeyId: StoreyId
  /** Host model-frame origin in viewer metres (W1 local frame). */
  frameOrigin: Point3D
  visible: boolean
}): ContinuityOverlayPresentation {
  const hasMap = map.grids.length > 0
  const grid = map.grids.find((candidate) => candidate.storeyId === storeyId) ?? null
  const gridAvailable = grid !== null && grid.columns > 0 && grid.rows > 0
  if (!visible || !gridAvailable || grid === null) {
    return { hasMap, gridAvailable, ...EMPTY_PRESENTATION }
  }

  // Map units are explicit; the viewer frame is metres.
  const scale = map.units === 'mm' ? 0.001 : 1

  let blockedCellCount = 0
  for (const cell of grid.blocked) blockedCellCount += cell

  const blockedRects = mergeBlockedCellsIntoRowRuns(grid).map((rect) => ({
    minX: rect.minX * scale - frameOrigin.x,
    maxX: rect.maxX * scale - frameOrigin.x,
    minZ: rect.minZ * scale - frameOrigin.z,
    maxZ: rect.maxZ * scale - frameOrigin.z,
  }))

  const shaftMarkers: ContinuityShaftMarker[] = map.shaftCandidates
    .filter((candidate) => candidate.storeyIds.includes(storeyId))
    .map((candidate) => ({
      key: candidate.id,
      x: candidate.center.x * scale - frameOrigin.x,
      z: candidate.center.z * scale - frameOrigin.z,
      bounds: {
        minX: candidate.bounds.minX * scale - frameOrigin.x,
        maxX: candidate.bounds.maxX * scale - frameOrigin.x,
        minZ: candidate.bounds.minZ * scale - frameOrigin.z,
        maxZ: candidate.bounds.maxZ * scale - frameOrigin.z,
      },
      source: candidate.source,
      label: shaftSourceLabel(candidate.source),
      name: candidate.name ?? null,
      storeyCount: candidate.storeyIds.length,
    }))

  return { hasMap, gridAvailable, blockedRects, blockedCellCount, shaftMarkers }
}
