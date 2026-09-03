import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { EngineerComparisonReport } from '@/domain/engineerComparisonMetrics'
import type { SuggestedRiserSnapOutcome } from '@/shared/routes/buildSuggestedRisers'
import { formatLengthM } from '@/shared/lengthUnits'

type ValidationReport = ReturnType<typeof buildRiserValidationReport>

/** Summary of the loaded engineer plumbing baseline (W7) for display. */
export interface EngineerBaselineSummary {
  sourceFileName: string
  systemPrefixes: readonly string[]
  segmentCount: number
  stackCount: number
}

/** Summary of the built continuity map (W5) for display. */
export interface ContinuityMapSummary {
  sourceFileName: string
  storeyCount: number
  shaftCandidateCount: number
  extractMs: number
  buildMs: number
  diagnosticsCount: number
}

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
  /** Engineer baseline (W7): loaded network summary; null until extracted. */
  engineerBaseline?: EngineerBaselineSummary | null
  isExtractingEngineerBaseline?: boolean
  engineerBaselineError?: string | null
  /** Undefined hides the affordance (no model loaded yet). */
  onLoadEngineerBaseline?: () => void
  /** W7 metrics vs our proposal; null until baseline AND risers both exist. */
  engineerComparison?: EngineerComparisonReport | null
  /** Continuity map (W5): built-map summary; null until built. */
  continuityMap?: ContinuityMapSummary | null
  isBuildingContinuityMap?: boolean
  continuityBuildProgress?: { processed: number; total: number } | null
  continuityBuildError?: string | null
  /** Undefined hides the affordance (no model loaded yet). */
  onBuildContinuityMap?: () => void
  /** W5 advanced flag: snap suggested risers to shafts/free cells. */
  continuitySnapEnabled?: boolean
  onToggleContinuitySnap?: () => void
  /** Snap outcomes of the last suggest run; null when snapping was off. */
  riserSnapOutcomes?: SuggestedRiserSnapOutcome[] | null
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

function EngineerComparisonList({ comparison }: { comparison: EngineerComparisonReport }) {
  const {
    riserCounts,
    engineerStackDefinition,
    storeyScope,
    storeyScopeReason,
    meanNearestEngineerRiserDistanceM,
    branchLengths,
    fixtures,
  } = comparison
  return (
    <>
      <p className="sidebar__panel-copy">
        <strong>Comparison vs suggestion</strong>
      </p>
      <ul className="risers-panel__legend-list" data-testid="engineer-comparison">
        <li>
          <strong>Riser stacks on this floor:</strong>{' '}
          {storeyScope === null
            ? `n/a (${storeyScopeReason ?? 'no storey scope'})`
            : `ours ${riserCounts.oursStacksOnStorey} vs engineer ${riserCounts.engineerStacksIntersectingStorey}` +
              ` (${riserCounts.engineerVentStacksIntersectingStorey} vent stack(s) counted separately)`}
        </li>
        <li>
          <strong>Riser stacks model-wide:</strong> ours {riserCounts.oursStacksTotal} (
          {riserCounts.oursPerFloorEntries} per-floor entries) vs engineer {riserCounts.engineerStacksTotal}{' '}
          sanitary, {riserCounts.engineerVentStacksTotal} vent, {riserCounts.engineerStubs} stub(s); stack =
          vertical run ≥ {formatLengthM(engineerStackDefinition.minStackExtentM, 'm')} (
          {engineerStackDefinition.minStackExtentSource})
        </li>
        <li>
          <strong>Mean distance to nearest engineer riser:</strong>{' '}
          {meanNearestEngineerRiserDistanceM === null
            ? 'n/a (no storey scope or one side has no stacks on this floor)'
            : formatLengthM(meanNearestEngineerRiserDistanceM, 'm')}
        </li>
        <li>
          <strong>Branch runs:</strong> ours {formatLengthM(branchLengths.oursTotalM, 'm')} vs engineer{' '}
          {branchLengths.engineerTotalM === null
            ? 'n/a (no Pset lengths)'
            : formatLengthM(branchLengths.engineerTotalM, 'm')}
          {branchLengths.ratioOursToEngineer !== null &&
            ` (ratio ${branchLengths.ratioOursToEngineer.toFixed(2)})`}
          {branchLengths.engineerSegmentsWithNullLength > 0 &&
            `; ${branchLengths.engineerSegmentsWithNullLength} engineer segment(s) without a Pset length`}
        </li>
        <li>
          <strong>Fixtures:</strong> {fixtures.oursAssignedCount} assigned, {fixtures.oursUnassignedCount}{' '}
          unassigned; engineer-connected count not derivable from pipe geometry
        </li>
      </ul>
    </>
  )
}

function EngineerBaselineSection({
  baseline,
  isExtracting,
  error,
  onLoad,
  comparison,
}: {
  baseline: EngineerBaselineSummary | null
  isExtracting: boolean
  error: string | null
  onLoad: () => void
  comparison: EngineerComparisonReport | null
}) {
  return (
    <section className="sidebar__panel" data-testid="engineer-baseline">
      <p className="sidebar__panel-title">Engineer network (comparison baseline)</p>
      {baseline === null ? (
        <>
          <p className="sidebar__panel-copy">
            Load the engineer plumbing systems (prefixes SW-GRV / VNT) from a loaded IFC to overlay
            them on the plan and compare against the suggestion.
          </p>
          <button
            type="button"
            className="risers-panel__btn risers-panel__btn--ghost"
            onClick={onLoad}
            disabled={isExtracting}
          >
            {isExtracting ? 'Extracting engineer network…' : 'Load engineer network'}
          </button>
        </>
      ) : (
        <p className="sidebar__panel-copy" dir="auto">
          <strong>{baseline.sourceFileName}:</strong> {baseline.segmentCount} pipe{' '}
          {baseline.segmentCount === 1 ? 'segment' : 'segments'} ({baseline.systemPrefixes.join(' / ')}),{' '}
          {baseline.stackCount} engineer riser {baseline.stackCount === 1 ? 'stack' : 'stacks'}.
        </p>
      )}
      {baseline !== null && comparison === null && (
        <p className="sidebar__panel-copy">Suggest risers to compare the proposal against this baseline.</p>
      )}
      {comparison !== null && <EngineerComparisonList comparison={comparison} />}
      {error !== null && (
        <p className="sidebar__panel-copy" role="alert" dir="auto">
          <strong>Engineer network:</strong> {error}
        </p>
      )}
    </section>
  )
}

function formatSnapOutcome(outcome: SuggestedRiserSnapOutcome): string {
  const { snap } = outcome
  if (snap.status === 'snapMiss') return `not snapped — ${snap.reason}`
  const target = snap.target === 'shaft' ? 'shaft candidate' : 'free grid cell'
  return `snapped to ${target} (${formatLengthM(snap.distance, 'm')} from anchor)`
}

function ContinuityMapSection({
  summary,
  isBuilding,
  progress,
  error,
  onBuild,
  snapEnabled,
  onToggleSnap,
  snapOutcomes,
}: {
  summary: ContinuityMapSummary | null
  isBuilding: boolean
  progress: { processed: number; total: number } | null
  error: string | null
  onBuild: () => void
  snapEnabled: boolean
  onToggleSnap: () => void
  snapOutcomes: SuggestedRiserSnapOutcome[] | null
}) {
  return (
    <section className="sidebar__panel" data-testid="continuity-map">
      <p className="sidebar__panel-title">Continuity map (vertical shafts)</p>
      {summary === null ? (
        <>
          <p className="sidebar__panel-copy">
            Build the obstruction grid and shaft candidates from the loaded file with walls to
            overlay them on the plan and optionally snap suggested risers.
          </p>
          <button
            type="button"
            className="risers-panel__btn risers-panel__btn--ghost"
            onClick={onBuild}
            disabled={isBuilding}
          >
            {isBuilding
              ? progress === null
                ? 'Building continuity map…'
                : `Analyzing storey ${progress.processed} of ${progress.total}…`
              : 'Build continuity map'}
          </button>
        </>
      ) : (
        <p className="sidebar__panel-copy" dir="auto">
          <strong>{summary.sourceFileName}:</strong> {summary.storeyCount}{' '}
          {summary.storeyCount === 1 ? 'storey' : 'storeys'}, {summary.shaftCandidateCount} shaft{' '}
          {summary.shaftCandidateCount === 1 ? 'candidate' : 'candidates'}. Extracted in{' '}
          {summary.extractMs} ms, built in {summary.buildMs} ms.
          {summary.diagnosticsCount > 0 &&
            ` ${summary.diagnosticsCount} note${summary.diagnosticsCount === 1 ? '' : 's'} in export notes.`}
        </p>
      )}
      <label className="sidebar__panel-copy" style={{ display: 'block' }}>
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={onToggleSnap}
          disabled={summary === null}
        />{' '}
        Snap risers to shafts/free cells (advanced; applies on the next Suggest)
      </label>
      {snapOutcomes !== null && (
        <>
          <p className="sidebar__panel-copy">
            <strong>Snap outcomes (last suggestion)</strong>
          </p>
          {snapOutcomes.length === 0 ? (
            <p className="sidebar__panel-copy">No risers were suggested.</p>
          ) : (
            <ul className="risers-panel__legend-list" data-testid="snap-outcomes">
              {snapOutcomes.map((outcome) => (
                <li key={outcome.stackLabel}>
                  <strong>{outcome.stackLabel}:</strong> {formatSnapOutcome(outcome)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error !== null && (
        <p className="sidebar__panel-copy" role="alert" dir="auto">
          <strong>Continuity map:</strong> {error}
        </p>
      )}
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
  engineerBaseline = null,
  isExtractingEngineerBaseline = false,
  engineerBaselineError = null,
  onLoadEngineerBaseline,
  engineerComparison = null,
  continuityMap = null,
  isBuildingContinuityMap = false,
  continuityBuildProgress = null,
  continuityBuildError = null,
  onBuildContinuityMap,
  continuitySnapEnabled = false,
  onToggleContinuitySnap = () => {},
  riserSnapOutcomes = null,
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

  const engineerSection = onLoadEngineerBaseline !== undefined && (
    <EngineerBaselineSection
      baseline={engineerBaseline}
      isExtracting={isExtractingEngineerBaseline}
      error={engineerBaselineError}
      onLoad={onLoadEngineerBaseline}
      comparison={engineerComparison}
    />
  )

  const continuitySection = onBuildContinuityMap !== undefined && (
    <ContinuityMapSection
      summary={continuityMap}
      isBuilding={isBuildingContinuityMap}
      progress={continuityBuildProgress}
      error={continuityBuildError}
      onBuild={onBuildContinuityMap}
      snapEnabled={continuitySnapEnabled}
      onToggleSnap={onToggleContinuitySnap}
      snapOutcomes={riserSnapOutcomes}
    />
  )

  if (!report) {
    return (
      <>
        {autoOpenDecision}
        {multiModelSections}
        {engineerSection}
        {continuitySection}
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
      {engineerSection}
      {continuitySection}
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
