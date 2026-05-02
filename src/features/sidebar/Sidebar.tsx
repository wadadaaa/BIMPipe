import { startTransition } from 'react'
import type { Fixture, KitchenArea, Riser, RiserId, SidebarTab } from '@/domain/types'
import { ViewTransition } from '@/shared/reactViewTransition'
import { FixturesPanel } from './FixturesPanel'
import { RisersPanel } from './RisersPanel'
import './Sidebar.css'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  selectedStoreyName?: string | null
  storeyCount?: number
  hasModel?: boolean
  fixtures?: Fixture[]
  kitchens?: KitchenArea[]
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
}

const TABS: { id: SidebarTab; label: string; focus: string; hint: string }[] = [
  {
    id: 'fixtures',
    label: 'Toilets',
    focus: 'Toilet inventory',
    hint: 'Amber markers on the plan are detected toilets from the IFC. Kitchens stay visible on the plan for kitchen riser placement.',
  },
  {
    id: 'risers',
    label: 'Risers',
    focus: 'Riser layout',
    hint: 'Blue pins are suggested risers. One is proposed per toilet and one in an outer kitchen corner. Drag pins on the plan before downloading the IFC.',
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
          <span className="sidebar__summary-label">Toilets</span>
          <strong className="sidebar__summary-value">
            {selectedStoreyName ? fixtures.length : '—'}
          </strong>
        </div>
        <div className="sidebar__summary-card">
          <span className="sidebar__summary-label">Kitchens</span>
          <strong className="sidebar__summary-value">
            {selectedStoreyName ? kitchens.length : '—'}
          </strong>
        </div>
        <div className="sidebar__summary-card">
          <span className="sidebar__summary-label">Risers</span>
          <strong className="sidebar__summary-value">
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
                isLoading={isDetectingFixtures}
                canPlaceRisers={
                  fixtures.some((fixture) => fixture.position !== null) ||
                  kitchens.some((kitchen) => kitchen.position !== null)
                }
                hasRisers={risers.length > 0}
                onPlaceRisers={onSuggestRisers}
              />
            ) : (
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
              />
            )}
          </section>
        </ViewTransition>
      </div>
    </aside>
  )
}
