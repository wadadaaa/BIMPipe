import type { Fixture, KitchenArea, Riser, RiserId } from '@/domain/types'
import './RisersPanel.css'

interface RisersPanelProps {
  risers: Riser[]
  fixtures: Fixture[]
  kitchens: KitchenArea[]
  isAddingRiser: boolean
  onToggleAddMode: () => void
  onSuggestRisers: () => void
  onRemove: (id: RiserId) => void
  canDownloadIfc?: boolean
  downloadMode?: 'full' | null
  downloadError?: string | null
  onDownloadFullIfc?: () => void
  sanitaryRouteLimitations?: string[]
  demoFlowEnabled?: boolean
  demoFloorOpened?: boolean
  sanitaryRouteCount?: number
}

export function RisersPanel({
  risers,
  fixtures,
  kitchens,
  isAddingRiser,
  onToggleAddMode,
  onSuggestRisers,
  onRemove,
  canDownloadIfc = false,
  downloadMode = null,
  downloadError = null,
  onDownloadFullIfc = () => {},
  sanitaryRouteLimitations = [],
  demoFlowEnabled = false,
  demoFloorOpened = false,
  sanitaryRouteCount = 0,
}: RisersPanelProps) {
  const canSuggest =
    fixtures.some((fixture) => fixture.position !== null) ||
    kitchens.some((kitchen) => kitchen.position !== null)
  const positionedFixtureCount = demoFlowEnabled
    ? fixtures.filter((fixture) => fixture.position !== null).length
    : 0
  const positionedKitchenCount = demoFlowEnabled
    ? kitchens.filter((kitchen) => kitchen.position !== null).length
    : 0
  const isDownloadingFullIfc = downloadMode === 'full'
  const hasRoutePreview = sanitaryRouteCount > 0
  const demoBlocker = !demoFloorOpened
    ? 'Open an included ADAM_10 demo floor before placing risers.'
    : !canSuggest
      ? 'No sanitary fixture positions detected on this floor yet.'
    : risers.length === 0
      ? 'Place risers before sanitary routing can preview or export routes.'
      : !hasRoutePreview
        ? 'Sanitary routing is waiting for valid fixture-to-riser geometry.'
        : null

  return (
    <div className="risers-panel">
      <div className="risers-panel__toolbar">
        <button
          className={[
            'risers-panel__btn',
            isAddingRiser ? 'risers-panel__btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleAddMode}
        >
          {isAddingRiser ? 'Cancel' : '+ Add riser'}
        </button>
        <button
          className="risers-panel__btn risers-panel__btn--ghost"
          onClick={onSuggestRisers}
          disabled={!canSuggest}
          title={
            canSuggest
              ? 'Auto-place one riser per toilet and one outer-corner riser per kitchen.'
              : 'Open a floor with fixtures or kitchens first'
          }
        >
          {risers.length > 0 ? 'Re-suggest' : 'Suggest'}
        </button>
      </div>

      {isAddingRiser && (
        <p className="risers-panel__hint">Click on the floor plan to place a riser, then drag it to the exact corner if needed.</p>
      )}

      {demoFlowEnabled && (
        <section className="risers-panel__demo-flow" aria-label="Sanitary demo flow">
          <div className="risers-panel__demo-flow-header">
            <span className="risers-panel__demo-kicker">Route demo flow</span>
            <strong>{demoBlocker ? 'Action needed' : 'Ready to export'}</strong>
          </div>
          <ol className="risers-panel__demo-steps">
            <DemoStep done={demoFloorOpened} label="ADAM_10 floor opened" detail="Use an included demo floor before routing." />
            <DemoStep
              done={canSuggest}
              label="Sanitary inputs checked"
              detail={`${positionedFixtureCount} toilet(s), ${positionedKitchenCount} kitchen area(s) with plan points`}
            />
            <DemoStep
              done={risers.length > 0}
              label="Risers selected"
              detail={risers.length > 0 ? `${risers.length} selected/placed riser(s)` : 'Use Place risers from Toilets, Suggest here, or add one manually.'}
            />
            <DemoStep
              done={hasRoutePreview}
              label="Route preview generated"
              detail={hasRoutePreview ? `${sanitaryRouteCount} route(s) visible in preview/export` : 'Routes appear after valid risers and fixture inputs.'}
            />
          </ol>
          {demoBlocker ? (
            <p className="risers-panel__demo-blocker" role="status">{demoBlocker}</p>
          ) : (
            <p className="risers-panel__demo-ready" role="status">Sanitary route preview is ready for IFC export.</p>
          )}
          <ul className="risers-panel__demo-assumptions">
            <li>WC routes use Ø110 intent.</li>
            <li>Small fixtures use Ø50 branches into Ø63 collection mains where needed.</li>
            <li>Horizontal sanitary routes carry 2.0% slope toward the riser.</li>
            <li>Grouped branches prefer approximately 45° joins where geometry allows.</li>
          </ul>
        </section>
      )}

      <div className="risers-panel__download-actions">
        <button
          className="risers-panel__download-btn"
          onClick={onDownloadFullIfc}
          disabled={!canDownloadIfc || downloadMode !== null}
        >
          <DownloadIcon spinning={isDownloadingFullIfc} />
          <span>{isDownloadingFullIfc ? 'Preparing IFC' : 'Download IFC'}</span>
        </button>
      </div>

      {downloadError && (
        <p className="risers-panel__error" role="alert">
          {downloadError}
        </p>
      )}

      {sanitaryRouteLimitations.length > 0 && !demoFlowEnabled && (
        <div className="risers-panel__hint" role="status">
          <strong>Sanitary routing preview notes</strong>
          <ul className="risers-panel__limitations">
            {sanitaryRouteLimitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {risers.length === 0 ? (
        <div className="risers-panel__empty">
          <span className="risers-panel__empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 3" />
              <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p>No risers placed yet. Use Suggest to generate one riser per toilet and one per kitchen, or place them manually.</p>
        </div>
      ) : (
        <div className="risers-panel__list">
          <div className="risers-panel__summary">
            <span className="risers-panel__summary-label">Placed</span>
            <strong className="risers-panel__summary-count">{risers.length}</strong>
          </div>

          {risers.map((riser, index) => (
            <div
              key={riser.id}
              className="risers-panel__item risers-panel__item--enter"
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <span className="risers-panel__item-marker">{riser.stackLabel}</span>
              <span className="risers-panel__item-coords">
                {demoFlowEnabled
                  ? describeRiserLocation(riser, fixtures, kitchens)
                  : `${fmt(riser.position.x)} m, ${fmt(riser.position.z)} m`}
              </span>
              <span className="risers-panel__item-source" title="Riser source">
                {riser.source ?? "placed"}
              </span>
              <button
                className="risers-panel__item-delete"
                onClick={() => onRemove(riser.id)}
                aria-label={`Remove riser ${riser.stackLabel}`}
                title="Remove riser"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmt(n: number): string {
  return n.toFixed(1)
}

function describeRiserLocation(riser: Riser, fixtures: Fixture[], kitchens: KitchenArea[]): string {
  const anchors = [
    ...fixtures
      .filter((fixture) => fixture.position !== null)
      .map((fixture, index) => ({ label: `WC-${index + 1}`, x: fixture.position!.x, z: fixture.position!.z })),
    ...kitchens
      .filter((kitchen) => kitchen.position !== null)
      .map((kitchen, index) => ({ label: `Kitchen-${index + 1}`, x: kitchen.position!.x, z: kitchen.position!.z })),
  ]

  const nearest = anchors
    .map((anchor) => ({
      ...anchor,
      distance: Math.hypot(riser.position.x - anchor.x, riser.position.z - anchor.z),
    }))
    .sort((a, b) => a.distance - b.distance)[0]

  const coordinateFallback = `${fmt(riser.position.x)} m, ${fmt(riser.position.z)} m`
  if (!nearest) return coordinateFallback
  return `near ${nearest.label} · ${fmt(nearest.distance)} m`
}

function DemoStep({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className={['risers-panel__demo-step', done ? 'risers-panel__demo-step--done' : ''].filter(Boolean).join(' ')}>
      <span className="risers-panel__demo-step-dot" aria-hidden="true">{done ? '✓' : '•'}</span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </li>
  )
}

function DownloadIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return <span className="risers-panel__btn-spinner" aria-hidden="true" />
  }
  return (
    <svg
      className="risers-panel__btn-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2v8.5M4.5 7L8 10.5L11.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 13h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
