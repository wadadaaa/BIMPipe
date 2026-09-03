import { describe, expect, it } from 'vitest'
import type { PlanBounds } from '@/domain/types'
import {
  buildContinuityMap,
  cellCenter,
  findFreeCellWithinBounds,
  isCellBlocked,
  isShaftLikeName,
  probeContinuityCell,
  snapPointToContinuity,
  type ContinuityMapInput,
  type ContinuityStoreyInput,
  type PlanFootprint,
} from './continuityMap'

const bbox = (minX: number, maxX: number, minZ: number, maxZ: number): PlanFootprint => ({
  shape: 'bbox',
  bounds: { minX, maxX, minZ, maxZ } satisfies PlanBounds,
})

const polygon = (points: Array<[number, number]>): PlanFootprint => ({
  shape: 'polygon',
  points: points.map(([x, z]) => ({ x, z })),
})

const storey = (
  storeyId: number,
  partial: Partial<Omit<ContinuityStoreyInput, 'storeyId'>> = {},
): ContinuityStoreyInput => ({
  storeyId,
  storeyName: `Storey ${storeyId}`,
  elevation: 0,
  obstructions: [],
  voids: [],
  spaces: [],
  ...partial,
})

const mmInput = (storeys: ContinuityStoreyInput[]): ContinuityMapInput => ({
  units: 'mm',
  storeys,
})

describe('buildContinuityMap — obstruction grid', () => {
  it('blocks cells intersected by walls and columns, keeps open cells free', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            { id: 'wall:1', kind: 'wall', footprint: bbox(0, 1000, 0, 200) },
            { id: 'column:2', kind: 'column', footprint: bbox(2000, 2250, 2000, 2250) },
          ],
        }),
      ]),
    )

    expect(map.units).toBe('mm')
    expect(map.cellSize).toBe(250)
    expect(map.grids).toHaveLength(1)

    const grid = map.grids[0]
    expect(grid.storeyId).toBe(10)
    expect(grid.origin).toEqual({ x: -250, z: -250 })
    expect(grid.columns).toBe(11)
    expect(grid.rows).toBe(11)

    // Wall cell (contains plan point 500, 100).
    expect(isCellBlocked(grid, 3, 1)).toBe(true)
    // Column cell (contains plan point 2100, 2100).
    expect(isCellBlocked(grid, 9, 9)).toBe(true)
    // Open floor area away from both.
    expect(isCellBlocked(grid, 3, 5)).toBe(false)
    expect(isCellBlocked(grid, 0, 0)).toBe(false)
    // Out-of-grid lookups count as blocked.
    expect(isCellBlocked(grid, -1, 0)).toBe(true)
    expect(isCellBlocked(grid, 11, 0)).toBe(true)
  })

  it('rasterizes polygon footprints without blocking cells outside the polygon', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            {
              id: 'wall:tri',
              kind: 'wall',
              footprint: polygon([[0, 0], [1000, 0], [0, 1000]]),
            },
          ],
        }),
      ]),
    )

    const grid = map.grids[0]
    // Inside the triangle (near the right angle at the origin).
    expect(isCellBlocked(grid, 1, 1)).toBe(true)
    // Inside the polygon's bbox but outside the hypotenuse.
    expect(isCellBlocked(grid, 4, 4)).toBe(false)
  })

  it('treats slabs as solid except where a void contains the cell centre', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [{ id: 'slab:1', kind: 'slab', footprint: bbox(0, 1000, 0, 1000) }],
          voids: [{ id: 'opening:1', kind: 'slab-opening', footprint: bbox(300, 700, 300, 700) }],
        }),
      ]),
    )

    const grid = map.grids[0]
    // Slab-covered cell away from the opening.
    expect(isCellBlocked(grid, 1, 1)).toBe(true)
    // Cells whose centres fall inside the opening are free again.
    expect(isCellBlocked(grid, 2, 2)).toBe(false)
    expect(isCellBlocked(grid, 3, 3)).toBe(false)
  })

  it('keeps wall cells blocked even when a void overlaps them', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            { id: 'slab:1', kind: 'slab', footprint: bbox(0, 1000, 0, 1000) },
            { id: 'wall:1', kind: 'wall', footprint: bbox(300, 700, 300, 450) },
          ],
          voids: [{ id: 'opening:1', kind: 'slab-opening', footprint: bbox(300, 700, 300, 700) }],
        }),
      ]),
    )

    const grid = map.grids[0]
    // Cell centre (375, 375) is inside the void, but the wall crosses the cell.
    expect(isCellBlocked(grid, 2, 2)).toBe(true)
    // Cell centre (625, 625) is inside the void and clear of the wall.
    expect(isCellBlocked(grid, 3, 3)).toBe(false)
  })

  it('produces an empty grid for a storey without geometry', () => {
    const map = buildContinuityMap(mmInput([storey(10)]))
    expect(map.grids[0].columns).toBe(0)
    expect(map.grids[0].rows).toBe(0)
    expect(map.grids[0].blocked).toHaveLength(0)
  })
})

describe('isShaftLikeName', () => {
  it.each([
    'פיר',
    'הפיר',
    'פירים',
    'פיר אינסטלציה',
    'פיר-3',
    'פיר04',
    'Shaft',
    'SHAFT-3',
    'shafts',
    'Elevator shaft',
    '\u200fפיר 2\u200e', // wrapped in bidi marks
  ])('matches %j', (name) => {
    expect(isShaftLikeName(name)).toBe(true)
  })

  it.each(['פירוק', 'פירוט', 'שפיר', 'מטבח', 'Bedroom', 'Shift', 'staff room', ''])(
    'does not match %j',
    (name) => {
      expect(isShaftLikeName(name)).toBe(false)
    },
  )
})

describe('buildContinuityMap — shaft candidates', () => {
  it('emits a per-storey candidate for each slab opening but not for generic voids', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          voids: [
            { id: 'opening:5', kind: 'slab-opening', footprint: bbox(400, 800, 400, 800) },
            { id: 'void:6', kind: 'void', footprint: bbox(3000, 3400, 3000, 3400) },
          ],
        }),
      ]),
    )

    expect(map.shaftCandidates).toHaveLength(1)
    expect(map.shaftCandidates[0]).toMatchObject({
      id: 'slab-opening:10:opening:5',
      source: 'slab-opening',
      center: { x: 600, z: 600 },
      bounds: { minX: 400, maxX: 800, minZ: 400, maxZ: 800 },
      storeyIds: [10],
    })
  })

  it('emits candidates for shaft-named spaces (Hebrew and English)', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          spaces: [
            { id: 'space:7', name: 'פיר-3', footprint: bbox(100, 400, 100, 400) },
            { id: 'space:8', name: 'Shaft B', footprint: bbox(900, 1200, 900, 1200) },
            { id: 'space:9', name: 'מטבח', footprint: bbox(2000, 2600, 2000, 2600) },
          ],
        }),
      ]),
    )

    expect(map.shaftCandidates.map((c) => c.id)).toEqual([
      'shaft-space:10:space:7',
      'shaft-space:10:space:8',
    ])
    expect(map.shaftCandidates[0]).toMatchObject({
      source: 'shaft-named-space',
      center: { x: 250, z: 250 },
      storeyIds: [10],
      name: 'פיר-3',
    })
  })

  it('reports (not silently drops) a shaft-named space without geometry', () => {
    const map = buildContinuityMap(
      mmInput([storey(10, { spaces: [{ id: 'space:7', name: 'פיר', footprint: null }] })]),
    )

    expect(map.shaftCandidates).toHaveLength(0)
    expect(map.diagnostics).toHaveLength(1)
    expect(map.diagnostics[0]).toContain('space:7')
    expect(map.diagnostics[0]).toContain('storey 10')
  })

  it('detects a vertical void aligned across 3 consecutive storeys', () => {
    const alignedVoid = (id: string) => ({
      id,
      kind: 'void' as const,
      footprint: bbox(1000, 1600, 2000, 2600),
    })
    const map = buildContinuityMap(
      mmInput([
        storey(10, { voids: [alignedVoid('v1')] }),
        storey(20, { voids: [alignedVoid('v2')] }),
        storey(30, { voids: [alignedVoid('v3')] }),
      ]),
    )

    expect(map.shaftCandidates).toHaveLength(1)
    expect(map.shaftCandidates[0]).toMatchObject({
      id: 'aligned-void:10:v1',
      source: 'aligned-void',
      center: { x: 1300, z: 2300 },
      storeyIds: [10, 20, 30],
    })
  })

  it('rejects voids that only align across 2 storeys (≥3 rule)', () => {
    const alignedVoid = (id: string) => ({
      id,
      kind: 'void' as const,
      footprint: bbox(1000, 1600, 2000, 2600),
    })
    const map = buildContinuityMap(
      mmInput([
        storey(10, { voids: [alignedVoid('v1')] }),
        storey(20, { voids: [alignedVoid('v2')] }),
        storey(30), // no void here — the chain is not consecutive
      ]),
    )

    expect(map.shaftCandidates).toHaveLength(0)
  })

  it('rejects chains broken by a misaligned middle storey (beyond tolerance)', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, { voids: [{ id: 'v1', kind: 'void', footprint: bbox(1000, 1600, 2000, 2600) }] }),
        // Centre shifted 400 mm on x — beyond the 300 mm alignment tolerance.
        storey(20, { voids: [{ id: 'v2', kind: 'void', footprint: bbox(1400, 2000, 2000, 2600) }] }),
        storey(30, { voids: [{ id: 'v3', kind: 'void', footprint: bbox(1000, 1600, 2000, 2600) }] }),
      ]),
    )

    expect(map.shaftCandidates).toHaveLength(0)
  })

  it('starts an aligned chain above an empty storey when 3 upper storeys align', () => {
    const alignedVoid = (id: string) => ({
      id,
      kind: 'void' as const,
      footprint: bbox(1000, 1600, 2000, 2600),
    })
    const map = buildContinuityMap(
      mmInput([
        storey(10),
        storey(20, { voids: [alignedVoid('v2')] }),
        storey(30, { voids: [alignedVoid('v3')] }),
        storey(40, { voids: [alignedVoid('v4')] }),
      ]),
    )

    expect(map.shaftCandidates).toHaveLength(1)
    expect(map.shaftCandidates[0]).toMatchObject({
      id: 'aligned-void:20:v2',
      storeyIds: [20, 30, 40],
    })
  })

  it('is deterministic: same input twice produces identical maps', () => {
    const input = mmInput([
      storey(10, {
        obstructions: [{ id: 'wall:1', kind: 'wall', footprint: bbox(0, 5000, 0, 200) }],
        voids: [{ id: 'opening:1', kind: 'slab-opening', footprint: bbox(400, 800, 400, 800) }],
        spaces: [{ id: 'space:1', name: 'פיר', footprint: bbox(100, 400, 1100, 1400) }],
      }),
      storey(20, {
        voids: [{ id: 'opening:2', kind: 'slab-opening', footprint: bbox(410, 810, 400, 800) }],
      }),
      storey(30, {
        voids: [{ id: 'opening:3', kind: 'slab-opening', footprint: bbox(420, 820, 400, 800) }],
      }),
    ])

    const first = buildContinuityMap(input)
    const second = buildContinuityMap(input)
    expect(second).toEqual(first)

    const ids = first.shaftCandidates.map((c) => c.id)
    expect(ids).toEqual([...ids].sort())
  })
})

describe('snapPointToContinuity', () => {
  const walls = [
    { id: 'wall:1', kind: 'wall' as const, footprint: bbox(0, 2000, 0, 250) },
    { id: 'wall:2', kind: 'wall' as const, footprint: bbox(0, 250, 2000, 2250) },
  ]

  it('snaps to the nearest free cell centre within range', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    const outcome = snapPointToContinuity(map, 10, { x: 1010, z: 600 }, 1500)

    expect(outcome.kind).toBe('free-cell')
    if (outcome.kind !== 'free-cell') return
    expect(outcome.cell).toEqual({ col: 5, row: 3 })
    expect(outcome.position).toEqual(cellCenter(map.grids[0], 5, 3))
    expect(outcome.position).toEqual({ x: 1125, z: 625 })
    expect(outcome.distance).toBeCloseTo(117.69, 1)
  })

  it('prefers a shaft candidate over a closer free cell', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: walls,
          spaces: [{ id: 'space:9', name: 'פיר', footprint: bbox(1500, 1800, 500, 800) }],
        }),
      ]),
    )
    const outcome = snapPointToContinuity(map, 10, { x: 1010, z: 600 }, 1500)

    expect(outcome.kind).toBe('shaft')
    if (outcome.kind !== 'shaft') return
    expect(outcome.shaftId).toBe('shaft-space:10:space:9')
    expect(outcome.position).toEqual({ x: 1650, z: 650 })
    expect(outcome.distance).toBeCloseTo(641.95, 1)
  })

  it('misses with an explicit reason when nothing is in range', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    const outcome = snapPointToContinuity(map, 10, { x: 1010, z: 600 }, 50)

    expect(outcome).toEqual({
      kind: 'miss',
      reason: 'no shaft candidate or free grid cell within 50 mm on storey 10',
    })
  })

  it('misses with an explicit reason for an unknown storey', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    const outcome = snapPointToContinuity(map, 99, { x: 0, z: 0 }, 1500)

    expect(outcome).toEqual({ kind: 'miss', reason: 'no obstruction grid for storey 99' })
  })

  it('misses with an explicit reason on an empty grid', () => {
    const map = buildContinuityMap(mmInput([storey(10)]))
    const outcome = snapPointToContinuity(map, 10, { x: 0, z: 0 }, 1500)

    expect(outcome).toEqual({
      kind: 'miss',
      reason: 'obstruction grid for storey 10 is empty',
    })
  })

  it('is deterministic for repeated snaps', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    const first = snapPointToContinuity(map, 10, { x: 1010, z: 600 }, 1500)
    const second = snapPointToContinuity(map, 10, { x: 1010, z: 600 }, 1500)
    expect(second).toEqual(first)
  })
})

describe('probeContinuityCell / findFreeCellWithinBounds (V3 queries)', () => {
  const walls = [{ id: 'wall:1', kind: 'wall' as const, footprint: bbox(0, 2000, 0, 250) }]

  it('reports blocked, free, and unknown explicitly', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    expect(probeContinuityCell(map, 10, { x: 1000, z: 100 })).toEqual({
      status: 'blocked',
      cell: { col: 5, row: 1 },
    })
    // Padding row below the wall (grid spans z -250…500) is free.
    expect(probeContinuityCell(map, 10, { x: 1000, z: 400 })).toEqual({
      status: 'free',
      cell: { col: 5, row: 2 },
    })
    // Outside the padded grid → unknown, never blocked.
    expect(probeContinuityCell(map, 10, { x: 50_000, z: 0 })).toEqual({
      status: 'unknown',
      reason: 'point lies outside the obstruction grid of storey 10',
    })
    expect(probeContinuityCell(map, 99, { x: 0, z: 0 })).toEqual({
      status: 'unknown',
      reason: 'no obstruction grid for storey 99',
    })
    expect(probeContinuityCell(buildContinuityMap(mmInput([storey(10)])), 10, { x: 0, z: 0 })).toEqual({
      status: 'unknown',
      reason: 'obstruction grid for storey 10 is empty',
    })
  })

  it('finds the nearest free cell whose centre lies inside the bounds, or null when all are blocked', () => {
    const map = buildContinuityMap(mmInput([storey(10, { obstructions: walls })]))
    const grid = map.grids[0]
    // Bounds straddle the wall (z 0–250 blocked) and the free row below it.
    const found = findFreeCellWithinBounds(grid, { minX: 500, maxX: 1000, minZ: 0, maxZ: 500 }, { x: 750, z: 100 })
    expect(found).not.toBeNull()
    expect(found!.position.z).toBeGreaterThan(250)
    expect(isCellBlocked(grid, found!.cell.col, found!.cell.row)).toBe(false)
    expect(findFreeCellWithinBounds(grid, { minX: 500, maxX: 1000, minZ: 0, maxZ: 200 }, { x: 750, z: 100 })).toBeNull()
  })
})
