import type { DrawingPointM, FloorDrawingModel } from './floorDrawingModel'

/**
 * Restrict a floor drawing to a fixture subset (gauntlet diagnostic variant,
 * round 3). The A/B bar on the office floor is partial — the engineer's slice
 * drains 24 of the 33 detected fixtures — and critics penalise him for the
 * fixtures no one drew a run to. The restricted variant draws BOTH sides on
 * the fixtures both sides serve so the comparison is on the same population:
 *
 * - fixtures: only those in `keepFixtureIds` stay on the sheet;
 * - pipes: a run that carries served-fixture information stays when it carries
 *   at least one kept fixture; a run without that information (the engineer's
 *   runs, fitting connectors) always stays;
 * - risers and sleeves: an element that some run passed within the touch
 *   tolerance before the cut and no kept run passes after it is dropped (a
 *   stack left without any branch would read as an orphan the design never
 *   had); elements no run touched before the cut stay as they were.
 *
 * Pure and deterministic: order is preserved, nothing is re-derived.
 */
export interface RestrictFloorDrawingInput {
  model: FloorDrawingModel
  /** Drawing fixture ids (`DrawingFixture.id`) to keep. */
  keepFixtureIds: ReadonlySet<string>
  /** Pipe id → drawing fixture ids whose flow the run carries. Pipes absent here are kept. */
  servedFixtureIdsByPipeId: ReadonlyMap<string, readonly string[]>
  /** Plan distance within which a run "touches" a riser or sleeve (default 0.3 m). */
  touchToleranceM?: number
}

export interface RestrictFloorDrawingDiagnostics {
  fixtures: { before: number; after: number }
  pipes: { before: number; after: number; withoutServedInfo: number }
  risers: { before: number; after: number }
  sleeves: { before: number; after: number }
}

export interface RestrictFloorDrawingResult {
  model: FloorDrawingModel
  diagnostics: RestrictFloorDrawingDiagnostics
}

export const RESTRICT_TOUCH_TOLERANCE_M = 0.3

/** Plan distance from a point to a run (segment), metres. */
function distanceToRun(at: DrawingPointM, start: DrawingPointM, end: DrawingPointM): number {
  const dx = end.xM - start.xM
  const dy = end.yM - start.yM
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((at.xM - start.xM) * dx + (at.yM - start.yM) * dy) / lengthSq))
  return Math.hypot(at.xM - (start.xM + t * dx), at.yM - (start.yM + t * dy))
}

export function restrictFloorDrawingToFixtures(input: RestrictFloorDrawingInput): RestrictFloorDrawingResult {
  const { model, keepFixtureIds, servedFixtureIdsByPipeId } = input
  const toleranceM = input.touchToleranceM ?? RESTRICT_TOUCH_TOLERANCE_M

  const fixtures = model.fixtures.filter((fixture) => keepFixtureIds.has(fixture.id))

  let withoutServedInfo = 0
  const pipes = model.pipes.filter((pipe) => {
    const served = servedFixtureIdsByPipeId.get(pipe.id)
    if (served === undefined) {
      withoutServedInfo += 1
      return true
    }
    return served.some((id) => keepFixtureIds.has(id))
  })

  const touchedBy = (at: DrawingPointM, runs: FloorDrawingModel['pipes']): boolean =>
    runs.some((pipe) => distanceToRun(at, pipe.start, pipe.end) <= toleranceM)
  const keepAnchored = (at: DrawingPointM): boolean => !touchedBy(at, model.pipes) || touchedBy(at, pipes)

  const risers = model.risers.filter((riser) => keepAnchored(riser.centre))
  const sleeves = model.sleeves.filter((sleeve) => keepAnchored(sleeve.at))

  return {
    model: { ...model, fixtures, pipes, risers, sleeves },
    diagnostics: {
      fixtures: { before: model.fixtures.length, after: fixtures.length },
      pipes: { before: model.pipes.length, after: pipes.length, withoutServedInfo },
      risers: { before: model.risers.length, after: risers.length },
      sleeves: { before: model.sleeves.length, after: sleeves.length },
    },
  }
}
