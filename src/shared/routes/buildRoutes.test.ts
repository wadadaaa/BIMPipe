import { describe, expect, it } from 'vitest'
import type { Fixture, Riser } from '@/domain/types'
import { buildRoutes, detectModelUnits } from './buildRoutes'

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

describe('buildRoutes', () => {
  it('detects millimetre models from X/Z plan coordinates', () => {
    expect(
      detectModelUnits([
        fixture({ position: { x: 20, y: 50, z: 1800 } }),
      ]),
    ).toBe('mm')
  })

  it('assigns fixtures to the nearest riser on the X/Z plan plane', () => {
    const routes = buildRoutes(
      [fixture({ position: { x: 0, y: 50, z: 1000 } })],
      [
        riser('far-on-plan', { x: 0, y: 50, z: 0 }),
        riser('near-on-plan', { x: 0, y: 9999, z: 900 }),
      ],
      10,
    )

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      fixtureExpressId: 1,
      riserId: 'near-on-plan',
      length: 100,
      drop: 2,
      compliant: true,
    })
  })
})
