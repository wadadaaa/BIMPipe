import type { FloorRoutes } from '@/domain/branchRouting'
import type { ShaftCandidate } from '@/domain/continuityMap'
import { renderFloorDrawingSvg, type RenderFloorDrawingOptions } from '@/domain/drawing/renderFloorDrawing'
import type { Fixture, PlanBounds, Riser, Storey, StoreyId } from '@/domain/types'
import { buildOurFloorDrawing, type OurFloorDrawingDiagnostics } from '@/shared/drawing/ourSuggestionDrawing'

/**
 * Drawing preview of the open floor: the page's own state (suggested/manual
 * risers, branch runs, detected fixtures, shaft candidates) as a sanitary plan
 * SVG in the sheet's graphic language. Thin by design — the model adapter is
 * `buildOurFloorDrawing` and the renderer is `renderFloorDrawingSvg`; this
 * module only picks the page data and the sheet settings.
 */
export interface DrawingPreviewInput {
  storeyId: StoreyId
  /** Storey name as parsed from the IFC (rendered as the sheet title; may be RTL). */
  storeyName: string
  /** All risers (any storey); the adapter filters to the storey. */
  risers: readonly Riser[]
  /** Branch runs per floor (viewer plan frame). */
  routes: readonly FloorRoutes[]
  /** Fixtures of the open floor (viewer plan frame). */
  fixtures: readonly Fixture[]
  /** Robust floor bounds of the open floor's geometry, source frame; null when unknown. */
  planBounds: PlanBounds | null
  /** All storeys, for the stack span note. */
  storeys: readonly Storey[]
  /** Shaft candidates of the continuity map (any storey); filtered to the storey here. */
  shaftCandidates?: readonly ShaftCandidate[]
}

export interface DrawingPreview {
  svg: string
  fileName: string
  diagnostics: OurFloorDrawingDiagnostics
}

/** Sheet settings for the in-app preview: 1:50 at CSS pixel density. */
export const DRAWING_PREVIEW_RENDER_OPTIONS: RenderFloorDrawingOptions = {
  scale: 50,
  dpi: 96,
  showUnderlay: true,
  anonymize: false,
}

export function buildDrawingPreview(input: DrawingPreviewInput): DrawingPreview {
  const shaftCandidates = (input.shaftCandidates ?? []).filter((candidate) => candidate.storeyIds.includes(input.storeyId))
  const { model, diagnostics } = buildOurFloorDrawing({
    storeyId: input.storeyId,
    storeyLabel: input.storeyName,
    risers: input.risers,
    routes: input.routes,
    fixtures: input.fixtures,
    structure: shaftCandidates.length > 0 ? { shaftCandidates } : undefined,
    planBounds: input.planBounds,
    storeys: input.storeys,
  })
  return {
    svg: renderFloorDrawingSvg(model, DRAWING_PREVIEW_RENDER_OPTIONS),
    fileName: drawingPreviewFileName(input.storeyName),
    diagnostics,
  }
}

/** `<storey>-sanitary-drawing.svg`, with the storey name made filesystem-safe (letters of any script are kept). */
export function drawingPreviewFileName(storeyName: string): string {
  const safe = storeyName
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe.length > 0 ? safe : 'storey'}-sanitary-drawing.svg`
}
