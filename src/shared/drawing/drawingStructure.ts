import type { ContinuityStoreyInput, ShaftCandidate } from '@/domain/continuityMap'
import type { DrawingBoundsM, DrawingStructureElement } from '@/domain/drawing/floorDrawingModel'
import { boundsOfDrawingPoints, footprintToDrawingOutline, unionDrawingBounds, viewerPlanToDrawing } from './drawingFrame'

/**
 * Structure for a floor drawing, passed through from the continuity-map inputs
 * (`extractContinuityStoreyInputs` → `mergeContinuityStoreyInputs`) and the
 * built map's shaft candidates. Footprints are reused as-is (viewer frame,
 * metres); nothing is re-extracted here. Slabs are omitted: they cover the
 * whole footprint and carry no plan information for the sheet.
 */
export interface DrawingStructureInput {
  /** Merged storey input for THIS storey (host storey ids, metres). */
  storeyInput?: Pick<ContinuityStoreyInput, 'obstructions' | 'voids'> | null
  /** Shaft candidates present on this storey (`candidate.storeyIds` includes it). */
  shaftCandidates?: readonly ShaftCandidate[]
}

export function buildDrawingStructure(input: DrawingStructureInput | undefined): DrawingStructureElement[] {
  if (input === undefined) return []
  const elements: DrawingStructureElement[] = []
  for (const obstruction of input.storeyInput?.obstructions ?? []) {
    if (obstruction.kind === 'slab') continue
    elements.push({ kind: obstruction.kind, outline: footprintToDrawingOutline(obstruction.footprint) })
  }
  for (const voidInput of input.storeyInput?.voids ?? []) {
    if (voidInput.kind !== 'slab-opening') continue
    elements.push({ kind: 'slab-opening', outline: footprintToDrawingOutline(voidInput.footprint) })
  }
  for (const candidate of input.shaftCandidates ?? []) {
    const outline =
      candidate.polygon !== null && candidate.polygon.length >= 3
        ? candidate.polygon.map(viewerPlanToDrawing)
        : footprintToDrawingOutline({ shape: 'bbox', bounds: candidate.bounds })
    elements.push({ kind: 'shaft-candidate', outline })
  }
  return elements
}

/** Union bounds of every structure outline; null when there is no structure. */
export function structureBounds(structure: readonly DrawingStructureElement[]): DrawingBoundsM | null {
  let bounds: DrawingBoundsM | null = null
  for (const element of structure) {
    const outlineBounds = boundsOfDrawingPoints(element.outline)
    if (outlineBounds !== null) bounds = unionDrawingBounds(bounds, outlineBounds)
  }
  return bounds
}
