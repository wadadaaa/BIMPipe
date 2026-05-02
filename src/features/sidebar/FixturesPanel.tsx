import type { Fixture } from '@/domain/types'
import './FixturesPanel.css'

interface FixturesPanelProps {
  fixtures: Fixture[]
  isLoading: boolean
  canPlaceRisers?: boolean
  hasRisers?: boolean
  onPlaceRisers?: () => void
}

export function FixturesPanel({
  fixtures,
  isLoading,
  canPlaceRisers = false,
  hasRisers = false,
  onPlaceRisers,
}: FixturesPanelProps) {
  if (isLoading) {
    return (
      <div className="fixtures-panel">
        <div className="fixtures-panel__loading">
          <span className="fixtures-panel__loading-dot" />
          Finding toilets...
        </div>
      </div>
    )
  }

  if (fixtures.length === 0) {
    return (
      <div className="fixtures-panel__empty">
        <span className="fixtures-panel__empty-icon">WC</span>
        <p>No toilets were detected on this floor.</p>
      </div>
    )
  }

  const positionedCount = fixtures.filter((fixture) => fixture.position !== null).length

  return (
    <div className="fixtures-panel">
      <div className="fixtures-panel__summary">
        <div className="fixtures-panel__summary-copy">
          <span className="fixtures-panel__summary-label">Detected</span>
          <span className="fixtures-panel__summary-meta">
            {positionedCount} on plan · {fixtures.length} total
          </span>
        </div>
        <strong className="fixtures-panel__summary-count">{fixtures.length}</strong>
      </div>

      {onPlaceRisers && (
        <button
          type="button"
          className={[
            'fixtures-panel__place-cta',
            hasRisers ? 'fixtures-panel__place-cta--reset' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onPlaceRisers}
          disabled={!canPlaceRisers}
        >
          <span className="fixtures-panel__place-cta-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5v6.8l4.4-2.4M8 1.5L3.6 5.9 8 8.3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M3 9.5v3.2l5 2.8 5-2.8V9.5L8 12.3 3 9.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="fixtures-panel__place-cta-copy">
            <span className="fixtures-panel__place-cta-title">
              {hasRisers ? 'Re-suggest risers' : 'Place risers'}
            </span>
            <span className="fixtures-panel__place-cta-meta">
              {canPlaceRisers
                ? hasRisers
                  ? 'Replace auto risers using the latest detection'
                  : 'Auto-place one riser per toilet and outer kitchen corner'
                : 'No fixtures with plan coordinates yet'}
            </span>
          </span>
          <svg
            className="fixtures-panel__place-cta-arrow"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 3l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      <div className="fixtures-panel__group">
        <div className="fixtures-panel__group-header">
          <span className="fixtures-panel__group-label">Toilets</span>
          <span className="fixtures-panel__group-count">{fixtures.length}</span>
        </div>
        <ul className="fixtures-panel__list">
          {fixtures.map((fixture, index) => (
            <li
              key={fixture.expressId}
              className="fixtures-panel__item-row fixtures-panel__item-row--enter"
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <div className="fixtures-panel__item fixtures-panel__item--static">
                <span className="fixtures-panel__item-copy">
                  <span className="fixtures-panel__item-name" dir="auto">
                    {fixture.name}
                  </span>
                  <span className="fixtures-panel__item-meta">
                    {fixture.position === null ? 'Detected without plan point' : 'Detected from IFC'}
                  </span>
                </span>
                <span className="fixtures-panel__item-id">#{fixture.expressId}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
