import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FixturesPanel } from './FixturesPanel'
import type { Fixture } from '@/domain/types'

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    expressId: 101,
    name: 'WC-01',
    kind: 'TOILETPAN',
    storeyId: 5,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

describe('FixturesPanel', () => {
  it('shows a loading indicator while detecting', () => {
    render(<FixturesPanel fixtures={[]} isLoading={true} />)
    expect(screen.getByText(/finding fixtures/i)).toBeInTheDocument()
  })

  it('shows the empty state when no fixtures are found', () => {
    render(<FixturesPanel fixtures={[]} isLoading={false} />)
    expect(screen.getByText(/no sanitary fixtures were detected/i)).toBeInTheDocument()
  })

  it('renders the detected toilet list and count', () => {
    render(
      <FixturesPanel
        fixtures={[
          makeFixture({ expressId: 1, name: 'WC-01' }),
          makeFixture({ expressId: 2, name: 'WC-02' }),
        ]}
        isLoading={false}
      />,
    )

    expect(screen.getByText('WC-01')).toBeInTheDocument()
    expect(screen.getByText('WC-02')).toBeInTheDocument()
    expect(screen.getByText('Toilets')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('shows when a detected toilet has no plan point', () => {
    render(
      <FixturesPanel
        fixtures={[makeFixture({ expressId: 1, position: null })]}
        isLoading={false}
      />,
    )

    expect(screen.getByText(/detected without plan point/i)).toBeInTheDocument()
  })

  it('renders per-kind counts for mixed-kind detections', () => {
    render(
      <FixturesPanel
        fixtures={[
          makeFixture({ expressId: 1, name: 'WC-01', kind: 'TOILETPAN' }),
          makeFixture({ expressId: 2, name: 'WC-02', kind: 'TOILETPAN' }),
          makeFixture({ expressId: 3, name: 'Basin-01', kind: 'WASHHANDBASIN' }),
          makeFixture({ expressId: 4, name: 'Bath-01', kind: 'BATH' }),
          makeFixture({ expressId: 5, name: 'KSink-01', kind: 'SINK', isKitchenSink: true }),
        ]}
        isLoading={false}
      />,
    )

    function expectGroupCount(label: string, count: number) {
      const header = screen.getByText(label).closest('div')
      expect(header, `group "${label}"`).not.toBeNull()
      expect(header!).toHaveTextContent(String(count))
    }

    expectGroupCount('Toilets', 2)
    expectGroupCount('Basins', 1)
    expectGroupCount('Baths', 1)
    expectGroupCount('Kitchen sinks', 1)
    expect(screen.queryByText('Urinals')).not.toBeInTheDocument()
  })

  it('surfaces unassigned fixtures with a count and a per-fixture badge', () => {
    render(
      <FixturesPanel
        fixtures={[
          makeFixture({ expressId: 1, name: 'WC-01', kind: 'TOILETPAN' }),
          makeFixture({ expressId: 2, name: 'Basin-02', kind: 'WASHHANDBASIN', position: { x: 9000, y: 0, z: 9000 } }),
        ]}
        assignments={[
          {
            fixtureExpressId: 1,
            kind: 'TOILETPAN',
            storeyId: 5,
            unassigned: false,
            riserId: 'r1',
            stackId: 'stack-1',
            fixturePosition: { x: 0, y: 0, z: 0 },
            riserPosition: { x: 0, y: 0, z: 0 },
            planDistance: 0,
            units: 'mm',
          },
          {
            fixtureExpressId: 2,
            kind: 'WASHHANDBASIN',
            storeyId: 5,
            unassigned: true,
            fixturePosition: { x: 9000, y: 0, z: 9000 },
            reason: 'no-riser-within-branch-length',
          },
        ]}
        isLoading={false}
      />,
    )

    expect(screen.getByText('1 fixture without a riser in range')).toBeInTheDocument()
    const badge = screen.getByText('Unassigned')
    expect(badge.closest('li')).toHaveTextContent('Basin-02')
    // The assigned toilet row carries no badge.
    expect(screen.getAllByText('Unassigned')).toHaveLength(1)
  })
})
