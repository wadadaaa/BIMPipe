import {
  MAX_BRANCH_LENGTH_M,
  type AssignedFixtureRiser,
  type FixtureRiserAssignment,
  type UnassignedFixtureRiser,
  type UnassignedReason,
} from '@/domain/assignFixturesToRisers'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import { formatBranchSlopePercent } from '@/domain/branchDefaults'
import { groupBranchRunsByStack } from '@/shared/routes/branchRouteSummary'
import './RoutesPanel.css'

interface RoutesPanelProps {
  /** Branch runs of the open floor; null before risers exist on it. */
  floor: FloorRoutes | null
  /** Fixture assignments of the open floor (unassigned / over-length ones become warnings). */
  assignments: FixtureRiserAssignment[]
  /** riser id → stack label ("R1"). */
  stackLabelByRiserId: ReadonlyMap<string, string>
  /** Fixture express id → display name for the warning rows. */
  fixtureNameByExpressId: ReadonlyMap<number, string>
  /** Branch length limit (m) the assignments were checked against; default residential 4 m. */
  branchLengthLimitM?: number
}

function unassignedReasonCopy(reason: UnassignedReason, branchLimitLabel: string): string {
  switch (reason) {
    case 'no-plan-position':
      return 'no plan position in the IFC'
    case 'no-riser-on-storey':
      return 'no stack on this floor'
    case 'no-riser-within-branch-length':
      return `no stack within the ${branchLimitLabel} branch limit`
  }
}

/** Distinct ids (row / core collector) picked off the segments, per receiving stack. */
function collectIdsByStack(
  floor: FloorRoutes | null,
  pick: (segment: RouteSegment) => string | undefined,
): Map<string, Set<string>> {
  const idsByStackId = new Map<string, Set<string>>()
  for (const segment of floor?.segments ?? []) {
    const id = pick(segment)
    if (id === undefined || segment.riserStackId === undefined) continue
    const ids = idsByStackId.get(segment.riserStackId) ?? new Set<string>()
    ids.add(id)
    idsByStackId.set(segment.riserStackId, ids)
  }
  return idsByStackId
}

/**
 * Branch runs of the open floor grouped by the stack they drain to (V5). This
 * is the only routes list in plain mode — riser-to-riser chains are never shown
 * here. Every fixture that could not be routed is a visible warning row.
 */
export function RoutesPanel({
  floor,
  assignments,
  stackLabelByRiserId,
  fixtureNameByExpressId,
  branchLengthLimitM = MAX_BRANCH_LENGTH_M,
}: RoutesPanelProps) {
  const branchLimitLabel = `${Number.isInteger(branchLengthLimitM) ? branchLengthLimitM.toFixed(0) : branchLengthLimitM.toFixed(1)} m`
  const groups = floor === null ? [] : groupBranchRunsByStack(floor, stackLabelByRiserId, assignments)
  const unrouted = assignments.filter(
    (assignment): assignment is UnassignedFixtureRiser => assignment.unassigned,
  )
  const overlength = assignments.filter(
    (assignment): assignment is AssignedFixtureRiser => !assignment.unassigned && assignment.exceedsMaxBranchLength,
  )
  const totalLengthM = groups.reduce((sum, group) => sum + group.totalLengthM, 0)
  const fixtureCount = new Set(groups.flatMap((group) => group.fixtureExpressIds)).size
  // Office row collectors (G3): rows per stack, from the segment roles. Core
  // collectors (R1): gathered cores per stack, from `coreCollectorId`.
  const collectorRowsByStackId = collectIdsByStack(floor, (segment) => (segment.role === 'row-collector' ? segment.rowId : undefined))
  const coreCollectorsByStackId = collectIdsByStack(floor, (segment) =>
    segment.role === 'collector-run' ? segment.coreCollectorId : undefined,
  )

  if (groups.length === 0 && unrouted.length === 0) {
    return (
      <section className="routes-panel" aria-label="Branch runs">
        <div className="routes-panel__empty">
          <span className="routes-panel__empty-icon" aria-hidden="true">~</span>
          <p>
            Branch runs appear here once the floor has stacks: every positioned fixture is routed to its wet
            core&apos;s stack (Ø110 WC, Ø50 basin/sink/shower, Ø63 shared collector, {formatBranchSlopePercent()} slope).
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="routes-panel" aria-label="Branch runs">
      <div className="routes-panel__summary-row">
        <div className="routes-panel__summary-chip">
          <span className="routes-panel__summary-chip-label">Stacks</span>
          <strong>{groups.length}</strong>
        </div>
        <div className="routes-panel__summary-chip">
          <span className="routes-panel__summary-chip-label">Fixtures</span>
          <strong>{fixtureCount}</strong>
        </div>
        <div className="routes-panel__summary-chip">
          <span className="routes-panel__summary-chip-label">Length</span>
          <strong>{formatMetres(totalLengthM)}</strong>
        </div>
      </div>

      {groups.length > 0 && (
        <ul className="routes-panel__list" data-testid="branch-run-groups">
          {groups.map((group) => {
            const collectorRowCount = collectorRowsByStackId.get(group.stackId)?.size ?? 0
            const coreCollectorCount = coreCollectorsByStackId.get(group.stackId)?.size ?? 0
            return (
              <li key={group.stackId} className="routes-panel__group" data-testid="branch-run-group">
                <span className="routes-panel__item-riser">{group.stackLabel}</span>
                <span className="routes-panel__group-detail">
                  {group.fixtureExpressIds.length} fixture{group.fixtureExpressIds.length === 1 ? '' : 's'} ·{' '}
                  {group.segmentCount} run{group.segmentCount === 1 ? '' : 's'}
                  {group.fixturesAtStackExpressIds.length > 0 &&
                    ` · ${group.fixturesAtStackExpressIds.length} at the stack (no horizontal run)`}
                  {collectorRowCount > 0 && (
                    <span data-testid="branch-run-collectors">
                      {` · ${collectorRowCount} row collector${collectorRowCount === 1 ? '' : 's'}`}
                    </span>
                  )}
                  {coreCollectorCount > 0 && (
                    <span data-testid="branch-run-core-collectors">
                      {` · gathers ${coreCollectorCount} obstructed core${coreCollectorCount === 1 ? '' : 's'} through a collector run`}
                    </span>
                  )}
                </span>
                <span className="routes-panel__group-spec">
                  {formatMetres(group.totalLengthM)} · Ø{group.diametersMm.length > 0 ? group.diametersMm.join('/') : '—'} ·{' '}
                  {group.slopePercent.toFixed(1)} %
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {(unrouted.length > 0 || overlength.length > 0) && (
        <ul className="routes-panel__warnings" role="status" data-testid="branch-run-warnings">
          {unrouted.map((assignment) => (
            <li key={`unrouted-${assignment.fixtureExpressId}`} className="routes-panel__warning">
              <span dir="auto">{fixtureNameByExpressId.get(assignment.fixtureExpressId) ?? `#${assignment.fixtureExpressId}`}</span>{' '}
              not routed: {unassignedReasonCopy(assignment.reason, branchLimitLabel)}.
            </li>
          ))}
          {overlength.map((assignment) => (
            <li key={`overlength-${assignment.fixtureExpressId}`} className="routes-panel__warning">
              <span dir="auto">{fixtureNameByExpressId.get(assignment.fixtureExpressId) ?? `#${assignment.fixtureExpressId}`}</span>{' '}
              routes to its core stack {stackLabelByRiserId.get(assignment.riserId) ?? assignment.riserId} at{' '}
              {formatMetres(assignment.units === 'mm' ? assignment.planDistance / 1000 : assignment.planDistance)}, beyond the {branchLimitLabel}{' '}
              branch limit (kept: the fixture belongs to that stack&apos;s wet core, and a moved stack always wins).
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function formatMetres(lengthM: number): string {
  return `${lengthM.toFixed(2)} m`
}
