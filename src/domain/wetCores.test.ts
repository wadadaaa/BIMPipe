import { describe, expect, it } from 'vitest'
import { buildContinuityMap, type ContinuityMap } from './continuityMap'
import type { Fixture, FixtureKind } from './types'
import {
  WET_CORE_LINK_DISTANCE_M,
  WET_CORE_LINK_DISTANCE_MM,
  WET_CORE_WALL_CLEARANCE_M,
  chooseWallSideEdge,
  clusterWetCores,
  placeWetCoreStack,
  type WetCore,
} from './wetCores'

function fixture(
  expressId: number,
  kind: FixtureKind,
  x: number,
  z: number,
  storeyId = 2,
  y = 6,
): Fixture {
  return { expressId, name: `F-${expressId}`, kind, storeyId, position: { x, y, z } }
}

describe('clusterWetCores', () => {
  it('uses the 2.6 m mm/m constant pair', () => {
    expect(WET_CORE_LINK_DISTANCE_MM).toBe(2600)
    expect(WET_CORE_LINK_DISTANCE_M).toBe(2.6)
  })

  it('groups every fixture kind within the link distance into one core and reports its shape', () => {
    const { cores, skippedFixtureExpressIds } = clusterWetCores(
      [
        fixture(3, 'WASHHANDBASIN', 1.0, 0.0),
        fixture(1, 'TOILETPAN', 0.0, 0.0),
        fixture(2, 'TOILETPAN', 0.8, 0.0),
        fixture(4, 'URINAL', 1.0, 2.0),
        { ...fixture(9, 'SINK', 0, 0), position: null },
      ],
      { units: 'm' },
    )

    expect(skippedFixtureExpressIds).toEqual([9])
    expect(cores).toHaveLength(1)
    const [core] = cores
    expect(core.id).toBe('wet-core:2:1+2+3+4')
    expect(core.memberExpressIds).toEqual([1, 2, 3, 4])
    expect(core.kindsFingerprint).toBe('TOILETPAN+URINAL+WASHHANDBASIN')
    expect(core.kindCounts).toEqual({ TOILETPAN: 2, URINAL: 1, WASHHANDBASIN: 1 })
    expect(core.centroid).toEqual({ x: 0.7, z: 0.5 })
    expect(core.centroidY).toBe(6)
    expect(core.bbox).toEqual({ minX: 0, maxX: 1, minZ: 0, maxZ: 2 })
  })

  it('chains single-linkage: A–B and B–C within range join even when A–C is far apart', () => {
    const { cores } = clusterWetCores(
      [fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'WASHHANDBASIN', 2.5, 0), fixture(3, 'TOILETPAN', 5.0, 0)],
      { units: 'm' },
    )
    expect(cores).toHaveLength(1)
    expect(cores[0].memberExpressIds).toEqual([1, 2, 3])
  })

  it('a 2.7 m gap splits two cores; a 2.6 m gap keeps one', () => {
    const split = clusterWetCores([fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 2.7, 0)], { units: 'm' })
    expect(split.cores.map((core) => core.memberExpressIds)).toEqual([[1], [2]])

    const joined = clusterWetCores([fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 2.6, 0)], { units: 'm' })
    expect(joined.cores.map((core) => core.memberExpressIds)).toEqual([[1, 2]])

    const splitMm = clusterWetCores(
      [fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 2700, 0)],
      { units: 'mm' },
    )
    expect(splitMm.cores).toHaveLength(2)
  })

  it('never links fixtures across storeys and orders cores by storey then dominant axis', () => {
    const { cores } = clusterWetCores(
      [
        fixture(20, 'TOILETPAN', 0, 10, 3),
        fixture(10, 'TOILETPAN', 0, 0, 2),
        fixture(11, 'TOILETPAN', 0, 0.5, 3),
        fixture(12, 'TOILETPAN', 30, 0, 2),
        fixture(13, 'TOILETPAN', 15, 0, 2),
      ],
      { units: 'm' },
    )
    expect(cores.map((core) => [core.storeyId, core.memberExpressIds])).toEqual([
      [2, [10]],
      [2, [13]],
      [2, [12]],
      [3, [11]],
      [3, [20]],
    ])
  })

  it('is deterministic and id-stable regardless of input order', () => {
    const input = [
      fixture(5, 'TOILETPAN', 0, 0),
      fixture(6, 'WASHHANDBASIN', 1, 1),
      fixture(7, 'TOILETPAN', 10, 10),
      fixture(8, 'SINK', 11, 10),
    ]
    const forward = clusterWetCores(input, { units: 'm' })
    const reversed = clusterWetCores([...input].reverse(), { units: 'm' })
    expect(reversed).toEqual(forward)
    expect(forward.cores.map((core) => core.id)).toEqual(['wet-core:2:5+6', 'wet-core:2:7+8'])
    // Adding a fixture to the second core changes only that core's id.
    const grown = clusterWetCores([...input, fixture(9, 'URINAL', 12, 10)], { units: 'm' })
    expect(grown.cores.map((core) => core.id)).toEqual(['wet-core:2:5+6', 'wet-core:2:7+8+9'])
  })

  it('honours an explicit link distance override', () => {
    const { cores } = clusterWetCores(
      [fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 1.0, 0)],
      { units: 'm', linkDistance: 0.5 },
    )
    expect(cores).toHaveLength(2)
  })
})

/**
 * Storey 2 grid: a 6 × 6 m plan with a wall along x ∈ [2.9, 3.1] (a 0.2 m thick
 * wall crossing the plan), a slab covering everything, and a 0.5 × 0.5 m slab
 * opening at (4.75, 1.25) → the only shaft candidate.
 */
function buildTestMap(overrides?: { opening?: boolean; slab?: boolean }): ContinuityMap {
  const opening = overrides?.opening ?? true
  const slab = overrides?.slab ?? false
  return buildContinuityMap({
    units: 'm',
    storeys: [
      {
        storeyId: 2,
        storeyName: 'L2',
        elevation: 6,
        obstructions: [
          { id: 'wall:1', kind: 'wall', footprint: { shape: 'bbox', bounds: { minX: 2.9, maxX: 3.1, minZ: 0, maxZ: 6 } } },
          ...(slab
            ? [{ id: 'slab:1', kind: 'slab' as const, footprint: { shape: 'bbox' as const, bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 6 } } }]
            : []),
          { id: 'column:1', kind: 'column', footprint: { shape: 'bbox', bounds: { minX: 0, maxX: 6, minZ: 5.5, maxZ: 6 } } },
        ],
        voids: opening
          ? [{ id: 'opening:1', kind: 'slab-opening', footprint: { shape: 'bbox', bounds: { minX: 4.5, maxX: 5.0, minZ: 1.0, maxZ: 1.5 } } }]
          : [],
        spaces: [],
      },
    ],
  })
}

function coreOf(fixtures: Fixture[]): WetCore {
  const { cores } = clusterWetCores(fixtures, { units: 'm' })
  expect(cores).toHaveLength(1)
  return cores[0]
}

describe('placeWetCoreStack', () => {
  const floorPlanBounds = { minX: 0, maxX: 6, minZ: 0, maxZ: 6 }

  it('(a) snaps to the nearest shaft candidate within the snap distance of the centroid', () => {
    const core = coreOf([fixture(1, 'TOILETPAN', 4.0, 1.0), fixture(2, 'WASHHANDBASIN', 4.0, 1.5)])
    const placement = placeWetCoreStack(core, { units: 'm', continuityMap: buildTestMap(), maxSnap: 1.5 })
    expect(placement.rule).toBe('shaft')
    if (placement.rule !== 'shaft') throw new Error('unreachable')
    expect(placement.shaftId).toBe('slab-opening:2:opening:1')
    expect(placement.position).toEqual({ x: 4.75, z: 1.25 })
    expect(placement.distance).toBeCloseTo(0.75, 9)
    expect(placement.flagged).toBe(false)
  })

  it('(b) falls back to the nearest free cell when no shaft candidate is in range, never a wall cell', () => {
    // Centroid exactly on the wall (x = 3.0); the opening is 1.9 m away, beyond 1.5 m.
    const core = coreOf([fixture(1, 'TOILETPAN', 3.0, 1.0), fixture(2, 'TOILETPAN', 3.0, 1.5)])
    const map = buildTestMap()
    const placement = placeWetCoreStack(core, { units: 'm', continuityMap: map, maxSnap: 1.5 })
    expect(placement.rule).toBe('free-cell')
    if (placement.rule !== 'free-cell') throw new Error('unreachable')
    const grid = map.grids[0]
    expect(grid.blocked[placement.cell.row * grid.columns + placement.cell.col]).toBe(0)
    // Not inside the wall band.
    expect(placement.position.x < 2.9 || placement.position.x > 3.1).toBe(true)
    expect(placement.distance).toBeLessThanOrEqual(1.5)
    expect(placement.flagged).toBe(false)
  })

  it('(a) skips a shaft candidate whose footprint is fully obstructed and uses a free cell inside it otherwise', () => {
    // Candidate centre cell blocked by a wall crossing the opening; a free cell remains inside the opening.
    const map = buildContinuityMap({
      units: 'm',
      storeys: [
        {
          storeyId: 2,
          storeyName: 'L2',
          elevation: 6,
          obstructions: [
            { id: 'wall:1', kind: 'wall', footprint: { shape: 'bbox', bounds: { minX: 4.6, maxX: 4.9, minZ: 0, maxZ: 6 } } },
          ],
          voids: [
            { id: 'opening:1', kind: 'slab-opening', footprint: { shape: 'bbox', bounds: { minX: 4.0, maxX: 5.5, minZ: 1.0, maxZ: 1.5 } } },
          ],
          spaces: [],
        },
      ],
    })
    const core = coreOf([fixture(1, 'TOILETPAN', 4.5, 1.0)])
    const placement = placeWetCoreStack(core, { units: 'm', continuityMap: map, maxSnap: 1.5 })
    expect(placement.rule).toBe('shaft')
    if (placement.rule !== 'shaft') throw new Error('unreachable')
    expect(placement.reason).toContain('nearest free cell inside the shaft')
    expect(placement.position.x).toBeLessThan(4.6)
    expect(placement.position.x).toBeGreaterThanOrEqual(4.0)
  })

  it('(d) flags the centroid fallback when everything within range is obstructed', () => {
    // Solid slab everywhere, no opening → every cell is blocked (the grid's free
    // padding ring lies more than 1.5 m from a centroid in the plan middle).
    const core = coreOf([fixture(1, 'TOILETPAN', 3.0, 3.0)])
    const placement = placeWetCoreStack(core, {
      units: 'm',
      continuityMap: buildTestMap({ opening: false, slab: true }),
      maxSnap: 1.5,
    })
    expect(placement.rule).toBe('centroid')
    expect(placement.flagged).toBe(true)
    expect(placement.reason).toMatch(/obstructed/)
    expect(placement.position).toEqual({ x: 3, z: 3 })
  })

  it('(c) without a map uses the bbox edge farthest from the plan centre, offset by the clearance', () => {
    // Core in the north-west corner: farthest edge from the plan centre (3, 3) is minZ (z = 0.5 → 2.5 away)
    // versus minX (x = 1.0 → 2.0 away).
    const core = coreOf([fixture(1, 'TOILETPAN', 1.0, 0.5), fixture(2, 'WASHHANDBASIN', 1.5, 1.0)])
    const placement = placeWetCoreStack(core, { units: 'm', maxSnap: 1.5, floorPlanBounds })
    expect(placement.rule).toBe('wall-side-edge')
    if (placement.rule !== 'wall-side-edge') throw new Error('unreachable')
    expect(placement.edge).toBe('minZ')
    expect(placement.clearance).toBe(WET_CORE_WALL_CLEARANCE_M)
    expect(placement.position.x).toBeCloseTo(1.25, 9)
    expect(placement.position.z).toBeCloseTo(0.35, 9)
    expect(placement.flagged).toBe(false)
    expect(placement.reason).toContain('no continuity map loaded')
  })

  it('(c) also applies when the map has no grid for the storey, and clamps to the plan bounds', () => {
    const map = buildTestMap()
    const core = coreOf([fixture(1, 'TOILETPAN', 0.05, 3.0, 7)])
    const placement = placeWetCoreStack(core, { units: 'm', continuityMap: map, maxSnap: 1.5, floorPlanBounds })
    expect(placement.rule).toBe('wall-side-edge')
    if (placement.rule !== 'wall-side-edge') throw new Error('unreachable')
    expect(placement.edge).toBe('minX')
    expect(placement.position.x).toBe(0) // clamped: 0.05 - 0.15 < minX
    expect(placement.reason).toContain('no grid or shaft candidate for storey 7')
  })

  it('ignores a map in other units and says so', () => {
    const mmMap: ContinuityMap = { ...buildTestMap(), units: 'mm' }
    const core = coreOf([fixture(1, 'TOILETPAN', 1.0, 1.0)])
    const placement = placeWetCoreStack(core, { units: 'm', continuityMap: mmMap, maxSnap: 1.5, floorPlanBounds })
    expect(placement.rule).toBe('wall-side-edge')
    expect(placement.reason).toContain('differ from plan units')
  })

  it('without a map or plan bounds keeps the centroid and explains, unflagged', () => {
    const core = coreOf([fixture(1, 'TOILETPAN', 1.0, 1.0)])
    const placement = placeWetCoreStack(core, { units: 'm', maxSnap: 1.5 })
    expect(placement).toEqual({
      rule: 'centroid',
      position: { x: 1, z: 1 },
      flagged: false,
      reason: 'no continuity map loaded and no storey plan bounds; stack left at the core centroid',
    })
  })

  it('chooseWallSideEdge resolves ties in the documented order', () => {
    // Core centred in the plan: every edge is equally far → minX wins.
    expect(chooseWallSideEdge({ minX: 2, maxX: 4, minZ: 2, maxZ: 4 }, floorPlanBounds)).toBe('minX')
    expect(chooseWallSideEdge({ minX: 4, maxX: 5, minZ: 2, maxZ: 3 }, floorPlanBounds)).toBe('maxX')
  })
})
