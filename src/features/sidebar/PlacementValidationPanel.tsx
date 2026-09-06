import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { EngineerComparisonReport } from '@/domain/engineerComparisonMetrics'
import type { Storey } from '@/domain/types'
import type {
  SuggestedRiserSnapOutcome,
  SuggestedRiserStackExtent,
  WetCoreSuggestedStack,
} from '@/shared/routes/buildSuggestedRisers'
import type { FixtureRow, WetCore } from '@/domain/wetCores'
import type { OfficeCoreShaftSelection } from '@/domain/continuityMap'
import type { CoreCollector } from '@/domain/coreCollectors'
import {
  BRANCH_LENGTH_LIMIT_M,
  DEFAULT_BUILDING_TYPOLOGY,
  describeBuildingTypology,
  type BuildingTypology,
} from '@/domain/typology'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import type { FloorRoutes } from '@/domain/branchRouting'
import { formatBranchSlopePercent } from '@/domain/branchDefaults'
import { formatLengthM } from '@/shared/lengthUnits'
import { summarizeBranchRunsForDebug } from '@/shared/routes/branchRouteSummary'
import { describeRoutingModel, type RoutingModel } from '@/shared/routes/routingModel'
import {
  collectPlacementWarnings,
  describeDedupeRadii,
  describeWetCoreMembers,
  describeWetCoreStackPlacement,
} from './wetCoreCopy'

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

/** Outcome of the last wet-core suggest run (V3); shape mirrors the page state. */
export interface WetCoreSuggestionSummary {
  sourceStoreyId: number
  stacks: WetCoreSuggestedStack[]
  cores: WetCore[]
  supersededCoreIds: string[]
  preservedStackIds: string[]
  /** Typology the run used (G3). */
  typology: BuildingTypology
  /** Office only: fixture rows routed through a collector. */
  fixtureRows: FixtureRow[]
  /** Office only: core-shaft selection per storey. */
  officeCoreShafts: OfficeCoreShaftSelection[]
  /** Obstructed cores gathered into a neighbour's stack (R1); no stack of their own. */
  coreCollectors: CoreCollector[]
  diagnostics: string[]
}

interface PlacementValidationPanelProps {
  report: ValidationReport | null
  detectionAggregation: StoreyDetectionAggregation | null
  /** Storeys for naming stack extents; empty before a model is loaded. */
  storeys?: Storey[]
  /** Wet-core suggestion of the last run (V3); null in demo mode / before suggesting. */
  wetCoreSuggestion?: WetCoreSuggestionSummary | null
  /** Per-stack vertical extents (V4) of the last run; null when not bounded. */
  riserStackExtents?: SuggestedRiserStackExtent[] | null
  demoFlowEnabled?: boolean
  /** V5 routing switch; the routing-model section renders in plain mode only (demo parity). */
  routingModel?: RoutingModel
  /** Building typology (G3) as set on the upload screen; null hides the line (demo mode). */
  buildingTypology?: BuildingTypology | null
  /** Branch runs of the open floor (branch-runs model); null before stacks exist. */
  branchRouteFloor?: FloorRoutes | null
  /** Fixture assignments of the open floor, summarised in the routing-model section. */
  fixtureAssignments?: FixtureRiserAssignment[]
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
          ? `No cross-file duplicates within ${describeDedupeRadii(merge.dedupeToleranceMm)}.`
          : `${merge.duplicates.length} duplicate${merge.duplicates.length === 1 ? '' : 's'} dropped (same kind within ${describeDedupeRadii(merge.dedupeToleranceMm)}; host instance kept).`}
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
          <strong>Branch runs{branchLengths.scope === 'storey' ? ' on this floor' : ' model-wide'}:</strong> ours{' '}
          {formatLengthM(branchLengths.oursTotalM, 'm')} ({branchLengths.oursSegmentCount} segment
          {branchLengths.oursSegmentCount === 1 ? '' : 's'}) vs engineer{' '}
          {branchLengths.engineerTotalM === null
            ? 'n/a (no Pset lengths)'
            : `${formatLengthM(branchLengths.engineerTotalM, 'm')} (${branchLengths.engineerSegmentCount} horizontal sanitary segment${branchLengths.engineerSegmentCount === 1 ? '' : 's'})`}
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

function WetCoreSection({
  suggestion,
  extents,
  storeys,
}: {
  suggestion: WetCoreSuggestionSummary
  extents: SuggestedRiserStackExtent[] | null
  storeys: Storey[]
}) {
  const storeyName = (id: number) => storeys.find((storey) => storey.id === id)?.name ?? `storey ${id}`
  const warnings = collectPlacementWarnings(suggestion.stacks)
  const extentByLabel = new Map((extents ?? []).map((entry) => [entry.stackLabel, entry.extent]))
  return (
    <section className="sidebar__panel" data-testid="wet-cores">
      <p className="sidebar__panel-title">Wet cores and stack placement</p>
      <p className="sidebar__panel-copy">
        {suggestion.cores.length} wet {suggestion.cores.length === 1 ? 'core' : 'cores'} on the open floor (fixtures within 2.6 m
        of each other), {suggestion.stacks.length} {suggestion.stacks.length === 1 ? 'stack' : 'stacks'} placed.
        {suggestion.preservedStackIds.length > 0 &&
          ` ${suggestion.preservedStackIds.length} manually placed/moved ${suggestion.preservedStackIds.length === 1 ? 'stack was' : 'stacks were'} preserved.`}
        {suggestion.supersededCoreIds.length > 0 &&
          ` ${suggestion.supersededCoreIds.length} ${suggestion.supersededCoreIds.length === 1 ? 'core keeps its moved stack' : 'cores keep their moved stacks'} instead of a new suggestion.`}
      </p>
      {warnings.length > 0 && (
        <ul className="risers-panel__legend-list" role="alert" data-testid="placement-warnings">
          {warnings.map((warning) => (
            <li key={warning.stackLabel}>
              <strong>{warning.stackLabel} needs review:</strong> {warning.message}
            </li>
          ))}
        </ul>
      )}
      <ul className="risers-panel__legend-list" data-testid="wet-core-stacks">
        {suggestion.stacks.map((stack) => {
          const extent = extentByLabel.get(stack.stackLabel)
          return (
            <li key={stack.stackId}>
              <strong>{stack.stackLabel}:</strong>{' '}
              {stack.anchor === 'wet-core' ? `${describeWetCoreMembers(stack.core)} — ` : ''}
              {describeWetCoreStackPlacement(stack)}
              {extent !== undefined && (
                <>
                  {' '}
                  Extent <span dir="auto">{storeyName(extent.collectorStoreyId)}</span> →{' '}
                  <span dir="auto">{storeyName(extent.topStoreyId)}</span> ({extent.storeyIds.length}{' '}
                  {extent.storeyIds.length === 1 ? 'storey' : 'storeys'}
                  {extent.reasons.length > 0 ? `; ${extent.reasons.join('; ')}` : ''}).
                </>
              )}
            </li>
          )
        })}
      </ul>
      {suggestion.coreCollectors.length > 0 && (
        <ul className="risers-panel__legend-list" data-testid="wet-core-collectors">
          {suggestion.coreCollectors.map((collector) => {
            const core = suggestion.cores.find((candidate) => candidate.id === collector.coreId)
            const target = suggestion.stacks.find(
              (stack) => stack.anchor === 'wet-core' && stack.core.id === collector.targetCoreId,
            )
            return (
              <li key={collector.id}>
                <strong>Gathered core{target === undefined ? '' : ` → ${target.stackLabel}`}:</strong>{' '}
                {core === undefined ? collector.memberExpressIds.length + ' fixtures' : describeWetCoreMembers(core)} — no stack of its own;{' '}
                {collector.reason}.
              </li>
            )
          })}
        </ul>
      )}
      {suggestion.diagnostics.map((line) => (
        <p key={line} className="sidebar__panel-copy" dir="auto">
          {line}
        </p>
      ))}
    </section>
  )
}

/**
 * The one line the brief asks for — "Routing model: branch runs (fixture →
 * stack)" — plus how the open floor's fixtures were routed. Plain mode only:
 * the demo panel text is parity-locked.
 */
function RoutingModelSection({
  routingModel,
  floor,
  assignments,
  branchLengthLimitM,
}: {
  routingModel: RoutingModel
  floor: FloorRoutes | null
  assignments: FixtureRiserAssignment[]
  /** Branch limit the assignments were flagged against (typology of the last run). */
  branchLengthLimitM: number
}) {
  const summary = summarizeBranchRunsForDebug(floor === null ? [] : [floor], assignments)
  const floorSummary = summary.floors[0] ?? null
  const routedCount = summary.assignedBy.wetCore + summary.assignedBy.nearest
  const collectorSegments = floor === null ? [] : floor.segments.filter((segment) => segment.role === 'row-collector')
  const collectorRowIds = new Set(collectorSegments.map((segment) => segment.rowId))
  const collectorLength = collectorSegments.reduce(
    (sum, segment) => sum + Math.abs(segment.start.x - segment.end.x) + Math.abs(segment.start.z - segment.end.z),
    0,
  )
  const collectorLengthM = floor?.planUnits === 'mm' ? collectorLength / 1000 : collectorLength
  const coreCollectorSegments = floor === null ? [] : floor.segments.filter((segment) => segment.coreCollectorId !== undefined)
  const coreCollectorIds = new Set(coreCollectorSegments.map((segment) => segment.coreCollectorId))
  const coreCollectorLength = coreCollectorSegments.reduce(
    (sum, segment) => sum + Math.abs(segment.start.x - segment.end.x) + Math.abs(segment.start.z - segment.end.z),
    0,
  )
  const coreCollectorLengthM = floor?.planUnits === 'mm' ? coreCollectorLength / 1000 : coreCollectorLength
  return (
    <section className="sidebar__panel" data-testid="routing-model-section">
      <p className="sidebar__panel-title">Horizontal routing</p>
      <p className="sidebar__panel-copy">
        <strong>{describeRoutingModel(routingModel)}</strong>. Riser-to-riser chains are not built, drawn or exported in this mode. Defaults: Ø110 WC, Ø50 basin/sink/shower, Ø63 for a shared run of two or more small fixtures, slope {formatBranchSlopePercent()}.
      </p>
      {assignments.length === 0 ? (
        <p className="sidebar__panel-copy">No stacks on the open floor yet — branch runs appear after Suggest.</p>
      ) : (
        <ul className="risers-panel__legend-list">
          <li>
            <strong>Fixtures routed:</strong> {routedCount} ({summary.assignedBy.wetCore} to their wet core&apos;s stack,{' '}
            {summary.assignedBy.nearest} to the nearest stack)
          </li>
          {floorSummary !== null && (
            <li>
              <strong>Branch runs:</strong> {floorSummary.segmentCount} segment(s) to {floorSummary.groups.length} stack(s),{' '}
              {floorSummary.totalLengthM.toFixed(2)} m on this floor
            </li>
          )}
          {summary.unrouted.length > 0 && (
            <li>
              <strong>Not routed:</strong> {summary.unrouted.length} fixture(s) without a reachable stack — see the Risers tab.
            </li>
          )}
          {collectorRowIds.size > 0 && (
            <li data-testid="row-collectors">
              <strong>Row collectors:</strong> {collectorRowIds.size} fixture row(s) drain through a collector along the row — {collectorSegments.length}{' '}
              collector segment(s), {collectorLengthM.toFixed(2)} m, then one run per row to the stack.
            </li>
          )}
          {coreCollectorIds.size > 0 && (
            <li data-testid="core-collectors">
              <strong>Core collectors:</strong> {coreCollectorIds.size} obstructed wet core(s) have no stack of their own and drain through
              a collector run to a neighbouring core&apos;s stack — {coreCollectorSegments.length} run segment(s), {coreCollectorLengthM.toFixed(2)} m.
            </li>
          )}
          {summary.overlength.length > 0 && (
            <li>
              <strong>Beyond branch limit:</strong> {summary.overlength.length} fixture(s) kept on their wet core&apos;s stack farther than{' '}
              {formatBranchLimit(branchLengthLimitM)} (wide core or moved stack).
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function formatBranchLimit(limitM: number): string {
  return `${Number.isInteger(limitM) ? limitM.toFixed(0) : limitM.toFixed(1)} m`
}

/**
 * Building typology (G3): what is currently selected on the upload screen,
 * what the last suggest run used, and — for office runs — the core-shaft
 * selection and fixture rows that fell out. Plain mode only.
 */
function TypologySection({
  typology,
  suggestion,
}: {
  typology: BuildingTypology
  suggestion: WetCoreSuggestionSummary | null
}) {
  const stale = suggestion !== null && suggestion.typology !== typology
  return (
    <section className="sidebar__panel" data-testid="typology-section">
      <p className="sidebar__panel-title">Building typology</p>
      <p className="sidebar__panel-copy">
        <strong>{describeBuildingTypology(typology)}</strong>. Branch limit {formatBranchLimit(BRANCH_LENGTH_LIMIT_M[typology])}
        {typology === 'office'
          ? '; stacks on core shafts only, toilet rows drain through a collector along the row.'
          : '; stacks per wet core through shaft → free cell → wall-side edge.'}
      </p>
      {stale && (
        <p className="sidebar__panel-copy" role="status">
          The current stacks were suggested as <strong>{suggestion.typology}</strong> — press Suggest to apply the {typology} rules.
        </p>
      )}
      {suggestion !== null && suggestion.typology === 'office' && (
        <ul className="risers-panel__legend-list" data-testid="office-core-shafts">
          {suggestion.officeCoreShafts.map((selection) => {
            const rejected: Record<string, number> = {}
            for (const candidate of selection.candidates) {
              if (candidate.rejection !== null) rejected[candidate.rejection] = (rejected[candidate.rejection] ?? 0) + 1
            }
            const usedShaftIds = new Set(
              suggestion.stacks.flatMap((stack) =>
                stack.anchor === 'wet-core' && stack.placement.rule === 'shaft' ? [stack.placement.shaftId] : [],
              ),
            )
            const used = selection.candidates.filter((candidate) => usedShaftIds.has(candidate.candidate.id))
            return (
              <li key={selection.storeyId}>
                <strong>Core shafts:</strong> {selection.selected.length} of {selection.candidates.length} shaft candidate(s) selected (
                {selection.denseClusters.length} dense-structure cluster(s), {selection.largeVoids.length} stair/lift void anchor(s))
                {Object.keys(rejected).length > 0 &&
                  `; rejected: ${Object.entries(rejected)
                    .map(([reason, count]) => `${count} ${reason.replace(/-/g, ' ')}`)
                    .join(', ')}`}
                .{used.length > 0 && ` Stacks sit on ${used.length}: ${used.map((candidate) => candidate.reason.replace(/^core shaft: /, '')).join('; ')}.`}
              </li>
            )
          })}
          <li>
            <strong>Fixture rows:</strong>{' '}
            {suggestion.fixtureRows.length === 0
              ? 'none (no ≥ 3 same-kind fixtures in a row)'
              : suggestion.fixtureRows
                  .map((row) => `${row.memberExpressIds.length}× ${row.kind} along ${row.axis} (${row.sideReason} side)`)
                  .join(', ')}
          </li>
        </ul>
      )}
    </section>
  )
}

export function PlacementValidationPanel({
  report,
  detectionAggregation,
  storeys = [],
  wetCoreSuggestion = null,
  riserStackExtents = null,
  demoFlowEnabled = false,
  routingModel = 'branch-runs',
  buildingTypology = null,
  branchRouteFloor = null,
  fixtureAssignments = [],
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

  const wetCoreSection = wetCoreSuggestion !== null && (
    <WetCoreSection suggestion={wetCoreSuggestion} extents={riserStackExtents} storeys={storeys} />
  )

  const typologySection = !demoFlowEnabled && buildingTypology !== null && (
    <TypologySection typology={buildingTypology} suggestion={wetCoreSuggestion} />
  )

  const routingModelSection = !demoFlowEnabled && (
    <RoutingModelSection
      routingModel={routingModel}
      floor={branchRouteFloor}
      assignments={fixtureAssignments}
      branchLengthLimitM={BRANCH_LENGTH_LIMIT_M[wetCoreSuggestion?.typology ?? DEFAULT_BUILDING_TYPOLOGY]}
    />
  )

  if (!report) {
    return (
      <>
        {autoOpenDecision}
        {multiModelSections}
        {engineerSection}
        {continuitySection}
        {typologySection}
        {wetCoreSection}
        {routingModelSection}
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
      {typologySection}
      {wetCoreSection}
      {routingModelSection}
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
