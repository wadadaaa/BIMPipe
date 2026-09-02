import { startTransition } from 'react'
import type { Fixture, KitchenArea, Riser, RiserId, SidebarTab } from '@/domain/types'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { EngineerComparisonReport } from '@/domain/engineerComparisonMetrics'
import type { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import type { LengthUnit } from '@/shared/lengthUnits'
import { ViewTransition } from '@/shared/reactViewTransition'
import { FixturesPanel } from './FixturesPanel'
import { RisersPanel } from './RisersPanel'
import {
  PlacementValidationPanel,
  type EngineerBaselineSummary,
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
  sanitaryRouteLimitations?: string[]
  demoFlowEnabled?: boolean
  demoFloorOpened?: boolean
  sanitaryRouteCount?: number
  /** Model length unit resolved from IfcUnitAssignment; null when unknown. */
  modelLengthUnit?: LengthUnit | null
  /** Engineer baseline (W7) summary for the Decisions tab; null until loaded. */
  engineerBaseline?: EngineerBaselineSummary | null
  isExtractingEngineerBaseline?: boolean
  engineerBaselineError?: string | null
  onLoadEngineerBaseline?: () => void
  /** W7 metrics: our proposal vs the engineer baseline; null until both exist. */
  engineerComparison?: EngineerComparisonReport | null
}

const TABS: { id: SidebarTab; label: string; focus: string; hint: string }[] = [
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
  sanitaryRouteLimitations = [],
  demoFlowEnabled = false,
  demoFloorOpened = false,
  sanitaryRouteCount = 0,
  modelLengthUnit = null,
  engineerBaseline = null,
  isExtractingEngineerBaseline = false,
  engineerBaselineError = null,
  onLoadEngineerBaseline,
  engineerComparison = null,
}: SidebarProps) {
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab)!
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
        {TABS.map((tab) => (
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
                sanitaryRouteLimitations={sanitaryRouteLimitations}
                demoFlowEnabled={demoFlowEnabled}
                demoFloorOpened={demoFloorOpened}
                sanitaryRouteCount={sanitaryRouteCount}
                modelLengthUnit={modelLengthUnit}
              />
            ) : (
              <PlacementValidationPanel
                report={validationReport}
                detectionAggregation={detectionAggregation}
                demoFlowEnabled={demoFlowEnabled}
                initialStoreyDecision={initialStoreyDecision}
                storeyAlignments={storeyAlignments}
                crossFileMerge={crossFileMerge}
                engineerBaseline={engineerBaseline}
                isExtractingEngineerBaseline={isExtractingEngineerBaseline}
                engineerBaselineError={engineerBaselineError}
                onLoadEngineerBaseline={onLoadEngineerBaseline}
                engineerComparison={engineerComparison}
              />
            )}
          </section>
        </ViewTransition>
      </div>
    </aside>
  )
}
