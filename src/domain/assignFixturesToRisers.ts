/**
 * Pure assignment of detected sanitary fixtures to risers (T2, wet-core aware since V5).
 *
 * Assignment order per fixture:
 * 1. **Wet-core membership** (plain mode, V3 vocabulary): when the caller supplies
 *    `coreMembership`, a fixture that belongs to a wet core routes to the same-storey
 *    riser of the stack that serves that core — the auto stack, or the manual/dragged
 *    stack that superseded it (overrides win). Distance is not a criterion here; a
 *    core stack farther than the branch limit is still assigned but flagged
 *    `exceedsMaxBranchLength` so the UI can warn instead of silently rerouting.
 * 2. **Nearest riser** on the fixture's own storey within the maximum branch length.
 *    This is the documented fallback for fixtures without a core (other storeys than
 *    the suggest source storey, fixtures detected after the suggest, demo mode) and
 *    the only way a user-added manual stack without a core receives fixtures.
 *
 * Fixtures with no riser in range are explicitly flagged `unassigned: true` so the UI
 * can surface them instead of silently dropping them.
 *
 * Notes on specific kinds:
 * - Toilet-anchored (demo) risers assign trivially: a suggested riser sits on each
 *   toilet, so the nearest riser is their own anchor at plan distance ~0.
 * - Kitchen-sink fixtures assign like any other fixture (core stack, else nearest
 *   same-storey riser, which is typically their kitchen's dedicated corner riser).
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
  /** How the riser was chosen: its wet core's stack, or the nearest in-range riser. */
  assignedBy: 'wet-core' | 'nearest'
  /**
   * Wet-core assignments are never rerouted for distance (overrides win), so a
   * core stack farther than the branch limit is flagged here instead. Always
   * false for `nearest` assignments, which are in range by construction.
   */
  exceedsMaxBranchLength: boolean
}

/**
 * Wet-core membership handed in by the caller (the reducer knows both maps):
 * fixture express id → wet-core id, and stack id → wet-core id (auto stacks and
 * the preserved stacks that superseded them).
 */
export interface FixtureCoreMembership {
  fixtureCoreIds: ReadonlyMap<number, string>
  stackCoreIds: ReadonlyMap<string, string>
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
  /** When supplied, fixtures route to their wet core's stack before any nearest search. */
  coreMembership?: FixtureCoreMembership
}

/**
 * Assigns each fixture to its wet core's stack when membership is supplied,
 * otherwise to the nearest riser on the same storey within
 * `MAX_BRANCH_LENGTH_MM`/`MAX_BRANCH_LENGTH_M`. Returns one entry per input fixture,
 * in input order. Deterministic: distance ties break on riser id; when a core's
 * stack has several risers on one storey (should not happen) the smallest id wins.
 */
export function assignFixturesToRisers(
  fixtures: AssignableFixture[],
  risers: AssignableRiser[],
  options: AssignFixturesToRisersOptions = {},
): FixtureRiserAssignment[] {
  const units = options.units ?? detectUnits(fixtures, risers)
  const maxBranchLength = units === 'mm' ? MAX_BRANCH_LENGTH_MM : MAX_BRANCH_LENGTH_M
  const membership = options.coreMembership

  return fixtures.map((fixture) => {
    if (fixture.position === null) {
      return unassigned(fixture, 'no-plan-position')
    }

    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === fixture.storeyId)
    if (sameStoreyRisers.length === 0) {
      return unassigned(fixture, 'no-riser-on-storey')
    }

    const coreRiser = membership === undefined ? null : findCoreRiser(fixture, sameStoreyRisers, membership)
    if (coreRiser !== null) {
      const distance = planDistance(fixture.position, coreRiser.position)
      return {
        fixtureExpressId: fixture.expressId,
        kind: fixture.kind,
        storeyId: fixture.storeyId,
        unassigned: false as const,
        riserId: coreRiser.id,
        stackId: coreRiser.stackId,
        fixturePosition: fixture.position,
        riserPosition: coreRiser.position,
        planDistance: distance,
        units,
        assignedBy: 'wet-core' as const,
        exceedsMaxBranchLength: distance > maxBranchLength,
      }
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
      assignedBy: 'nearest' as const,
      exceedsMaxBranchLength: false,
    }
  })
}

function findCoreRiser(
  fixture: AssignableFixture,
  sameStoreyRisers: AssignableRiser[],
  membership: FixtureCoreMembership,
): AssignableRiser | null {
  const coreId = membership.fixtureCoreIds.get(fixture.expressId)
  if (coreId === undefined) return null
  let match: AssignableRiser | null = null
  for (const riser of sameStoreyRisers) {
    if (membership.stackCoreIds.get(riser.stackId) !== coreId) continue
    if (match === null || riser.id.localeCompare(match.id) < 0) match = riser
  }
  return match
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
