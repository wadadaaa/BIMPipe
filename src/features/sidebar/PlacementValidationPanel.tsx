import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'

type ValidationReport = ReturnType<typeof buildRiserValidationReport>

interface PlacementValidationPanelProps {
  report: ValidationReport | null
  detectionAggregation: StoreyDetectionAggregation | null
}

export function PlacementValidationPanel({ report, detectionAggregation }: PlacementValidationPanelProps) {
  if (!report) {
    return <p className="sidebar__panel-copy">Suggest risers to populate export validation details.</p>
  }

  const classCounts = report.floorClassifications.reduce<Record<string, number>>((acc, floor) => {
    acc[floor.class] = (acc[floor.class] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className="sidebar__panel">
      <p className="sidebar__panel-title">Placement and export readiness</p>
      <ul className="risers-panel__legend-list">
        <li><strong>Processed floors:</strong> {report.summary.processedFloorCount}</li>
        <li><strong>Skipped floors:</strong> {report.summary.skippedFloorCount}</li>
        <li><strong>New risers:</strong> {report.summary.newlyAddedRiserCount}</li>
        <li><strong>Reused riser groups:</strong> {report.summary.reusedRiserGroupCount}</li>
        <li><strong>Coordination warnings:</strong> {report.summary.coordinationIssueCount}</li>
      </ul>
      <p className="sidebar__panel-copy">
        Classification: standard {classCounts.standard ?? 0}, basement {classCounts.basement ?? 0}, roof {classCounts.roof ?? 0}, penthouse {classCounts.penthouse ?? 0}.
      </p>
      {detectionAggregation === null && (
        <p className="sidebar__panel-copy">Detection aggregation is unavailable for this session; report includes partial warnings.</p>
      )}
      {report.placementDecisions.length === 0 && (
        <p className="sidebar__panel-copy">Placement decisions are not available in current flow; see validation warnings in exported debug JSON.</p>
      )}
      {report.validationIssues.length > 0 && (
        <ul className="risers-panel__legend-list">
          {report.validationIssues.map((issue) => (
            <li key={issue.code}>{issue.code}: {issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
