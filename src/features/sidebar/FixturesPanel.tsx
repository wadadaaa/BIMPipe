import { useState } from 'react'
import type { Fixture } from '@/domain/types'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import './FixturesPanel.css'

interface FixturesPanelProps {
  fixtures: Fixture[]
  isLoading: boolean
  canPlaceRisers?: boolean
  hasRisers?: boolean
  onPlaceRisers?: () => void
  /** Fixture-to-riser assignments for the active floor; empty until risers exist. */
  assignments?: FixtureRiserAssignment[]
}

type FixtureGroupKey = Fixture['kind'] | 'KITCHEN_SINK'

const FIXTURE_GROUP_ORDER: FixtureGroupKey[] = [
  'TOILETPAN',
  'KITCHEN_SINK',
  'SINK',
  'WASHHANDBASIN',
  'BATH',
  'URINAL',
  'BIDET',
  'CISTERN',
  'OTHER',
]

const FIXTURE_GROUP_LABELS: Record<FixtureGroupKey, string> = {
  TOILETPAN: 'Toilets',
  KITCHEN_SINK: 'Kitchen sinks',
  SINK: 'Sinks',
  WASHHANDBASIN: 'Basins',
  BATH: 'Baths',
  URINAL: 'Urinals',
  BIDET: 'Bidets',
  CISTERN: 'Cisterns',
  OTHER: 'Other fixtures',
}

const UNASSIGNED_REASON_TITLES: Record<
  Extract<FixtureRiserAssignment, { unassigned: true }>['reason'],
  string
> = {
  'no-plan-position': 'No plan position detected',
  'no-riser-on-storey': 'No riser on this floor',
  'no-riser-within-branch-length': 'No riser within the max branch length (4 m)',
}

function getFixtureGroupKey(fixture: Fixture): FixtureGroupKey {
  return fixture.kind === 'SINK' && fixture.isKitchenSink ? 'KITCHEN_SINK' : fixture.kind
}

export function FixturesPanel({
  fixtures,
  isLoading,
  canPlaceRisers = false,
  hasRisers = false,
  onPlaceRisers,
  assignments = [],
}: FixturesPanelProps) {
  const [isFiring, setIsFiring] = useState(false)

  function handlePlaceRisers() {
    if (!onPlaceRisers || !canPlaceRisers) return
    setIsFiring(true)
    window.setTimeout(() => setIsFiring(false), 550)
    onPlaceRisers()
  }

  if (isLoading) {
    return (
      <div className="fixtures-panel">
        <div className="fixtures-panel__loading">
          <span className="fixtures-panel__loading-dot" />
          Finding fixtures...
        </div>
      </div>
    )
  }

  if (fixtures.length === 0) {
    return (
      <div className="fixtures-panel__empty">
        <span className="fixtures-panel__empty-icon">WC</span>
        <p>No sanitary fixtures were detected on this floor.</p>
      </div>
    )
  }

  const positionedCount = fixtures.filter((fixture) => fixture.position !== null).length
  const unassignedByExpressId = new Map(
    assignments
      .filter((assignment): assignment is Extract<FixtureRiserAssignment, { unassigned: true }> =>
        assignment.unassigned,
      )
      .map((assignment) => [assignment.fixtureExpressId, assignment]),
  )
  const unassignedCount = fixtures.filter((fixture) =>
    unassignedByExpressId.has(fixture.expressId),
  ).length
  const fixtureGroups = FIXTURE_GROUP_ORDER.map((key) => ({
    key,
    label: FIXTURE_GROUP_LABELS[key],
    items: fixtures.filter((fixture) => getFixtureGroupKey(fixture) === key),
  })).filter((group) => group.items.length > 0)

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

      {unassignedCount > 0 && (
        <p className="fixtures-panel__unassigned-note" role="status">
          {unassignedCount} fixture{unassignedCount === 1 ? '' : 's'} without a riser in range
        </p>
      )}

      {onPlaceRisers && (
        <button
          type="button"
          className={[
            'fixtures-panel__place-cta',
            hasRisers ? 'fixtures-panel__place-cta--reset' : '',
            isFiring ? 'fixtures-panel__place-cta--firing' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={handlePlaceRisers}
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

      {fixtureGroups.map((group) => (
        <div className="fixtures-panel__group" key={group.key}>
          <div className="fixtures-panel__group-header">
            <span className="fixtures-panel__group-label">{group.label}</span>
            <span className="fixtures-panel__group-count">{group.items.length}</span>
          </div>
          <ul className="fixtures-panel__list">
            {group.items.map((fixture, index) => {
              const unassignedAssignment = unassignedByExpressId.get(fixture.expressId)

              return (
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
                    {unassignedAssignment && (
                      <span
                        className="fixtures-panel__item-badge"
                        title={UNASSIGNED_REASON_TITLES[unassignedAssignment.reason]}
                      >
                        Unassigned
                      </span>
                    )}
                    <span className="fixtures-panel__item-id">#{fixture.expressId}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
