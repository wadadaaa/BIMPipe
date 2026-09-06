import { describe, expect, it } from 'vitest'
import { buildContinuityMap, selectOfficeCoreShafts, type ContinuityMap } from './continuityMap'
import { TYPOLOGY_PLACEMENT_RULES } from './typology'
import type { Fixture, FixtureKind } from './types'
import {
  WET_CORE_LINK_DISTANCE_M,
  WET_CORE_LINK_DISTANCE_MM,
  WET_CORE_WALL_CLEARANCE_M,
  chooseWallSideEdge,
  clusterWetCores,
  detectFixtureRows,
  placeWetCoreStack,
  snapWindowIntersectsGrid,
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

  it('(d→c, R1) a core whose snap window misses the grid entirely is NOT obstructed: wall-side-edge, unflagged', () => {
    // The test grid covers roughly [0, 6] × [0, 6] (plus padding). A core at
    // x = 20 with a 1.5 m window never touches it — the grid says nothing about
    // that part of the plan, so it must not be reported as "everything blocked".
    const map = buildTestMap({ opening: false, slab: true })
    const grid = map.grids[0]
    const farCore = coreOf([fixture(1, 'TOILETPAN', 20.0, 3.0)])
    expect(snapWindowIntersectsGrid(grid, farCore.bbox, 1.5)).toBe(false)
    const placement = placeWetCoreStack(farCore, {
      units: 'm',
      continuityMap: map,
      maxSnap: 1.5,
      floorPlanBounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 6 },
    })
    expect(placement.rule).toBe('wall-side-edge')
    expect(placement.flagged).toBe(false)
    expect(placement.reason).toContain('obstruction grid does not cover the core or anything within 1.50 m of it')

    // A core 1 m past the grid edge still has its window ON the grid, so the
    // grid is consulted (here it finds a free padding cell); and the core in
    // the middle of the solid slab keeps the genuine obstructed flag (test d).
    const gridMaxX = grid.origin.x + grid.columns * grid.cellSize
    const nearCore = coreOf([fixture(2, 'TOILETPAN', gridMaxX + 1.0, 3.0)])
    expect(snapWindowIntersectsGrid(grid, nearCore.bbox, 1.5)).toBe(true)
    const nearPlacement = placeWetCoreStack(nearCore, {
      units: 'm',
      continuityMap: map,
      maxSnap: 1.5,
      floorPlanBounds: { minX: 0, maxX: 24, minZ: 0, maxZ: 6 },
    })
    expect(nearPlacement.rule).toBe('free-cell')
    const middleCore = coreOf([fixture(3, 'TOILETPAN', 3.0, 3.0)])
    expect(snapWindowIntersectsGrid(grid, middleCore.bbox, 1.5)).toBe(true)
    expect(placeWetCoreStack(middleCore, { units: 'm', continuityMap: map, maxSnap: 1.5 })).toMatchObject({ rule: 'centroid', flagged: true })

    // Without plan bounds the far core keeps an unflagged centroid with the same explanation.
    const noBounds = placeWetCoreStack(farCore, { units: 'm', continuityMap: map, maxSnap: 1.5 })
    expect(noBounds).toMatchObject({ rule: 'centroid', flagged: false, position: { x: 20, z: 3 } })
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

// ---------------------------------------------------------------------------
// Office typology (G3)
// ---------------------------------------------------------------------------

/**
 * Synthetic office floor (metres, storey 2): 30 × 20 m slab, a dense core
 * (lift box + stair enclosure + service walls) at x 12–18 / z 6–14 with a
 * 2.5 × 5 m stair void, one core shaft opening (0.6 × 1.0 m at x 11–11.6) and
 * one shaft-sized opening far away at the facade (x 2–2.8, z 1–1.8).
 */
function buildOfficeMap(): ContinuityMap {
  const bbox = (minX: number, maxX: number, minZ: number, maxZ: number) =>
    ({ shape: 'bbox', bounds: { minX, maxX, minZ, maxZ } }) as const
  return buildContinuityMap({
    units: 'm',
    storeys: [
      {
        storeyId: 2,
        storeyName: 'L2',
        elevation: 6,
        obstructions: [
          { id: 'slab:1', kind: 'slab', footprint: bbox(0, 30, 0, 20) },
          { id: 'wall:facade', kind: 'wall', footprint: bbox(0, 30, 0, 0.25) },
          { id: 'wall:c1', kind: 'wall', footprint: bbox(12, 15, 6, 6.3) },
          { id: 'wall:c2', kind: 'wall', footprint: bbox(12, 15, 8.7, 9) },
          { id: 'wall:c3', kind: 'wall', footprint: bbox(12, 12.3, 6, 14) },
          { id: 'wall:c4', kind: 'wall', footprint: bbox(14.7, 15, 6, 14) },
          { id: 'wall:c5', kind: 'wall', footprint: bbox(15, 18, 6, 6.3) },
          { id: 'wall:c6', kind: 'wall', footprint: bbox(15, 18, 13.7, 14) },
          { id: 'wall:c7', kind: 'wall', footprint: bbox(17.7, 18, 6, 14) },
          { id: 'wall:c8', kind: 'wall', footprint: bbox(12, 18, 10.5, 10.8) },
          { id: 'wall:c9', kind: 'wall', footprint: bbox(12, 18, 12.2, 12.5) },
        ],
        voids: [
          { id: 'opening:stair', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(15.3, 17.8, 6.5, 11.5) },
          { id: 'opening:core-shaft', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(11, 11.6, 7, 8) },
          { id: 'opening:far', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(2, 2.8, 1, 1.8) },
        ],
        spaces: [],
      },
    ],
  })
}

describe('placeWetCoreStack — office typology', () => {
  const officeBounds = { minX: 0, maxX: 30, minZ: 0, maxZ: 20 }

  it('snaps to the nearest CORE shaft within the office snap distance and cites the core reason', () => {
    // A WC row 3–5 m west of the core shaft: outside the residential 1.5 m, inside the office 6 m.
    const core = coreOf([
      fixture(1, 'TOILETPAN', 6.0, 7.5),
      fixture(2, 'TOILETPAN', 6.9, 7.5),
      fixture(3, 'TOILETPAN', 7.8, 7.5),
    ])
    const placement = placeWetCoreStack(core, {
      units: 'm',
      continuityMap: buildOfficeMap(),
      maxSnap: 6,
      floorPlanBounds: officeBounds,
      typology: 'office',
    })
    expect(placement.rule).toBe('shaft')
    if (placement.rule !== 'shaft') throw new Error('unreachable')
    expect(placement.shaftId).toBe('slab-opening:2:opening:core-shaft')
    expect(placement.distance).toBeCloseTo(11.3 - 7.8, 6)
    expect(placement.reason).toMatch(/^office: snapped to shaft candidate/)
    expect(placement.reason).toContain('core shaft')
  })

  it('never takes a non-core shaft or a free cell: a core next to the facade opening is flagged', () => {
    const core = coreOf([fixture(1, 'TOILETPAN', 3.5, 1.5), fixture(2, 'TOILETPAN', 4.3, 1.5), fixture(3, 'TOILETPAN', 5.1, 1.5)])
    const residential = placeWetCoreStack(core, { units: 'm', continuityMap: buildOfficeMap(), maxSnap: 1.5, floorPlanBounds: officeBounds })
    expect(residential.rule).toBe('shaft') // the facade opening is a fine residential target
    const office = placeWetCoreStack(core, {
      units: 'm',
      continuityMap: buildOfficeMap(),
      maxSnap: 6,
      floorPlanBounds: officeBounds,
      typology: 'office',
    })
    expect(office.rule).toBe('centroid')
    expect(office.flagged).toBe(true)
    expect(office.position).toEqual({ ...core.centroid })
    expect(office.reason).toContain('no core shaft within 6 m')
    expect(office.reason).toContain('1 core shaft(s) on the storey')
    expect(office.reason).toContain('outside the core')
  })

  it('flags (never wall-side guesses) when no continuity map is loaded', () => {
    const core = coreOf([fixture(1, 'TOILETPAN', 3.5, 1.5)])
    const residential = placeWetCoreStack(core, { units: 'm', maxSnap: 1.5, floorPlanBounds: officeBounds })
    expect(residential.rule).toBe('wall-side-edge')
    const office = placeWetCoreStack(core, { units: 'm', maxSnap: 6, floorPlanBounds: officeBounds, typology: 'office' })
    expect(office).toEqual({
      rule: 'centroid',
      position: { x: 3.5, z: 1.5 },
      flagged: true,
      reason: 'office typology places stacks on core shafts only, but no continuity map is loaded; stack left at the core centroid',
    })
  })

  it('reuses a precomputed selection and stays deterministic', () => {
    const map = buildOfficeMap()
    const selection = selectOfficeCoreShafts(map, 2, TYPOLOGY_PLACEMENT_RULES.office.coreShafts!)
    const core = coreOf([fixture(1, 'TOILETPAN', 8, 7.5), fixture(2, 'TOILETPAN', 8.9, 7.5)])
    const a = placeWetCoreStack(core, { units: 'm', continuityMap: map, maxSnap: 6, typology: 'office', officeCoreShafts: selection })
    const b = placeWetCoreStack(core, { units: 'm', continuityMap: map, maxSnap: 6, typology: 'office' })
    expect(a).toEqual(b)
    expect(a.rule).toBe('shaft')
  })

  it('residential default is untouched when typology is omitted or explicit', () => {
    const core = coreOf([fixture(1, 'TOILETPAN', 4.0, 1.0), fixture(2, 'WASHHANDBASIN', 4.0, 1.5)])
    const implicit = placeWetCoreStack(core, { units: 'm', continuityMap: buildTestMap(), maxSnap: 1.5 })
    const explicit = placeWetCoreStack(core, { units: 'm', continuityMap: buildTestMap(), maxSnap: 1.5, typology: 'residential' })
    expect(explicit).toEqual(implicit)
  })
})

describe('detectFixtureRows', () => {
  const rowCore = () =>
    coreOf([
      fixture(1, 'TOILETPAN', 6.0, 7.5),
      fixture(2, 'TOILETPAN', 6.9, 7.52),
      fixture(3, 'TOILETPAN', 7.8, 7.48),
      fixture(4, 'TOILETPAN', 8.7, 7.5),
      fixture(5, 'WASHHANDBASIN', 6.2, 9.4),
      fixture(6, 'WASHHANDBASIN', 7.0, 9.4),
      fixture(7, 'WASHHANDBASIN', 7.8, 9.4),
      fixture(8, 'URINAL', 9.5, 8.5),
    ])

  it('finds same-kind rows along x, orders members along the row and puts the collector behind the row', () => {
    const rows = detectFixtureRows(rowCore(), { units: 'm', floorPlanBounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 20 } })
    expect(rows.map((row) => [row.kind, row.axis, row.memberExpressIds])).toEqual([
      ['TOILETPAN', 'x', [1, 2, 3, 4]],
      ['WASHHANDBASIN', 'x', [5, 6, 7]],
    ])
    const [wcRow, basinRow] = rows
    expect(wcRow.lineCoord).toBeCloseTo(7.5, 6)
    expect(wcRow.alongMin).toBe(6)
    expect(wcRow.alongMax).toBe(8.7)
    expect(wcRow.maxSpacing).toBeCloseTo(0.9, 6)
    // No grid: side away from the plan centre (z 10) → the WC row at z 7.5 goes −z.
    expect(wcRow.side).toBe(-1)
    expect(wcRow.sideReason).toBe('plan-centre')
    expect(wcRow.collectorLineCoord).toBeCloseTo(7.2, 6)
    expect(basinRow.side).toBe(-1)
    expect(wcRow.id).toBe(`row:${wcRow.coreId}:TOILETPAN:x:0`)
    expect(wcRow.reason).toContain('4 TOILETPAN in a row along x')
  })

  it('uses the wall side when the continuity grid has a wall behind one bbox edge', () => {
    // Wall along z = 6.9–7.1 just north of the WC row (core bbox minZ = 7.5).
    const map = buildContinuityMap({
      units: 'm',
      storeys: [
        {
          storeyId: 2,
          storeyName: 'L2',
          elevation: 6,
          obstructions: [
            // Slab so the grid covers the whole plan (as real models do); walls decide the side.
            { id: 'slab:1', kind: 'slab', footprint: { shape: 'bbox', bounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 10 } } },
            { id: 'wall:n', kind: 'wall', footprint: { shape: 'bbox', bounds: { minX: 5, maxX: 10, minZ: 6.9, maxZ: 7.1 } } },
          ],
          voids: [],
          spaces: [],
        },
      ],
    })
    // Plan centre would say +z for a row at z 9.4 (centre 5) — the wall decides instead for the WC row.
    const rows = detectFixtureRows(rowCore(), { units: 'm', continuityMap: map, floorPlanBounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 10 } })
    const wcRow = rows.find((row) => row.kind === 'TOILETPAN')!
    expect(wcRow.side).toBe(-1)
    expect(wcRow.sideReason).toBe('wall-cell')
    expect(wcRow.reason).toContain('minZ edge')
    // The basin row (z 9.4) is 2.3 m from that wall (beyond the 1.5 m search) → plan-centre fallback, +z.
    const basinRow = rows.find((row) => row.kind === 'WASHHANDBASIN')!
    expect(basinRow.sideReason).toBe('plan-centre')
    expect(basinRow.side).toBe(1)
  })

  it('splits at gaps wider than the max spacing, drops short runs and detects z-rows', () => {
    const core = coreOf([
      fixture(1, 'TOILETPAN', 0, 0),
      fixture(2, 'TOILETPAN', 0, 0.9),
      fixture(3, 'TOILETPAN', 0, 1.8),
      fixture(4, 'TOILETPAN', 0, 4.3), // 2.5 m gap → separate run of one
      fixture(5, 'TOILETPAN', 1.5, 0), // off the line (perpendicular 1.5 m)
    ])
    const rows = detectFixtureRows(core, { units: 'm' })
    expect(rows).toHaveLength(1)
    expect(rows[0].axis).toBe('z')
    expect(rows[0].memberExpressIds).toEqual([1, 2, 3])
    expect(rows[0].sideReason).toBe('core-centroid')
    expect(rows[0].side).toBe(-1) // row at x 0, core centroid x 0.3 → away from it
  })

  it('needs at least three same-kind fixtures and honours mm units', () => {
    expect(detectFixtureRows(coreOf([fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 0.9, 0)]), { units: 'm' })).toEqual([])
    const mixed = coreOf([fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'WASHHANDBASIN', 0.9, 0), fixture(3, 'TOILETPAN', 1.8, 0)])
    expect(detectFixtureRows(mixed, { units: 'm' })).toEqual([])
    const { cores } = clusterWetCores(
      [fixture(1, 'TOILETPAN', 0, 0), fixture(2, 'TOILETPAN', 900, 20), fixture(3, 'TOILETPAN', 1800, -20)],
      { units: 'mm' },
    )
    const rows = detectFixtureRows(cores[0], { units: 'mm' })
    expect(rows).toHaveLength(1)
    expect(rows[0].units).toBe('mm')
    expect(Math.abs(rows[0].collectorLineCoord - rows[0].lineCoord)).toBeCloseTo(300, 6)
  })

  it('is deterministic regardless of member input order', () => {
    const forward = detectFixtureRows(rowCore(), { units: 'm' })
    const reversed = detectFixtureRows(
      coreOf([
        fixture(8, 'URINAL', 9.5, 8.5),
        fixture(7, 'WASHHANDBASIN', 7.8, 9.4),
        fixture(6, 'WASHHANDBASIN', 7.0, 9.4),
        fixture(5, 'WASHHANDBASIN', 6.2, 9.4),
        fixture(4, 'TOILETPAN', 8.7, 7.5),
        fixture(3, 'TOILETPAN', 7.8, 7.48),
        fixture(2, 'TOILETPAN', 6.9, 7.52),
        fixture(1, 'TOILETPAN', 6.0, 7.5),
      ]),
      { units: 'm' },
    )
    expect(reversed).toEqual(forward)
  })
})
