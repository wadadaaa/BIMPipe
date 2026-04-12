import type { Fixture, Riser, Route } from '@/domain/types'
import { detectPlanUnits, planDistance } from './planGeometry'

export const SLOPE = 0.02 // 2% = 1:50

/**
 * Screed depth limits — choose based on detected model units.
 * The 0–150 mm zone above the structural slab is the drainage corridor.
 */
export const SCREED_DEPTH_MM = 150
export const SCREED_DEPTH_M = 0.15

/**
 * Heuristic: if any fixture X or Y coordinate exceeds 1000 the model is in mm.
 * Returns 'mm' or 'm' so callers can pick the right threshold and display label.
 */
export function detectModelUnits(fixtures: Fixture[]): 'mm' | 'm' {
  return detectPlanUnits(fixtures.flatMap((fixture) => (fixture.position ? [fixture.position] : [])))
}

/**
 * Assigns each located fixture a straight-line route to its nearest riser,
 * computes the 2% slope drop, and flags whether it fits within the screed zone.
 *
 * Returns a stable set of routes (IDs are deterministic: `${expressId}-${riserId}`).
 * Fixtures without a position are silently skipped.
 */
export function buildRoutes(
  fixtures: Fixture[],
  risers: Riser[],
  screedDepth: number,
): Route[] {
  if (risers.length === 0) return []

  const routes: Route[] = []

  for (const fixture of fixtures) {
    if (!fixture.position) continue

    // Find nearest riser in the X/Z plan plane. Y is vertical in the viewer.
    let nearest = risers[0]
    let minDist = Infinity

    for (const riser of risers) {
      const d = planDistance(fixture.position, riser.position)
      if (d < minDist) {
        minDist = d
        nearest = riser
      }
    }

    const length = minDist
    const drop = length * SLOPE

    routes.push({
      id: `${fixture.expressId}-${nearest.id}`,
      fixtureExpressId: fixture.expressId,
      fixtureName: fixture.name,
      fixtureKind: fixture.kind,
      riserId: nearest.id,
      length,
      drop,
      compliant: drop <= screedDepth,
      fixturePos: fixture.position,
      riserPos: nearest.position,
    })
  }

  return routes
}
