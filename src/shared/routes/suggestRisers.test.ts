import { describe, expect, it } from 'vitest'
import type { Fixture, FixtureKind, KitchenArea, PlanBounds } from '@/domain/types'
import { buildContinuityMap, type ContinuityMapInput } from '@/domain/continuityMap'
import { RESIDENTIAL_COLLECTOR_MAX_M } from '@/domain/typology'
import { suggestRiserPositions, suggestWetCoreRiserPositions } from './suggestRisers'

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

  it('returns no risers when only non-toilet fixtures exist (they attach to risers instead)', () => {
    // T2: non-toilet fixtures never spawn risers; they are assigned to the nearest
    // riser by src/domain/assignFixturesToRisers.ts.
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0, 50, 1000, 'BATH'),
      fixture(3, 0, 50, 2000, 'WASHHANDBASIN'),
      fixture(4, 0, 50, 3000, 'URINAL'),
      fixture(5, 0, 50, 4000, 'BIDET'),
    ])

    expect(result).toEqual([])
  })

  it('keeps dedicated kitchen risers when only non-toilet fixtures accompany a kitchen', () => {
    const result = suggestRiserPositions(
      [
        fixture(1, 500, 50, 500, 'BATH'),
        fixture(2, 700, 50, 700, 'WASHHANDBASIN'),
      ],
      [kitchen(11, 3000, 50, 3000)],
      { minX: 0, maxX: 10000, minZ: 0, maxZ: 10000 },
    )

    // Only the kitchen corner riser is suggested; the bath and basin add nothing.
    expect(result).toEqual([{ x: 1800, y: 50, z: 1800 }])
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

  it('suggests nothing when no WC and no kitchen exists, even in metre models', () => {
    // T2: the old clustered-centroid fallback is removed; non-toilet fixtures wait
    // for a riser to attach to instead of spawning one.
    const result = suggestRiserPositions([
      fixture(1, 0, 50, 0, 'SINK'),
      fixture(2, 0.4, 50, 0, 'BATH'),
    ])

    expect(result).toEqual([])
  })

  it('does not let kitchen sinks create extra risers when kitchens already drive the count', () => {
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

// --- W5 additions: continuity snapping flag (default OFF) --------------------

const bboxFootprint = (minX: number, maxX: number, minZ: number, maxZ: number) =>
  ({ shape: 'bbox', bounds: { minX, maxX, minZ, maxZ } }) as const

/** Storey 10 (matching the fixture helper) with two perimeter walls. */
function continuityInputMm(
  extra: Partial<ContinuityMapInput['storeys'][number]> = {},
): ContinuityMapInput {
  return {
    units: 'mm',
    storeys: [
      {
        storeyId: 10,
        storeyName: 'Storey 10',
        elevation: 0,
        obstructions: [
          { id: 'wall:1', kind: 'wall', footprint: bboxFootprint(0, 2000, 0, 250) },
          { id: 'wall:2', kind: 'wall', footprint: bboxFootprint(0, 250, 2000, 2250) },
        ],
        voids: [],
        spaces: [],
        ...extra,
      },
    ],
  }
}

describe('suggestRiserPositions with continuitySnap', () => {
  it('is byte-identical to the default path when the flag is off', () => {
    const fixtures = [
      fixture(1, 0, 50, 0),
      fixture(2, 400, 50, 300),
      fixture(3, 10000, 50, 0, 'BATH'),
    ]
    const kitchens = [kitchen(11, 3000, 50, 3000)]
    const floorPlanBounds: PlanBounds = { minX: 0, maxX: 12000, minZ: 0, maxZ: 12000 }

    const withoutOptions = suggestRiserPositions(fixtures, kitchens, floorPlanBounds)
    const withEmptyOptions = suggestRiserPositions(fixtures, kitchens, floorPlanBounds, null, {})

    expect(withEmptyOptions).toEqual(withoutOptions)
    expect(JSON.stringify(withEmptyOptions)).toBe(JSON.stringify(withoutOptions))
  })

  it('snaps a toilet suggestion to the nearest free grid cell within MAX_SNAP', () => {
    const map = buildContinuityMap(continuityInputMm())
    const result = suggestRiserPositions([fixture(1, 1010, 50, 600)], [], null, null, {
      continuitySnap: { map },
    })

    expect(result).toHaveLength(1)
    expect(result[0].x).toBe(1125)
    expect(result[0].y).toBe(50)
    expect(result[0].z).toBe(625)
    expect(result[0].snap).toMatchObject({
      status: 'snapped',
      target: 'free-cell',
      cell: { col: 5, row: 3 },
      original: { x: 1010, y: 50, z: 600 },
    })
  })

  it('prefers a shaft candidate over a closer free cell', () => {
    const map = buildContinuityMap(
      continuityInputMm({
        spaces: [{ id: 'space:9', name: 'פיר', footprint: bboxFootprint(1500, 1800, 500, 800) }],
      }),
    )
    const result = suggestRiserPositions([fixture(1, 1010, 50, 600)], [], null, null, {
      continuitySnap: { map },
    })

    expect(result).toHaveLength(1)
    expect(result[0].x).toBe(1650)
    expect(result[0].y).toBe(50)
    expect(result[0].z).toBe(650)
    expect(result[0].snap).toMatchObject({
      status: 'snapped',
      target: 'shaft',
      shaftId: 'shaft-space:10:space:9',
    })
  })

  it('keeps the original position and reports snapMiss beyond MAX_SNAP', () => {
    const map = buildContinuityMap(continuityInputMm())
    const result = suggestRiserPositions([fixture(1, 1010, 50, 600)], [], null, null, {
      continuitySnap: { map, maxSnapMm: 50 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].x).toBe(1010)
    expect(result[0].y).toBe(50)
    expect(result[0].z).toBe(600)
    expect(result[0].snap).toEqual({
      status: 'snapMiss',
      reason: 'no shaft candidate or free grid cell within 50 mm on storey 10',
    })
  })

  it('reports snapMiss when the map has no grid for the fixture storey', () => {
    const map = buildContinuityMap({
      units: 'mm',
      storeys: [
        {
          storeyId: 99,
          storeyName: 'Other storey',
          elevation: 0,
          obstructions: [
            { id: 'wall:1', kind: 'wall', footprint: bboxFootprint(0, 2000, 0, 250) },
          ],
          voids: [],
          spaces: [],
        },
      ],
    })
    const result = suggestRiserPositions([fixture(1, 1010, 50, 600)], [], null, null, {
      continuitySnap: { map },
    })

    expect(result[0].snap).toEqual({
      status: 'snapMiss',
      reason: 'no obstruction grid for storey 10',
    })
  })

  it('converts MAX_SNAP to metres for metre-unit maps', () => {
    const map = buildContinuityMap({
      units: 'm',
      storeys: [
        {
          storeyId: 10,
          storeyName: 'Storey 10',
          elevation: 0,
          obstructions: [
            { id: 'wall:1', kind: 'wall', footprint: bboxFootprint(0, 2, 0, 0.25) },
            { id: 'wall:2', kind: 'wall', footprint: bboxFootprint(0, 0.25, 2, 2.25) },
          ],
          voids: [],
          spaces: [],
        },
      ],
    })
    const result = suggestRiserPositions([fixture(1, 1.01, 50, 0.6)], [], null, null, {
      continuitySnap: { map },
    })

    expect(result).toHaveLength(1)
    expect(result[0].x).toBeCloseTo(1.125, 6)
    expect(result[0].z).toBeCloseTo(0.625, 6)
    expect(result[0].snap).toMatchObject({ status: 'snapped', target: 'free-cell' })
  })

  it('keeps ordering identical to the default path when snapping misses', () => {
    const fixtures = [fixture(1, 400, 50, 300), fixture(2, 0, 50, 0)]
    const map = buildContinuityMap(continuityInputMm())

    const defaults = suggestRiserPositions(fixtures)
    const snapped = suggestRiserPositions(fixtures, [], null, null, {
      continuitySnap: { map, maxSnapMm: 1 },
    })

    expect(snapped.map(({ x, y, z }) => ({ x, y, z }))).toEqual(
      defaults.map(({ x, y, z }) => ({ x, y, z })),
    )
    expect(snapped.every((entry) => entry.snap?.status === 'snapMiss')).toBe(true)
  })
})

describe('suggestWetCoreRiserPositions with core collectors (R1)', () => {
  // One storey (id 10) on a solid slab 0..16 × 0..6 m with a single 0.5 m slab
  // opening at (1..1.5, 1..1.5). Core A next to the opening snaps to it (shaft);
  // core B in the middle of the slab has every cell within 1.5 m blocked and
  // core C sits 11.5 m (Manhattan) from A's stack — beyond the 8 m residential
  // collector limit.
  const map = buildContinuityMap({
    units: 'm',
    storeys: [
      {
        storeyId: 10,
        storeyName: 'L1',
        elevation: 3,
        obstructions: [{ id: 'slab:1', kind: 'slab', footprint: { shape: 'bbox', bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 6 } } }],
        voids: [{ id: 'opening:1', kind: 'slab-opening', footprint: { shape: 'bbox', bounds: { minX: 1.0, maxX: 1.5, minZ: 1.0, maxZ: 1.5 } } }],
        spaces: [],
      },
    ],
  })
  const coreA = [fixture(1, 1.2, 3, 2.2), fixture(2, 1.8, 3, 2.2, 'WASHHANDBASIN')]
  const coreB = [fixture(5, 6.0, 3, 3.0), fixture(6, 6.6, 3, 3.0, 'WASHHANDBASIN')]
  const coreC = [fixture(9, 11.0, 3, 3.0)]
  const bounds: PlanBounds = { minX: 0, maxX: 16, minZ: 0, maxZ: 6 }

  it('gathers the obstructed core into the neighbour with a valid stack and keeps the unreachable one flagged', () => {
    const result = suggestWetCoreRiserPositions([...coreA, ...coreB, ...coreC], [], bounds, null, {
      planUnits: 'm',
      continuityMap: map,
    })
    expect(result.typology).toBe('residential')
    expect(result.cores.map((core) => core.memberExpressIds)).toEqual([[1, 2], [5, 6], [9]])

    // A: shaft. B: no stack (gathered). C: flagged centroid, still visible.
    const stacks = result.positions.filter((position) => position.anchor === 'wet-core')
    expect(stacks.map((stack) => [stack.core.memberExpressIds.join('+'), stack.placement.rule, stack.placement.flagged])).toEqual([
      ['1+2', 'shaft', false],
      ['9', 'centroid', true],
    ])

    const [collector] = result.coreCollectors
    expect(result.coreCollectors).toHaveLength(1)
    expect(collector).toMatchObject({
      storeyId: 10,
      memberExpressIds: [5, 6],
      targetCoreId: result.cores[0].id,
      junction: { x: 6.3, z: 3 },
      targetStackPosition: { x: 1.25, z: 1.25 },
      units: 'm',
    })
    expect(collector.lengthManhattan).toBeCloseTo(6.8, 9)
    expect(collector.lengthManhattan).toBeLessThanOrEqual(RESIDENTIAL_COLLECTOR_MAX_M)

    // Both decisions are explained in the diagnostics.
    expect(result.diagnostics.some((line) => line.includes(`core ${result.cores[1].id}: every cell within snap range`))).toBe(true)
    expect(result.diagnostics.some((line) => line.includes(`core ${result.cores[2].id}: nearest core with a valid stack`) && line.includes('beyond the 8.00 m collector limit'))).toBe(true)
  })

  it('does not engage without an obstruction grid (the wall-side-edge rule keeps one stack per core, no collectors)', () => {
    const result = suggestWetCoreRiserPositions([...coreA, ...coreB, ...coreC], [], bounds, null, { planUnits: 'm', continuityMap: null })
    expect(result.coreCollectors).toEqual([])
    const stacks = result.positions.filter((position) => position.anchor === 'wet-core')
    expect(stacks).toHaveLength(3)
    expect(stacks.every((stack) => stack.placement.rule === 'wall-side-edge')).toBe(true)
  })

  it('is deterministic regardless of fixture input order', () => {
    const forward = suggestWetCoreRiserPositions([...coreA, ...coreB, ...coreC], [], bounds, null, { planUnits: 'm', continuityMap: map })
    const shuffled = suggestWetCoreRiserPositions([coreC[0], coreB[1], coreA[0], coreB[0], coreA[1]], [], bounds, null, {
      planUnits: 'm',
      continuityMap: map,
    })
    expect(shuffled.coreCollectors).toEqual(forward.coreCollectors)
    expect(shuffled.positions.map(({ x, y, z }) => ({ x, y, z }))).toEqual(forward.positions.map(({ x, y, z }) => ({ x, y, z })))
  })
})
