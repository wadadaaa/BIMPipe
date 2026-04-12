import type { Fixture } from '@/domain/types'
import './FixturesPanel.css'

interface FixturesPanelProps {
  fixtures: Fixture[]
  isLoading: boolean
}

export function FixturesPanel({ fixtures, isLoading }: FixturesPanelProps) {
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

      <div className="fixtures-panel__group">
        <div className="fixtures-panel__group-header">
          <span className="fixtures-panel__group-label">Toilets</span>
          <span className="fixtures-panel__group-count">{fixtures.length}</span>
        </div>
        <ul className="fixtures-panel__list">
          {fixtures.map((fixture) => (
            <li key={fixture.expressId} className="fixtures-panel__item-row">
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
