import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'

type ValidationReport = ReturnType<typeof buildRiserValidationReport>

interface PlacementValidationPanelProps {
  report: ValidationReport | null
  detectionAggregation: StoreyDetectionAggregation | null
  demoFlowEnabled?: boolean
  /** Why the initial floor was auto-opened (plain mode); null in demo mode. */
  initialStoreyDecision?: InitialStoreyDecision | null
}

function getUserFacingIssue(
  issue: { code: string; message: string },
  demoFlowEnabled: boolean,
): { key: string; label: string; message: string } | null {
  if (demoFlowEnabled && issue.code === 'VERTICAL_GROUPING_NOT_AVAILABLE') {
    return null
  }

  if (issue.code === 'VERTICAL_GROUPING_NOT_AVAILABLE') {
    return {
      key: issue.code,
      label: 'Vertical grouping',
      message: 'Vertical grouping is not available in the current placement flow.',
    }
  }

  if (issue.code === 'DETECTION_AGGREGATION_MISSING') {
    return {
      key: issue.code,
      label: 'Floor detection summary',
      message: 'Limited for this session.',
    }
  }

  return {
    key: issue.code,
    label: humanizeCode(issue.code),
    message: stripDeveloperCopy(issue.message),
  }
}

function humanizeCode(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function stripDeveloperCopy(message: string): string {
  return message
    .replace(/;?\s*see validation warnings in exported debug JSON\.?/gi, '.')
    .replace(/debug JSON/gi, 'export notes')
}

export function PlacementValidationPanel({
  report,
  detectionAggregation,
  demoFlowEnabled = false,
  initialStoreyDecision = null,
}: PlacementValidationPanelProps) {
  const autoOpenDecision = initialStoreyDecision && (
    <p className="sidebar__panel-copy">
      <strong>Auto-opened floor:</strong> <span dir="auto">{initialStoreyDecision.storeyName ?? 'none'}</span>
      {' — '}
      {initialStoreyDecision.reason}
      {initialStoreyDecision.scanMs !== null ? ` Fixture scan took ${initialStoreyDecision.scanMs} ms.` : ''}
    </p>
  )

  if (!report) {
    return (
      <>
        {autoOpenDecision}
        <p className="sidebar__panel-copy">Suggest risers to populate export validation details.</p>
      </>
    )
  }

  const classCounts = report.floorClassifications.reduce<Record<string, number>>((acc, floor) => {
    acc[floor.class] = (acc[floor.class] ?? 0) + 1
    return acc
  }, {})
  const userFacingIssues = report.validationIssues
    .map((issue) => getUserFacingIssue(issue, demoFlowEnabled))
    .filter((issue): issue is { key: string; label: string; message: string } => issue !== null)

  return (
    <section className="sidebar__panel">
      {autoOpenDecision}
      <p className="sidebar__panel-title">Placement and export readiness</p>
      <ul className="risers-panel__legend-list">
        <li><strong>Processed floors:</strong> {report.summary.processedFloorCount}</li>
        <li><strong>Skipped floors:</strong> {report.summary.skippedFloorCount}</li>
        <li><strong>New risers:</strong> {report.summary.newlyAddedRiserCount}</li>
        {(!demoFlowEnabled || report.summary.reusedRiserGroupCount > 0) && (
          <li><strong>Reused riser groups:</strong> {report.summary.reusedRiserGroupCount}</li>
        )}
        {(!demoFlowEnabled || report.summary.coordinationIssueCount > 0) && (
          <li><strong>Coordination warnings:</strong> {report.summary.coordinationIssueCount}</li>
        )}
      </ul>
      <p className="sidebar__panel-copy">
        Classification: standard {classCounts.standard ?? 0}, basement {classCounts.basement ?? 0}, roof {classCounts.roof ?? 0}, penthouse {classCounts.penthouse ?? 0}.
      </p>
      {detectionAggregation === null && !demoFlowEnabled && (
        <p className="sidebar__panel-copy">Floor detection summary is unavailable for this session.</p>
      )}
      {report.placementDecisions.length === 0 && !demoFlowEnabled && (
        <p className="sidebar__panel-copy">Placement recommendations will appear after riser strategy review is enabled.</p>
      )}
      {userFacingIssues.length > 0 && (
        <ul className="risers-panel__legend-list">
          {userFacingIssues.map((issue) => (
            <li key={issue.key}><strong>{issue.label}:</strong> {issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
