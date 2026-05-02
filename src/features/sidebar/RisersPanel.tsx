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
}: RisersPanelProps) {
  const canSuggest =
    fixtures.some((fixture) => fixture.position !== null) ||
    kitchens.some((kitchen) => kitchen.position !== null)
  const isDownloadingFullIfc = downloadMode === 'full'

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
                {fmt(riser.position.x)}, {fmt(riser.position.z)}
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
