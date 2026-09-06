import { startTransition } from 'react'
import type { Fixture, KitchenArea, Riser, RiserId, SidebarTab, Storey } from '@/domain/types'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { EngineerComparisonReport } from '@/domain/engineerComparisonMetrics'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import type {
  SuggestedRiserSnapOutcome,
  SuggestedRiserStackExtent,
} from '@/shared/routes/buildSuggestedRisers'
import type { LengthUnit } from '@/shared/lengthUnits'
import type { FloorRoutes } from '@/domain/branchRouting'
import { BRANCH_LENGTH_LIMIT_M, DEFAULT_BUILDING_TYPOLOGY, type BuildingTypology } from '@/domain/typology'
import type { RoutingModel } from '@/shared/routes/routingModel'
import { ViewTransition } from '@/shared/reactViewTransition'
import { FixturesPanel } from './FixturesPanel'
import { RisersPanel } from './RisersPanel'
import {
  PlacementValidationPanel,
  type ContinuityMapSummary,
  type EngineerBaselineSummary,
  type WetCoreSuggestionSummary,
} from './PlacementValidationPanel'
import './Sidebar.css'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  selectedStoreyName?: string | null
  storeyCount?: number
  hasModel?: boolean
  fixtures?: Fixture[]
  kitchens?: KitchenArea[]
  fixtureAssignments?: FixtureRiserAssignment[]
  isDetectingFixtures?: boolean
  risers?: Riser[]
  isAddingRiser?: boolean
  onToggleAddRiser?: () => void
  onSuggestRisers?: () => void
  onRemoveRiser?: (id: RiserId) => void
  canDownloadIfc?: boolean
  downloadMode?: 'full' | null
  downloadError?: string | null
  onDownloadFullIfc?: () => void
  validationReport?: ReturnType<typeof buildRiserValidationReport> | null
  detectionAggregation?: StoreyDetectionAggregation | null
  /** Why the initial floor was auto-opened (plain mode); null in demo mode. */
  initialStoreyDecision?: InitialStoreyDecision | null
  /** Storey mapping per linked file (multi-IFC uploads); empty for single-file. */
  storeyAlignments?: StoreyAlignment[]
  /** Cross-file fixture merge accounting for the open floor; null for single-file. */
  crossFileMerge?: MergedStoreyDetection | null
  demoFlowEnabled?: boolean
  demoFloorOpened?: boolean
  sanitaryRouteCount?: number
  /** V5 routing switch (one place: the reducer); drives the routes list and the Decisions line. */
  routingModel?: RoutingModel
  /** Building typology switch (G3) as currently set on the upload screen; null hides the Decisions line (demo mode). */
  buildingTypology?: BuildingTypology | null
  /** Branch runs of the open floor under the branch-runs model; null before stacks exist. */
  branchRouteFloor?: FloorRoutes | null
  /** Model length unit resolved from IfcUnitAssignment; null when unknown. */
  modelLengthUnit?: LengthUnit | null
  /** Engineer baseline (W7) summary for the Decisions tab; null until loaded. */
  engineerBaseline?: EngineerBaselineSummary | null
  isExtractingEngineerBaseline?: boolean
  engineerBaselineError?: string | null
  onLoadEngineerBaseline?: () => void
  /** W7 metrics: our proposal vs the engineer baseline; null until both exist. */
  engineerComparison?: EngineerComparisonReport | null
  /** Continuity map (W5) summary for the Decisions tab; null until built. */
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
  /** All storeys (for naming stack extents in the Decisions tab). */
  storeys?: Storey[]
  /** Wet-core suggestion of the last run (V3); null in demo mode / before suggesting. */
  wetCoreSuggestion?: WetCoreSuggestionSummary | null
  /** Per-stack vertical extents (V4) of the last run; null when not bounded. */
  riserStackExtents?: SuggestedRiserStackExtent[] | null
  /** Async suggest lifecycle (V3): whole-building scan progress + cancel. */
  isSuggestingRisers?: boolean
  suggestProgress?: { processed: number; total: number; storeyName: string | null } | null
  suggestError?: string | null
  onCancelSuggestRisers?: () => void
}

interface TabMeta {
  id: SidebarTab
  label: string
  focus: string
  hint: string
}

/** Demo-mode copy: unchanged from the toilet-anchored flow (parity-checked). */
const DEMO_TABS: TabMeta[] = [
  {
    id: 'fixtures',
    label: 'Fixtures',
    focus: 'Fixture inventory',
    hint: 'Amber markers on the plan are detected sanitary fixtures from the IFC. Kitchens stay visible on the plan for kitchen riser placement.',
  },
  {
    id: 'risers',
    label: 'Risers',
    focus: 'Riser layout',
    hint: 'Blue pins are suggested risers. One is proposed per toilet and one in an outer kitchen corner. Drag pins on the plan before downloading the IFC.',
  },
  {
    id: 'validation',
    label: 'Decisions',
    focus: 'Validation and decisions',
    hint: 'Review processed/skipped floors, riser reuse counts, and any placement warnings before demo export.',
  },
]

/** Plain-mode copy (V3 wet-core placement). */
const TABS: TabMeta[] = [
  DEMO_TABS[0],
  {
    id: 'risers',
    label: 'Risers',
    focus: 'Riser layout',
    hint: 'Blue pins are suggested riser stacks: one per wet core (fixtures within 2.6 m of each other), snapped to a shaft or free cell when a continuity map is built, plus one per kitchen. Dragged and manually added stacks survive Re-suggest.',
  },
  {
    id: 'validation',
    label: 'Decisions',
    focus: 'Validation and decisions',
    hint: 'Review processed/skipped floors, wet cores, stack placement and extent, and any placement warnings before export.',
  },
]

export function Sidebar({
  activeTab,
  onTabChange,
  selectedStoreyName = null,
  storeyCount = 0,
  hasModel = false,
  fixtures = [],
  kitchens = [],
  fixtureAssignments = [],
  isDetectingFixtures = false,
  risers = [],
  isAddingRiser = false,
  onToggleAddRiser = () => {},
  onSuggestRisers = () => {},
  onRemoveRiser = () => {},
  canDownloadIfc = false,
  downloadMode = null,
  downloadError = null,
  onDownloadFullIfc = () => {},
  validationReport = null,
  detectionAggregation = null,
  initialStoreyDecision = null,
  storeyAlignments = [],
  crossFileMerge = null,
  demoFlowEnabled = false,
  demoFloorOpened = false,
  sanitaryRouteCount = 0,
  routingModel = 'branch-runs',
  buildingTypology = null,
  branchRouteFloor = null,
  modelLengthUnit = null,
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
  storeys = [],
  wetCoreSuggestion = null,
  riserStackExtents = null,
  isSuggestingRisers = false,
  suggestProgress = null,
  suggestError = null,
  onCancelSuggestRisers = () => {},
}: SidebarProps) {
  const tabs = demoFlowEnabled ? DEMO_TABS : TABS
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab)!
  const riserPanelKey = risers.map((riser) => riser.id).join(':') || 'empty'
  const statusLabel = selectedStoreyName
    ? 'Floor open'
    : hasModel
      ? storeyCount > 0
        ? `${storeyCount} floors parsed`
        : 'Choose floor'
      : 'Awaiting IFC'
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__header-text">
          <h2 className="sidebar__title" dir="auto">
            {selectedStoreyName ?? 'No active floor'}
          </h2>
        </div>
        <span className="sidebar__status">{statusLabel}</span>
      </div>

      <div className="sidebar__summary-grid">
        <div className="sidebar__summary-card">
          <span className="sidebar__summary-label">Fixtures</span>
          <strong
            key={`fixtures-${selectedStoreyName ? fixtures.length : 'idle'}`}
            className="sidebar__summary-value sidebar__summary-value--flash"
          >
            {selectedStoreyName ? fixtures.length : '—'}
          </strong>
        </div>
        <div className="sidebar__summary-card">
          <span className="sidebar__summary-label">Kitchens</span>
          <strong
            key={`kitchens-${selectedStoreyName ? kitchens.length : 'idle'}`}
            className="sidebar__summary-value sidebar__summary-value--flash"
          >
            {selectedStoreyName ? kitchens.length : '—'}
          </strong>
        </div>
        <div
          className={[
            'sidebar__summary-card',
            risers.length > 0 ? 'sidebar__summary-card--accent' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="sidebar__summary-label">Risers</span>
          <strong
            key={`risers-${selectedStoreyName ? risers.length : 'idle'}`}
            className="sidebar__summary-value sidebar__summary-value--flash"
          >
            {selectedStoreyName ? risers.length : '—'}
          </strong>
        </div>
      </div>

      <div className="sidebar__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={[
              'sidebar__tab',
              activeTab === tab.id ? 'sidebar__tab--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() =>
              startTransition(() => {
                onTabChange(tab.id)
              })
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sidebar__content" role="tabpanel">
        <ViewTransition key={activeTab} enter="fade-in" exit="fade-out" default="none">
          <section className="sidebar__tab-panel">
            <section className="sidebar__panel">
              <p className="sidebar__panel-label">{activeTabMeta.label}</p>
              <p className="sidebar__panel-title">{activeTabMeta.focus}</p>
              <p className="sidebar__panel-copy">{activeTabMeta.hint}</p>
            </section>

            {activeTab === 'fixtures' ? (
              <FixturesPanel
                fixtures={fixtures}
                assignments={fixtureAssignments}
                isLoading={isDetectingFixtures}
                canPlaceRisers={
                  fixtures.some((fixture) => fixture.position !== null) ||
                  kitchens.some((kitchen) => kitchen.position !== null)
                }
                hasRisers={risers.length > 0}
                onPlaceRisers={onSuggestRisers}
              />
            ) : activeTab === 'risers' ? (
              <RisersPanel
                key={riserPanelKey}
                risers={risers}
                fixtures={fixtures}
                kitchens={kitchens}
                isAddingRiser={isAddingRiser}
                onToggleAddMode={onToggleAddRiser}
                onSuggestRisers={onSuggestRisers}
                onRemove={onRemoveRiser}
                canDownloadIfc={canDownloadIfc}
                downloadMode={downloadMode}
                downloadError={downloadError}
                onDownloadFullIfc={onDownloadFullIfc}
                demoFlowEnabled={demoFlowEnabled}
                demoFloorOpened={demoFloorOpened}
                sanitaryRouteCount={sanitaryRouteCount}
                routingModel={routingModel}
                branchRouteFloor={branchRouteFloor}
                fixtureAssignments={fixtureAssignments}
                modelLengthUnit={modelLengthUnit}
                wetCoreStacks={wetCoreSuggestion?.stacks ?? null}
                branchLengthLimitM={BRANCH_LENGTH_LIMIT_M[wetCoreSuggestion?.typology ?? DEFAULT_BUILDING_TYPOLOGY]}
                isSuggestingRisers={isSuggestingRisers}
                suggestProgress={suggestProgress}
                suggestError={suggestError}
                onCancelSuggestRisers={onCancelSuggestRisers}
              />
            ) : (
              <PlacementValidationPanel
                report={validationReport}
                detectionAggregation={detectionAggregation}
                storeys={storeys}
                wetCoreSuggestion={wetCoreSuggestion}
                riserStackExtents={riserStackExtents}
                demoFlowEnabled={demoFlowEnabled}
                routingModel={routingModel}
                buildingTypology={buildingTypology}
                branchRouteFloor={branchRouteFloor}
                fixtureAssignments={fixtureAssignments}
                initialStoreyDecision={initialStoreyDecision}
                storeyAlignments={storeyAlignments}
                crossFileMerge={crossFileMerge}
                engineerBaseline={engineerBaseline}
                isExtractingEngineerBaseline={isExtractingEngineerBaseline}
                engineerBaselineError={engineerBaselineError}
                onLoadEngineerBaseline={onLoadEngineerBaseline}
                engineerComparison={engineerComparison}
                continuityMap={continuityMap}
                isBuildingContinuityMap={isBuildingContinuityMap}
                continuityBuildProgress={continuityBuildProgress}
                continuityBuildError={continuityBuildError}
                onBuildContinuityMap={onBuildContinuityMap}
                continuitySnapEnabled={continuitySnapEnabled}
                onToggleContinuitySnap={onToggleContinuitySnap}
                riserSnapOutcomes={riserSnapOutcomes}
              />
            )}
          </section>
        </ViewTransition>
      </div>
    </aside>
  )
}
