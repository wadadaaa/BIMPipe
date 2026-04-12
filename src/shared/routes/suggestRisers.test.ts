import { describe, expect, it } from 'vitest'
import type { Fixture, FixtureKind, KitchenArea, PlanBounds } from '@/domain/types'
import { suggestRiserPositions } from './suggestRisers'

function fixture(
  expressId: number,
  x: number,
  y: number,
  z: number,
  kind: FixtureKind = 'TOILETPAN',
): Fixture {
  return {
    expressId,
    name: `Fixture ${expressId}`,
    kind,
    storeyId: 10,
    position: { x, y, z },
  }
}

function kitchen(
  expressId: number,
  x: number,
  y: number,
  z: number,
  planBounds?: PlanBounds,
  planCorners?: KitchenArea['planCorners'],
): KitchenArea {
  return {
    expressId,
    name: `Kitchen ${expressId}`,
    storeyId: 10,
    position: { x, y, z },
    ...(planBounds ? { planBounds } : {}),
    ...(planCorners ? { planCorners } : {}),
  }
}

describe('suggestRiserPositions', () => {
  it('returns no suggestions when fixtures have no positions', () => {
    expect(
      suggestRiserPositions([
        { ...fixture(1, 0, 0, 0), position: null },
      ]),
    ).toEqual([])
  })

  it('returns one dedicated riser per toilet when WCs exist', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0),
      fixture(2, 400, 50, 300),
      fixture(3, 10000, 50, 0, 'BATH'),
      fixture(4, 10300, 50, 300, 'SINK'),
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ x: 0, y: 50, z: 0 })
    expect(result[1]).toMatchObject({ x: 400, y: 50, z: 300 })
  })

  it('adds one dedicated riser per kitchen at the outward corner', () => {
    const result = suggestRiserPositions(
      [],
      [
        kitchen(
          1,
          3000,
          50,
          3000,
          { minX: 1000, maxX: 5000, minZ: 1000, maxZ: 5000 },
          [
            { x: 1200, z: 1800 },
            { x: 3800, z: 1200 },
            { x: 4400, z: 3800 },
            { x: 1800, z: 4400 },
          ],
        ),
        kitchen(
          2,
          9000,
          50,
          9000,
          { minX: 7000, maxX: 11000, minZ: 7000, maxZ: 11000 },
          [
            { x: 7600, z: 8200 },
            { x: 10200, z: 7600 },
            { x: 10800, z: 10200 },
            { x: 8200, z: 10800 },
          ],
        ),
      ],
      { minX: 0, maxX: 12000, minZ: 0, maxZ: 12000 },
    )

    expect(result).toHaveLength(2)
    expect(result[0].x).toBeLessThan(1500)
    expect(result[0].z).toBeLessThan(2100)
    expect(result[0].y).toBe(50)
    expect(result[1].x).toBeGreaterThan(10500)
    expect(result[1].z).toBeGreaterThan(10000)
    expect(result[1].y).toBe(50)
  })

  it('does not split a wet core just because fixture Y values differ when no WC exists', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0.2, 9999, 0.2, 'BATH'),
    ])

    expect(result).toHaveLength(1)
  })

  it('splits fixtures that are distant on Z even when Y is the same when no WC exists', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0, 50, 10000, 'BATH'),
    ])

    expect(result).toHaveLength(2)
  })

  it('does not merge a long chain of nearby fixtures into one riser when no WC exists', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0, 50, 1000, 'BATH'),
      fixture(3, 0, 50, 2000, 'BATH'),
      fixture(4, 0, 50, 3000, 'WASHHANDBASIN'),
      fixture(5, 0, 50, 4000, 'URINAL'),
    ])

    expect(result.length).toBeGreaterThan(1)
  })

  it('uses roughly four fixtures per riser when one non-WC cluster is too dense', () => {
    const result = suggestRiserPositions([
      fixture(1, 10000, 50, 0, 'SINK'),
      fixture(2, 10100, 50, 0, 'BATH'),
      fixture(3, 10200, 50, 0, 'BATH'),
      fixture(4, 10300, 50, 0, 'WASHHANDBASIN'),
      fixture(5, 10400, 50, 0, 'URINAL'),
      fixture(6, 10500, 50, 0, 'SINK'),
      fixture(7, 10600, 50, 0, 'BIDET'),
      fixture(8, 10700, 50, 0, 'BATH'),
    ])

    expect(result).toHaveLength(2)
  })

  it('ignores non-toilet fixtures when toilets exist', () => {
    const result = suggestRiserPositions([
      fixture(1, 10000, 50, 0),
      fixture(2, 12000, 50, 0, 'WASHHANDBASIN'),
      fixture(3, 12500, 50, 0, 'BATH'),
      fixture(4, 13000, 50, 0, 'SINK'),
    ])

    expect(result).toEqual([{ x: 10000, y: 50, z: 0 }])
  })

  it('keeps kitchen risers alongside dedicated toilet risers', () => {
    const result = suggestRiserPositions(
      [
        fixture(1, 1000, 50, 1000),
        fixture(2, 3000, 50, 3000, 'SINK'),
      ],
      [kitchen(
        11,
        3200,
        50,
        3200,
        { minX: 3000, maxX: 3400, minZ: 3000, maxZ: 3400 },
        [
          { x: 2920, z: 3060 },
          { x: 3340, z: 2920 },
          { x: 3480, z: 3340 },
          { x: 3060, z: 3480 },
        ],
      )],
      { minX: 0, maxX: 5000, minZ: 0, maxZ: 5000 },
    )

    expect(result).toEqual([
      { x: 1000, y: 50, z: 1000 },
      { x: 4400, y: 50, z: 4400 },
    ])
  })

  it('creates two risers for two nearby toilets instead of sharing one', () => {
    const wcA = fixture(1, 0, 50, 0)
    const wcB = fixture(2, 350, 50, 0)
    const result = suggestRiserPositions([
      wcA,
      wcB,
      fixture(3, 2200, 50, 0, 'BATH'),
    ])

    expect(result).toHaveLength(2)
    expect(result).toEqual([
      { x: 0, y: 50, z: 0 },
      { x: 350, y: 50, z: 0 },
    ])
  })

  it('keeps one riser per toilet in metre models', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0),
      fixture(2, 0.4, 50, 0),
      fixture(3, 2, 50, 0, 'WASHHANDBASIN'),
      fixture(4, 2.5, 50, 0, 'BATH'),
      fixture(5, 3, 50, 0, 'SINK'),
    ])

    expect(result).toEqual([
      { x: 0, y: 50, z: 0 },
      { x: 0.4, y: 50, z: 0 },
    ])
  })

  it('falls back to clustered centroids when no WC exists in the fixture set', () => {
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0.4, 50, 0, 'BATH'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ x: 0.2, y: 50, z: 0 })
  })

  it('does not let kitchen sinks create extra clustered risers when kitchens already drive the count', () => {
    const result = suggestRiserPositions(
      [
        { ...fixture(1, 205, 50, 205, 'SINK'), isKitchenSink: true },
        { ...fixture(2, 215, 50, 215, 'SINK'), isKitchenSink: true },
      ],
      [kitchen(
        1,
        3000,
        50,
        3000,
        { minX: 1000, maxX: 5000, minZ: 1000, maxZ: 5000 },
        [
          { x: 1200, z: 1800 },
          { x: 3800, z: 1200 },
          { x: 4400, z: 3800 },
          { x: 1800, z: 4400 },
        ],
      )],
      { minX: 0, maxX: 10000, minZ: 0, maxZ: 10000 },
    )

    expect(result).toHaveLength(1)
    expect(result[0].x).toBeLessThan(1500)
    expect(result[0].z).toBeLessThan(2100)
    expect(result[0].y).toBe(50)
  })

  it('falls back to an outward corner shift when kitchen plan bounds are unavailable', () => {
    const result = suggestRiserPositions(
      [],
      [kitchen(1, 3000, 50, 3000)],
      { minX: 0, maxX: 10000, minZ: 0, maxZ: 10000 },
    )

    expect(result).toEqual([{ x: 1800, y: 50, z: 1800 }])
  })
})
