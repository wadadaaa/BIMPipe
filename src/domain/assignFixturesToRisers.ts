/**
 * Pure assignment of detected sanitary fixtures to risers (T2).
 *
 * Risers are anchored by toilets (one riser per toilet) and by kitchens (dedicated
 * corner risers). Every other fixture does not spawn a riser; instead it attaches to
 * the nearest riser on its own storey, within a maximum branch length. Fixtures with
 * no riser in range are explicitly flagged `unassigned: true` so the UI can surface
 * them instead of silently dropping them.
 *
 * Notes on specific kinds:
 * - Toilets assign trivially: a suggested riser sits on each toilet, so the nearest
 *   riser is their own anchor at plan distance ~0.
 * - Kitchen-sink fixtures assign like any other fixture (nearest same-storey riser),
 *   which is typically their kitchen's dedicated corner riser.
 *
 * This module is intentionally self-contained: input/output types are structural so
 * `Fixture`/`Riser` from `@/domain/types` satisfy them without this file depending on
 * concurrent edits to shared modules. Distances are measured on the plan plane (X/Z;
 * the viewer uses Y as the vertical axis).
 */
import type { FixtureKind, RiserId, StoreyId } from './types'

/**
 * Maximum horizontal branch length from a fixture to its riser, as a mm/m constant
 * pair. 4 m is a plumbing-sensible default for unvented small-fixture branch drains
 * (common code limits for fixture branches before a vent/stack are in the 3–5 m
 * range); beyond that, slope and venting requirements make a direct branch
 * unrealistic and the fixture should be flagged instead.
 */
export const MAX_BRANCH_LENGTH_MM = 4000
export const MAX_BRANCH_LENGTH_M = 4

export type PlanUnits = 'mm' | 'm'

interface PlanPoint {
  x: number
  y: number
  z: number
}

export interface AssignableFixture {
  expressId: number
  kind: FixtureKind
  storeyId: StoreyId
  position: PlanPoint | null
}

export interface AssignableRiser {
  id: RiserId
  stackId: string
  storeyId: StoreyId
  position: PlanPoint
}

export type UnassignedReason =
  | 'no-plan-position'
  | 'no-riser-on-storey'
  | 'no-riser-within-branch-length'

export interface AssignedFixtureRiser {
  fixtureExpressId: number
  kind: FixtureKind
  storeyId: StoreyId
  unassigned: false
  riserId: RiserId
  stackId: string
  fixturePosition: PlanPoint
  riserPosition: PlanPoint
  /** X/Z plan distance from fixture to riser, in `units`. */
  planDistance: number
  /** Units `planDistance` and the positions are expressed in. */
  units: PlanUnits
}

export interface UnassignedFixtureRiser {
  fixtureExpressId: number
  kind: FixtureKind
  storeyId: StoreyId
  unassigned: true
  fixturePosition: PlanPoint | null
  reason: UnassignedReason
}

export type FixtureRiserAssignment = AssignedFixtureRiser | UnassignedFixtureRiser

export interface AssignFixturesToRisersOptions {
  /** Plan units override. When omitted, units are detected from the coordinates. */
  units?: PlanUnits
}

/**
 * Assigns each fixture to the nearest riser on the same storey within
 * `MAX_BRANCH_LENGTH_MM`/`MAX_BRANCH_LENGTH_M`. Returns one entry per input fixture,
 * in input order. Deterministic: distance ties break on riser id.
 */
export function assignFixturesToRisers(
  fixtures: AssignableFixture[],
  risers: AssignableRiser[],
  options: AssignFixturesToRisersOptions = {},
): FixtureRiserAssignment[] {
  const units = options.units ?? detectUnits(fixtures, risers)
  const maxBranchLength = units === 'mm' ? MAX_BRANCH_LENGTH_MM : MAX_BRANCH_LENGTH_M

  return fixtures.map((fixture) => {
    if (fixture.position === null) {
      return unassigned(fixture, 'no-plan-position')
    }

    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === fixture.storeyId)
    if (sameStoreyRisers.length === 0) {
      return unassigned(fixture, 'no-riser-on-storey')
    }

    let nearest = sameStoreyRisers[0]
    let nearestDistance = planDistance(fixture.position, nearest.position)
    for (let index = 1; index < sameStoreyRisers.length; index += 1) {
      const candidate = sameStoreyRisers[index]
      const distance = planDistance(fixture.position, candidate.position)
      if (
        distance < nearestDistance ||
        (distance === nearestDistance && candidate.id.localeCompare(nearest.id) < 0)
      ) {
        nearest = candidate
        nearestDistance = distance
      }
    }

    if (nearestDistance > maxBranchLength) {
      return unassigned(fixture, 'no-riser-within-branch-length')
    }

    return {
      fixtureExpressId: fixture.expressId,
      kind: fixture.kind,
      storeyId: fixture.storeyId,
      unassigned: false as const,
      riserId: nearest.id,
      stackId: nearest.stackId,
      fixturePosition: fixture.position,
      riserPosition: nearest.position,
      planDistance: nearestDistance,
      units,
    }
  })
}

function unassigned(
  fixture: AssignableFixture,
  reason: UnassignedReason,
): UnassignedFixtureRiser {
  return {
    fixtureExpressId: fixture.expressId,
    kind: fixture.kind,
    storeyId: fixture.storeyId,
    unassigned: true,
    fixturePosition: fixture.position,
    reason,
  }
}

/**
 * Same convention as `detectPlanUnits` in `src/shared/routes/planGeometry.ts`:
 * plan coordinates beyond ±1000 imply millimetres. Reimplemented locally so
 * `src/domain` stays free of `src/shared` imports.
 */
function detectUnits(fixtures: AssignableFixture[], risers: AssignableRiser[]): PlanUnits {
  const points = [
    ...fixtures.flatMap((fixture) => (fixture.position ? [fixture.position] : [])),
    ...risers.map((riser) => riser.position),
  ]
  for (const point of points) {
    if (Math.abs(point.x) > 1000 || Math.abs(point.z) > 1000) return 'mm'
  }
  return 'm'
}

function planDistance(a: PlanPoint, b: PlanPoint): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}
