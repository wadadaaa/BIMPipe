import type { Route, RiserId } from '@/domain/types'
import './RoutesPanel.css'

interface RoutesPanelProps {
  routes: Route[]
  /** Human-readable unit label derived from model scale ('mm' | 'm') */
  unitLabel: string
  /** Maps riserId → display label (e.g. "R1") */
  riserLabels: Map<RiserId, string>
}

export function RoutesPanel({ routes, unitLabel, riserLabels }: RoutesPanelProps) {
  if (routes.length === 0) {
    return (
      <div className="routes-panel__empty">
        <span className="routes-panel__empty-icon">~</span>
        <p>Place risers to generate routes. Each fixture connects to its nearest riser at 2% slope.</p>
      </div>
    )
  }

  const passing = routes.filter((r) => r.compliant).length
  const failing = routes.length - passing

  // Failing first, then passing — both sorted by drop descending
  const sorted = [...routes].sort((a, b) => {
    if (a.compliant !== b.compliant) return a.compliant ? 1 : -1
    return b.drop - a.drop
  })

  return (
    <div className="routes-panel">
      <div className="routes-panel__summary-row">
        <div className="routes-panel__summary-chip routes-panel__summary-chip--pass">
          <span className="routes-panel__summary-chip-label">Pass</span>
          <strong>{passing}</strong>
        </div>
        <div className="routes-panel__summary-chip routes-panel__summary-chip--fail">
          <span className="routes-panel__summary-chip-label">Fail</span>
          <strong>{failing}</strong>
        </div>
        <div className="routes-panel__summary-chip">
          <span className="routes-panel__summary-chip-label">Total</span>
          <strong>{routes.length}</strong>
        </div>
      </div>

      <ul className="routes-panel__list">
        {sorted.map((route) => (
          <li
            key={route.id}
            className={[
              'routes-panel__item',
              route.compliant ? 'routes-panel__item--pass' : 'routes-panel__item--fail',
            ].join(' ')}
          >
            <span className="routes-panel__item-status" aria-label={route.compliant ? 'Pass' : 'Fail'}>
              {route.compliant ? '✓' : '✗'}
            </span>
            <span className="routes-panel__item-name" dir="auto" title={route.fixtureName}>
              {route.fixtureName}
            </span>
            <span className="routes-panel__item-riser">
              {riserLabels.get(route.riserId) ?? '—'}
            </span>
            <span className="routes-panel__item-drop">
              {fmtDrop(route.drop)} {unitLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function fmtDrop(v: number): string {
  return v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString()
}
