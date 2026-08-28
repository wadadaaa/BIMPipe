import { computeBranchRoutes, type AssignedFixture, type FloorRoutes } from '@/domain/branchRouting'
import type { AssignedFixtureRiser, FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'

/**
 * Adapts T2 fixture-to-riser assignments into branch-routing inputs and computes
 * per-floor branch routes (T3). Unassigned entries are excluded here on purpose:
 * they have no riser to route toward, and the fixtures panel already surfaces
 * them with an explicit reason instead of silently dropping them.
 */
export function buildBranchRoutesFromAssignments(
  assignments: FixtureRiserAssignment[],
): FloorRoutes[] {
  const assigned = assignments.filter(
    (assignment): assignment is AssignedFixtureRiser => !assignment.unassigned,
  )
  if (assigned.length === 0) return []

  const assignedFixtures: AssignedFixture[] = assigned.map((assignment) => ({
    fixtureExpressId: assignment.fixtureExpressId,
    fixtureKind: assignment.kind,
    fixturePlan: { x: assignment.fixturePosition.x, z: assignment.fixturePosition.z },
    riserId: assignment.riserId,
    riserStackId: assignment.stackId,
    riserPlan: { x: assignment.riserPosition.x, z: assignment.riserPosition.z },
    storeyId: assignment.storeyId,
  }))

  // Assignments already carry explicit plan units from one shared detection pass,
  // so pass them through instead of re-detecting from coordinate magnitude.
  return computeBranchRoutes(assignedFixtures, { planUnits: assigned[0].units })
}
