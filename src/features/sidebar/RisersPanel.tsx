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
  isDownloadingIfc?: boolean
  downloadError?: string | null
  onDownloadIfc?: () => void
}

export function RisersPanel({
  risers,
  fixtures,
  kitchens,
  isAddingRiser,
  onToggleAddMode,
  onSuggestRisers,
  onRemove,
  isDownloadingIfc = false,
  downloadError = null,
  onDownloadIfc = () => {},
}: RisersPanelProps) {
  const canSuggest =
    fixtures.some((fixture) => fixture.position !== null) ||
    kitchens.some((kitchen) => kitchen.position !== null)
  const canDownload = risers.length > 0

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

      <button
        className="risers-panel__download-btn"
        onClick={onDownloadIfc}
        disabled={!canDownload || isDownloadingIfc}
      >
        {isDownloadingIfc ? 'Preparing IFC...' : 'Download IFC'}
      </button>

      {downloadError && (
        <p className="risers-panel__error" role="alert">
          {downloadError}
        </p>
      )}

      {risers.length === 0 ? (
        <div className="risers-panel__empty">
          <span className="risers-panel__empty-icon">○</span>
          <p>No risers placed yet. Use Suggest to generate one riser per toilet and one per kitchen, or place them manually.</p>
        </div>
      ) : (
        <div className="risers-panel__list">
          <div className="risers-panel__summary">
            <span className="risers-panel__summary-label">Placed</span>
            <strong className="risers-panel__summary-count">{risers.length}</strong>
          </div>

          {risers.map((riser) => (
            <div key={riser.id} className="risers-panel__item">
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
