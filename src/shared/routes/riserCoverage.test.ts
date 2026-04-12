import { describe, expect, it } from 'vitest'
import type { Fixture, Riser } from '@/domain/types'
import { findUncoveredToilets } from './riserCoverage'

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    expressId: 1,
    name: 'WC-01',
    kind: 'TOILETPAN',
    storeyId: 10,
    position: { x: 0, y: 50, z: 0 },
    ...overrides,
  }
}

function riser(id: string, position: Riser['position']): Riser {
  return { id, stackId: `stack-${id}`, stackLabel: `R-${id}`, storeyId: 10, position }
}

describe('findUncoveredToilets', () => {
  it('returns no issues when each toilet has its own nearby riser', () => {
    expect(
      findUncoveredToilets(
        [
          fixture({ expressId: 1, name: 'WC-01', position: { x: 0, y: 50, z: 0 } }),
          fixture({ expressId: 2, name: 'WC-02', position: { x: 0.4, y: 50, z: 0 } }),
        ],
        [
          riser('r1', { x: 0, y: 50, z: 0 }),
          riser('r2', { x: 0.4, y: 50, z: 0 }),
        ],
      ),
    ).toEqual([])
  })

  it('reports a toilet when two toilets try to share one nearby riser', () => {
    expect(
      findUncoveredToilets(
        [
          fixture({ expressId: 1, name: 'WC-01', position: { x: 0, y: 50, z: 0 } }),
          fixture({ expressId: 2, name: 'WC-02', position: { x: 0.4, y: 50, z: 0 } }),
        ],
        [riser('r1', { x: 0.2, y: 50, z: 0 })],
      ),
    ).toEqual([
      {
        fixtureExpressId: 2,
        fixtureName: 'WC-02',
        nearestDistance: 0.2,
        reason: 'shared_riser',
      },
    ])
  })

  it('reports toilets that are farther than the allowed WC coverage distance', () => {
    expect(
      findUncoveredToilets(
        [
          fixture({ expressId: 1, name: 'WC-01', position: { x: 0, y: 50, z: 0 } }),
          fixture({ expressId: 2, name: 'WC-02', position: { x: 1.4, y: 50, z: 0 } }),
        ],
        [riser('r1', { x: 0, y: 50, z: 0 })],
      ),
    ).toEqual([
      {
        fixtureExpressId: 2,
        fixtureName: 'WC-02',
        nearestDistance: 1.4,
        reason: 'out_of_range',
      },
    ])
  })

  it('reports toilets when no risers are placed yet', () => {
    expect(
      findUncoveredToilets([
        fixture({ expressId: 7, name: 'WC-A' }),
      ], []),
    ).toEqual([
      {
        fixtureExpressId: 7,
        fixtureName: 'WC-A',
        nearestDistance: null,
        reason: 'no_riser',
      },
    ])
  })
})
