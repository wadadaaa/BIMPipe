import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import { BRANCH_SLOPE_PERCENT } from '@/domain/branchDefaults'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type { StoreyId } from '@/domain/types'

/**
 * Read models over branch runs (V5) shared by the routes panel and the export
 * debug JSON: runs grouped by the stack they drain to, with plan length,
 * nominal diameters and the design slope, plus every fixture that could not be
 * routed (never dropped silently).
 */

export interface BranchRunStackGroup {
  stackId: string
  /** Stack label of the riser the runs drain to (`R1`); falls back to the riser id. */
  stackLabel: string
  riserId: string
  segmentCount: number
  /** Distinct fixtures whose flow reaches this stack. */
  fixtureExpressIds: number[]
  /** Sum of the plan lengths of the group's segments, in metres. */
  totalLengthM: number
  /** Sorted distinct nominal diameters of the group's segments. */
  diametersMm: number[]
  slopePercent: number
}

export interface BranchRunFloorSummary {
  storeyId: StoreyId
  groups: BranchRunStackGroup[]
  totalLengthM: number
  segmentCount: number
}

export interface UnroutedFixtureSummary {
  fixtureExpressId: number
  kind: string
  reason: 'no-plan-position' | 'no-riser-on-storey' | 'no-riser-within-branch-length'
}

export interface OverlengthFixtureSummary {
  fixtureExpressId: number
  kind: string
  stackId: string
  /** Plan distance to the core stack, in metres. */
  planDistanceM: number
}

export interface BranchRunsDebugSummary {
  floors: BranchRunFloorSummary[]
  unrouted: UnroutedFixtureSummary[]
  /** Core-stack assignments beyond the branch limit (kept — overrides win — but flagged). */
  overlength: OverlengthFixtureSummary[]
  assignedBy: { wetCore: number; nearest: number }
}

export function segmentPlanLengthM(segment: RouteSegment, planUnits: FloorRoutes['planUnits']): number {
  const dx = segment.end.x - segment.start.x
  const dz = segment.end.z - segment.start.z
  const length = Math.hypot(dx, dz)
  return planUnits === 'mm' ? length / 1000 : length
}

/**
 * Groups one floor's segments by target stack. Group order follows the stack
 * label (natural: R1, R2, …, R10) so the panel stays stable across re-suggests.
 */
export function groupBranchRunsByStack(
  floor: FloorRoutes,
  stackLabelByRiserId: ReadonlyMap<string, string>,
): BranchRunStackGroup[] {
  const groups = new Map<string, BranchRunStackGroup & { fixtureSet: Set<number>; diameterSet: Set<number> }>()
  for (const segment of floor.segments) {
    const stackId = segment.riserStackId ?? segment.riserId
    let group = groups.get(stackId)
    if (group === undefined) {
      group = {
        stackId,
        stackLabel: stackLabelByRiserId.get(segment.riserId) ?? segment.riserId,
        riserId: segment.riserId,
        segmentCount: 0,
        fixtureExpressIds: [],
        totalLengthM: 0,
        diametersMm: [],
        slopePercent: BRANCH_SLOPE_PERCENT,
        fixtureSet: new Set<number>(),
        diameterSet: new Set<number>(),
      }
      groups.set(stackId, group)
    }
    group.segmentCount += 1
    group.totalLengthM += segmentPlanLengthM(segment, floor.planUnits)
    for (const expressId of segment.servedFixtureExpressIds) group.fixtureSet.add(expressId)
    group.diameterSet.add(segment.diameterMm)
  }
  return [...groups.values()]
    .map(({ fixtureSet, diameterSet, ...group }) => ({
      ...group,
      fixtureExpressIds: [...fixtureSet].sort((a, b) => a - b),
      diametersMm: [...diameterSet].sort((a, b) => a - b),
    }))
    .sort((a, b) => compareStackLabels(a.stackLabel, b.stackLabel))
}

export function summarizeBranchRunFloor(
  floor: FloorRoutes,
  stackLabelByRiserId: ReadonlyMap<string, string>,
): BranchRunFloorSummary {
  const groups = groupBranchRunsByStack(floor, stackLabelByRiserId)
  return {
    storeyId: floor.storeyId,
    groups,
    totalLengthM: groups.reduce((sum, group) => sum + group.totalLengthM, 0),
    segmentCount: floor.segments.length,
  }
}

export function summarizeBranchRunsForDebug(
  floors: FloorRoutes[],
  assignments: FixtureRiserAssignment[],
  stackLabelByRiserId: ReadonlyMap<string, string> = new Map(),
): BranchRunsDebugSummary {
  const unrouted: UnroutedFixtureSummary[] = []
  const overlength: OverlengthFixtureSummary[] = []
  const assignedBy = { wetCore: 0, nearest: 0 }
  for (const assignment of assignments) {
    if (assignment.unassigned) {
      unrouted.push({ fixtureExpressId: assignment.fixtureExpressId, kind: assignment.kind, reason: assignment.reason })
      continue
    }
    if (assignment.assignedBy === 'wet-core') assignedBy.wetCore += 1
    else assignedBy.nearest += 1
    if (assignment.exceedsMaxBranchLength) {
      overlength.push({
        fixtureExpressId: assignment.fixtureExpressId,
        kind: assignment.kind,
        stackId: assignment.stackId,
        planDistanceM: assignment.units === 'mm' ? assignment.planDistance / 1000 : assignment.planDistance,
      })
    }
  }
  return {
    floors: floors.map((floor) => summarizeBranchRunFloor(floor, stackLabelByRiserId)),
    unrouted,
    overlength,
    assignedBy,
  }
}

/** Natural order for riser labels (`R2` before `R10`); unknown labels sort lexically after. */
function compareStackLabels(a: string, b: string): number {
  const numberA = /^R(\d+)$/.exec(a)
  const numberB = /^R(\d+)$/.exec(b)
  if (numberA !== null && numberB !== null) return Number(numberA[1]) - Number(numberB[1])
  if (numberA !== null) return -1
  if (numberB !== null) return 1
  return a.localeCompare(b)
}
