import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'

type ValidationReport = ReturnType<typeof buildRiserValidationReport>

interface PlacementValidationPanelProps {
  report: ValidationReport | null
  detectionAggregation: StoreyDetectionAggregation | null
  demoFlowEnabled?: boolean
  /** Why the initial floor was auto-opened (plain mode); null in demo mode. */
  initialStoreyDecision?: InitialStoreyDecision | null
  /** Storey mapping per linked file (multi-IFC uploads); empty for single-file. */
  storeyAlignments?: StoreyAlignment[]
  /** Cross-file fixture merge accounting for the open floor; null for single-file. */
  crossFileMerge?: MergedStoreyDetection | null
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

function formatElevationM(valueM: number): string {
  // `+ 0` folds negative zero so a -0.0004 m elevation prints "0.00", not "-0.00".
  const rounded = Math.round(valueM * 100) / 100 + 0
  return `${rounded.toFixed(2)} m`
}

function formatStoreyNames(entries: Array<{ storeyName: string }>): string {
  return entries.map((entry) => entry.storeyName).join(', ')
}

function StoreyAlignmentSection({ alignment }: { alignment: StoreyAlignment }) {
  if (alignment.status === 'blocked') {
    return (
      <section className="sidebar__panel" data-testid="storey-alignment">
        <p className="sidebar__panel-copy" dir="auto">
          <strong>{alignment.linkedFileName}:</strong> alignment blocked — {alignment.blockedReason}
        </p>
      </section>
    )
  }

  const origin = alignment.originAgreement
  return (
    <section className="sidebar__panel" data-testid="storey-alignment">
      <p className="sidebar__panel-copy" dir="auto">
        <strong>{alignment.linkedFileName}</strong>
        {' — '}
        {alignment.pairs.length} storey {alignment.pairs.length === 1 ? 'pair' : 'pairs'} within{' '}
        {alignment.toleranceMm} mm.
      </p>
      {origin.status === 'mismatch' && origin.warning !== null ? (
        <p className="sidebar__panel-copy" role="alert" dir="auto">
          <strong>Origin warning:</strong> {origin.warning}
        </p>
      ) : (
        <p className="sidebar__panel-copy">
          <strong>Plan origin:</strong>{' '}
          {origin.status === 'shared'
            ? `shared (building placements ${origin.distanceMm} mm apart)`
            : 'unknown'}
        </p>
      )}
      {alignment.pairs.length > 0 && (
        <ul className="risers-panel__legend-list">
          {alignment.pairs.map((pair) => (
            <li key={pair.host.storeyId} dir="auto">
              <strong>{pair.host.storeyName}</strong> ({formatElevationM(pair.host.absoluteElevationM)}) ↔{' '}
              <strong>{pair.linked.storeyName}</strong> ({formatElevationM(pair.linked.absoluteElevationM)}), Δ{' '}
              {pair.deltaMm} mm
            </li>
          ))}
        </ul>
      )}
      {alignment.unmappedHost.length > 0 && (
        <p className="sidebar__panel-copy" dir="auto">
          <strong>Unmapped host storeys ({alignment.unmappedHost.length}):</strong>{' '}
          {formatStoreyNames(alignment.unmappedHost)}
        </p>
      )}
      {alignment.unmappedLinked.length > 0 && (
        <p className="sidebar__panel-copy" dir="auto">
          <strong>Unmapped linked storeys ({alignment.unmappedLinked.length}):</strong>{' '}
          {formatStoreyNames(alignment.unmappedLinked)}
        </p>
      )}
    </section>
  )
}

function CrossFileMergeSection({ merge }: { merge: MergedStoreyDetection }) {
  return (
    <section className="sidebar__panel" data-testid="cross-file-merge">
      <p className="sidebar__panel-title">Cross-file fixtures (open floor)</p>
      <ul className="risers-panel__legend-list">
        {merge.perFile.map((file) => (
          <li key={file.fileName} dir="auto">
            <strong>{file.fileName}:</strong> detected {file.detectedFixtureCount}, merged{' '}
            {file.mergedFixtureCount}, duplicates {file.duplicateFixtureCount}, kitchens{' '}
            {file.kitchenCount}
          </li>
        ))}
      </ul>
      <p className="sidebar__panel-copy">
        {merge.duplicates.length === 0
          ? `No cross-file duplicates within ${merge.dedupeToleranceMm} mm.`
          : `${merge.duplicates.length} duplicate${merge.duplicates.length === 1 ? '' : 's'} dropped (same kind within ${merge.dedupeToleranceMm} mm; host instance kept).`}
      </p>
    </section>
  )
}

export function PlacementValidationPanel({
  report,
  detectionAggregation,
  demoFlowEnabled = false,
  initialStoreyDecision = null,
  storeyAlignments = [],
  crossFileMerge = null,
}: PlacementValidationPanelProps) {
  const autoOpenDecision = initialStoreyDecision && (
    <p className="sidebar__panel-copy">
      <strong>Auto-opened floor:</strong> <span dir="auto">{initialStoreyDecision.storeyName ?? 'none'}</span>
      {' — '}
      {initialStoreyDecision.reason}
      {initialStoreyDecision.scanMs !== null ? ` Fixture scan took ${initialStoreyDecision.scanMs} ms.` : ''}
    </p>
  )

  // Multi-IFC ingest: mapping + merge accounting stay visible before risers
  // are suggested, so alignment problems surface immediately after upload.
  const multiModelSections = (storeyAlignments.length > 0 || crossFileMerge !== null) && (
    <>
      {storeyAlignments.length > 0 && (
        <section className="sidebar__panel">
          <p className="sidebar__panel-title">Storey mapping (linked models)</p>
        </section>
      )}
      {storeyAlignments.map((alignment) => (
        <StoreyAlignmentSection key={alignment.linkedFileName} alignment={alignment} />
      ))}
      {crossFileMerge !== null && <CrossFileMergeSection merge={crossFileMerge} />}
    </>
  )

  if (!report) {
    return (
      <>
        {autoOpenDecision}
        {multiModelSections}
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
      {multiModelSections}
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
