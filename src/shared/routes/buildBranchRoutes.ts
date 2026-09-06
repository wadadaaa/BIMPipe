import {
  computeBranchRoutes,
  type AssignedFixture,
  type CoreCollectorInput,
  type FloorRoutes,
  type RowCollectorInput,
} from '@/domain/branchRouting'
import type { AssignedFixtureRiser, FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'

export interface BuildBranchRoutesOptions {
  /**
   * Office fixture rows (G3) whose members drain through a collector; pass the
   * `fixtureRows` of the wet-core suggestion. Omitted/empty → plain routing.
   */
  rowCollectors?: readonly RowCollectorInput[]
  /**
   * Obstructed cores gathered into a neighbour's stack (R1); pass the
   * `coreCollectors` of the wet-core suggestion. Omitted/empty → no gathering.
   */
  coreCollectors?: readonly CoreCollectorInput[]
}

/**
 * Adapts T2 fixture-to-riser assignments into branch-routing inputs and computes
 * per-floor branch routes (T3). Unassigned entries are excluded here on purpose:
 * they have no riser to route toward, and the fixtures panel already surfaces
 * them with an explicit reason instead of silently dropping them.
 */
export function buildBranchRoutesFromAssignments(
  assignments: FixtureRiserAssignment[],
  options: BuildBranchRoutesOptions = {},
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
  return computeBranchRoutes(assignedFixtures, {
    planUnits: assigned[0].units,
    ...(options.rowCollectors !== undefined && options.rowCollectors.length > 0 ? { rowCollectors: options.rowCollectors } : {}),
    ...(options.coreCollectors !== undefined && options.coreCollectors.length > 0 ? { coreCollectors: options.coreCollectors } : {}),
  })
}
