import type { DrawingFixture } from '@/domain/drawing/floorDrawingModel'
import type { Fixture } from '@/domain/types'
import { fixtureKindToDrawing, viewerPlanToDrawing } from './drawingFrame'

/**
 * Detected fixtures (viewer frame, metres) → drawing fixtures. Rotation is
 * unknown from the detection output (0 by contract); footprints are omitted so
 * the renderer draws its default symbol. Fixtures without a position cannot
 * be drawn and are returned separately, never dropped silently.
 */
export function buildDrawingFixtures(
  fixtures: readonly Fixture[],
  storeyId: number,
): { fixtures: DrawingFixture[]; skippedWithoutPosition: number[] } {
  const drawn: DrawingFixture[] = []
  const skippedWithoutPosition: number[] = []
  for (const fixture of [...fixtures].sort((a, b) => a.expressId - b.expressId)) {
    if (fixture.storeyId !== storeyId) continue
    if (fixture.position === null) {
      skippedWithoutPosition.push(fixture.expressId)
      continue
    }
    drawn.push({
      id: `fixture-${fixture.expressId}`,
      kind: fixtureKindToDrawing(fixture.kind),
      centre: viewerPlanToDrawing(fixture.position),
      rotationDeg: 0,
    })
  }
  return { fixtures: drawn, skippedWithoutPosition }
}
