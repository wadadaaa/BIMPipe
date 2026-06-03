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
    expect(screen.getByText(/finding sanitary fixtures/i)).toBeInTheDocument()
  })

  it('shows the empty state when no sanitary fixtures are found', () => {
    render(<FixturesPanel fixtures={[]} isLoading={false} />)
    expect(screen.getByText(/no sanitary fixtures were detected/i)).toBeInTheDocument()
  })

  it('renders the detected sanitary fixture list and count', () => {
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
    expect(screen.getByText('Sanitary fixtures')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('shows when a detected sanitary fixture has no plan point', () => {
    render(
      <FixturesPanel
        fixtures={[makeFixture({ expressId: 1, position: null })]}
        isLoading={false}
      />,
    )

    expect(screen.getByText(/detected without plan point/i)).toBeInTheDocument()
  })
})
