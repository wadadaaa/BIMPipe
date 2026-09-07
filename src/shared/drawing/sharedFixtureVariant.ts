import type { FloorDrawingModel } from '@/domain/drawing/floorDrawingModel'
import { restrictFloorDrawingToFixtures, type RestrictFloorDrawingDiagnostics } from '@/domain/drawing/restrictFloorDrawing'
import type { FloorRoutes } from '@/domain/branchRouting'
import { drawingFixtureId } from './drawingFixtures'
import { ourPipeDrawingId } from './ourSuggestionDrawing'

/**
 * Gauntlet round 3, diagnostic A/B variant: both sheets restricted to the
 * fixtures both sides serve (`computeSharedFixtureSet`). Ours keeps the route
 * segments that carry at least one shared fixture (and the stacks they still
 * reach); the engineer's runs are unchanged — only the fixture symbols of the
 * unshared fixtures leave his sheet too, so neither side shows a fixture the
 * other is not compared on. The gated result stays the unrestricted variant.
 */
export interface SharedFixtureVariantInput {
  engineer: FloorDrawingModel
  ours: FloorDrawingModel
  /** Our branch routes on every storey (the pipeline's `comparisonInput.ourBranchRoutes`). */
  ourBranchRoutes: readonly FloorRoutes[]
  sharedFixtureExpressIds: readonly number[]
}

export interface SharedFixtureVariantResult {
  engineer: FloorDrawingModel
  ours: FloorDrawingModel
  diagnostics: {
    sharedFixtures: number
    engineer: RestrictFloorDrawingDiagnostics
    ours: RestrictFloorDrawingDiagnostics
  }
}

export function buildSharedFixtureVariant(input: SharedFixtureVariantInput): SharedFixtureVariantResult {
  const keepFixtureIds = new Set(input.sharedFixtureExpressIds.map((expressId) => drawingFixtureId(expressId)))
  const servedFixtureIdsByPipeId = new Map<string, readonly string[]>()
  for (const floor of input.ourBranchRoutes) {
    for (const segment of floor.segments) {
      servedFixtureIdsByPipeId.set(
        ourPipeDrawingId(segment.id),
        segment.servedFixtureExpressIds.map((expressId) => drawingFixtureId(expressId)),
      )
    }
  }
  const engineer = restrictFloorDrawingToFixtures({ model: input.engineer, keepFixtureIds, servedFixtureIdsByPipeId: new Map() })
  const ours = restrictFloorDrawingToFixtures({ model: input.ours, keepFixtureIds, servedFixtureIdsByPipeId })
  return {
    engineer: engineer.model,
    ours: ours.model,
    diagnostics: { sharedFixtures: keepFixtureIds.size, engineer: engineer.diagnostics, ours: ours.diagnostics },
  }
}
