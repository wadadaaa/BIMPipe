import type { Storey, StoreyId } from '@/domain/types'
import { formatLengthM, type LengthUnit } from '@/shared/lengthUnits'
import { ViewTransition } from '@/shared/reactViewTransition'
import './StoreyList.css'

interface StoreyListProps {
  storeys: Storey[]
  selectedId: StoreyId | null
  isLoading: boolean
  onSelect: (id: StoreyId) => void
  /**
   * Declared IFC length unit of raw attribute values such as `Storey.elevation`.
   * null = the model does not declare a supported unit; elevations are then
   * shown as raw numbers with no unit suffix (we never assume a unit).
   */
  modelLengthUnit: LengthUnit | null
}

function formatElevation(elevation: number, unit: LengthUnit | null): string {
  if (unit === null) return Math.round(elevation).toLocaleString()
  return formatLengthM(elevation, unit)
}

export function StoreyList({ storeys, selectedId, isLoading, onSelect, modelLengthUnit }: StoreyListProps) {
  if (storeys.length === 0) return null

  // Highest elevation at top (architectural convention)
  const ordered = [...storeys].reverse()

  return (
    <nav className="storey-list" aria-label="Floor list">
      <div className="storey-list__header">
        <p className="storey-list__heading">Floors</p>
        <span className="storey-list__count" aria-label={`${storeys.length} floors`}>
          {storeys.length}
        </span>
      </div>

      <ul className="storey-list__items" role="listbox" aria-label="Select a floor">
        {ordered.map((s) => (
          <li key={s.id} role="option" aria-selected={s.id === selectedId}>
            <ViewTransition enter="fade-in" exit="fade-out" default="none">
              <button
                className={[
                  'storey-list__item',
                  s.id === selectedId ? 'storey-list__item--selected' : '',
                  isLoading && s.id === selectedId ? 'storey-list__item--loading' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(s.id)}
                disabled={isLoading}
              >
                <span
                  className={[
                    'storey-list__item-status',
                    isLoading && s.id === selectedId ? 'storey-list__item-status--loading' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {isLoading && s.id === selectedId ? (
                    <>
                      <span className="storey-list__spinner" aria-hidden="true" />
                      <span className="storey-list__loading-label" role="status" aria-label={`Loading ${s.name}`}>
                        Loading
                      </span>
                    </>
                  ) : (
                    <span className="storey-list__elev">
                      {formatElevation(s.elevation, modelLengthUnit)}
                    </span>
                  )}
                </span>
                <span className="storey-list__details">
                  <span className="storey-list__name" dir="auto">
                    {s.name}
                  </span>
                  <span className="storey-list__meta">
                    {isLoading && s.id === selectedId
                      ? 'Loading floor'
                      : s.id === selectedId
                        ? 'Open in viewer'
                        : 'Ready to inspect'}
                  </span>
                </span>
              </button>
            </ViewTransition>
          </li>
        ))}
      </ul>
    </nav>
  )
}
