import type { Fixture, Riser, Route, RiserId } from '@/domain/types'
import { findUncoveredToilets, getMaxRiserToWcDistance } from '@/shared/routes/riserCoverage'
import './ValidationPanel.css'

interface ValidationPanelProps {
  routes: Route[]
  fixtures: Fixture[]
  risers: Riser[]
  unitLabel: string
  screedDepth: number
  riserLabels: Map<RiserId, string>
}

export function ValidationPanel({
  routes,
  fixtures,
  risers,
  unitLabel,
  screedDepth,
  riserLabels,
}: ValidationPanelProps) {
  const uncoveredToilets = findUncoveredToilets(fixtures, risers)
  const wcCoverageLimit = getMaxRiserToWcDistance(unitLabel === 'm' ? 'm' : 'mm')

  if (routes.length === 0 && uncoveredToilets.length === 0) {
    return (
      <div className="validation-panel__empty">
        <span className="validation-panel__empty-icon">✓</span>
        <p>Place risers to run the screed-depth check. Results appear here automatically.</p>
      </div>
    )
  }

  const passing = routes.filter((r) => r.compliant).length
  const failing = routes.length - passing
  const pct = Math.round((passing / routes.length) * 100)
  const maxDrop = Math.max(...routes.map((r) => r.drop))
  const issues = routes.filter((r) => !r.compliant).sort((a, b) => b.drop - a.drop)

  return (
    <div className="validation-panel">
      {uncoveredToilets.length > 0 && (
        <div className="validation-panel__coverage">
          <div className="validation-panel__coverage-header">
            <span className="validation-panel__coverage-label">Mandatory WC coverage</span>
            <strong className="validation-panel__coverage-count">{uncoveredToilets.length}</strong>
          </div>
          <p className="validation-panel__coverage-copy">
            Each toilet must have its own riser within {fmtDistance(wcCoverageLimit)} {unitLabel}.
          </p>

          <ul className="validation-panel__issue-list">
            {uncoveredToilets.map((issue) => (
              <li key={issue.fixtureExpressId} className="validation-panel__issue">
                <span className="validation-panel__issue-icon">!</span>
                <span className="validation-panel__issue-name" title={issue.fixtureName} dir="auto">
                  {issue.fixtureName}
                </span>
                <span className="validation-panel__issue-riser validation-panel__issue-riser--fail">
                  WC
                </span>
                <span className="validation-panel__issue-drop">
                  {formatCoverageIssue(issue, unitLabel)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {routes.length === 0 ? (
        <div className="validation-panel__pending">
          Add or suggest risers to run the screed-depth route check.
        </div>
      ) : (
        <>
          {/* Score */}
          <div className={['validation-panel__score', failing === 0 ? 'validation-panel__score--clear' : ''].filter(Boolean).join(' ')}>
            <span className="validation-panel__score-pct">{pct}%</span>
            <span className="validation-panel__score-label">
              {failing === 0 ? 'All routes compliant' : `${failing} route${failing > 1 ? 's' : ''} exceed screed limit`}
            </span>
          </div>

          {/* Stats */}
          <div className="validation-panel__stats">
            <div className="validation-panel__stat">
              <span className="validation-panel__stat-label">Limit</span>
              <strong className="validation-panel__stat-value">{screedDepth} {unitLabel}</strong>
            </div>
            <div className="validation-panel__stat">
              <span className="validation-panel__stat-label">Max drop</span>
              <strong className={['validation-panel__stat-value', maxDrop > screedDepth ? 'validation-panel__stat-value--fail' : ''].filter(Boolean).join(' ')}>
                {fmtDrop(maxDrop)} {unitLabel}
              </strong>
            </div>
            <div className="validation-panel__stat">
              <span className="validation-panel__stat-label">Slope</span>
              <strong className="validation-panel__stat-value">2%</strong>
            </div>
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div className="validation-panel__issues">
              <p className="validation-panel__issues-header">Failing routes</p>
              <ul className="validation-panel__issue-list">
                {issues.map((route) => (
                  <li key={route.id} className="validation-panel__issue">
                    <span className="validation-panel__issue-icon">✗</span>
                    <span className="validation-panel__issue-name" title={route.fixtureName} dir="auto">
                      {route.fixtureName}
                    </span>
                    <span className="validation-panel__issue-riser">
                      {riserLabels.get(route.riserId) ?? '—'}
                    </span>
                    <span className="validation-panel__issue-drop">
                      {fmtDrop(route.drop)} {unitLabel}
                      <span className="validation-panel__issue-over">
                        {' '}+{fmtDrop(route.drop - screedDepth)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {failing === 0 && (
            <div className="validation-panel__clear">
              All {routes.length} route{routes.length > 1 ? 's' : ''} fit within the {screedDepth} {unitLabel} screed zone.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function fmtDrop(v: number): string {
  return v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString()
}

function fmtDistance(v: number): string {
  return v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString()
}

function formatCoverageIssue(
  issue: { nearestDistance: number | null; reason: 'no_riser' | 'out_of_range' | 'shared_riser' },
  unitLabel: string,
): string {
  if (issue.reason === 'no_riser' || issue.nearestDistance === null) return 'no riser'
  if (issue.reason === 'shared_riser') return `shared ${fmtDistance(issue.nearestDistance)} ${unitLabel}`
  return `nearest ${fmtDistance(issue.nearestDistance)} ${unitLabel}`
}
