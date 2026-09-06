import { describe, expect, it } from 'vitest'
import type { PlanBounds } from '@/domain/types'
import {
  buildContinuityMap,
  cellCenter,
  findDenseStructureClusters,
  findFreeCellWithinBounds,
  isCellBlocked,
  isShaftLikeName,
  probeContinuityCell,
  probeStructureAlongAxis,
  selectOfficeCoreShafts,
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

  it('carves a hosted void out of its own slab only: a slab filling another slab’s opening stays solid', () => {
    // Outer plate 0..3000 with a 1000..2000 cut-out; an inner plate fills that
    // cut-out exactly (real case: a tower plate sitting in the opening of a
    // larger floor plate). The inner plate has its own small opening.
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            { id: 'slab:outer', kind: 'slab', footprint: bbox(0, 3000, 0, 3000) },
            { id: 'slab:inner', kind: 'slab', footprint: bbox(1000, 2000, 1000, 2000) },
          ],
          voids: [
            { id: 'opening:big', kind: 'slab-opening', footprint: bbox(1000, 2000, 1000, 2000), hostId: 'slab:outer' },
            { id: 'opening:shaft', kind: 'slab-opening', footprint: bbox(1600, 1850, 1600, 1850), hostId: 'slab:inner' },
          ],
        }),
      ]),
    )

    const grid = map.grids[0]
    // Grid origin is (-250, -250): cell (c, r) covers [-250 + 250c, 250c).
    // Inner plate cell away from its shaft opening: blocked (the outer plate's
    // cut-out does not un-block the inner plate).
    expect(isCellBlocked(grid, 5, 5)).toBe(true)
    // The inner plate's own opening re-opens cell (7, 7): its centre (1625, 1625) lies inside 1600..1850.
    expect(isCellBlocked(grid, 7, 7)).toBe(false)
    // Cell (8, 8) (centre 1875, 1875) is outside that opening: inner plate, blocked.
    expect(isCellBlocked(grid, 8, 8)).toBe(true)
    // Outer plate away from the cut-out: blocked.
    expect(isCellBlocked(grid, 1, 1)).toBe(true)
    // The filled cut-out is not a shaft candidate (explained), the real opening is.
    expect(map.shaftCandidates.map((candidate) => candidate.id)).toEqual(['slab-opening:10:opening:shaft'])
    expect(map.diagnostics).toEqual([
      'Opening opening:big (slab-opening, host slab:outer) on storey 10 is filled by slab:inner at its centre and was excluded from shaft candidates.',
    ])
  })

  it('lets a structural shaft opening carve an overlapping finish floor of another file (not an infill)', () => {
    // Merged multi-file storey: the structural slab has a 500 × 500 shaft
    // opening; the architectural finish floor covers the whole plate without
    // modelling the hole. The finish floor is not an infill of the small
    // opening, so the opening stays free and remains a shaft candidate.
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            { id: 'ST.ifc:slab:1', kind: 'slab', footprint: bbox(0, 3000, 0, 3000) },
            { id: 'AR.ifc:slab:9', kind: 'slab', footprint: bbox(0, 3000, 0, 3000) },
          ],
          voids: [{ id: 'ST.ifc:opening:1', kind: 'slab-opening', footprint: bbox(1000, 1500, 1000, 1500), hostId: 'ST.ifc:slab:1' }],
        }),
      ]),
    )
    const grid = map.grids[0]
    // Cell (5, 5) has its centre (1125, 1125) inside the opening: free despite the finish floor.
    expect(isCellBlocked(grid, 5, 5)).toBe(false)
    expect(isCellBlocked(grid, 2, 2)).toBe(true)
    expect(map.shaftCandidates.map((candidate) => candidate.id)).toEqual(['slab-opening:10:ST.ifc:opening:1'])
    expect(map.diagnostics).toEqual([])
  })

  it('does not seed aligned voids from filled openings', () => {
    const filled = (storeyId: number): ContinuityStoreyInput =>
      storey(storeyId, {
        obstructions: [
          { id: 'slab:outer', kind: 'slab', footprint: bbox(0, 3000, 0, 3000) },
          { id: 'slab:inner', kind: 'slab', footprint: bbox(1000, 2000, 1000, 2000) },
        ],
        voids: [{ id: 'opening:big', kind: 'slab-opening', footprint: bbox(1000, 2000, 1000, 2000), hostId: 'slab:outer' }],
      })
    const map = buildContinuityMap(mmInput([filled(10), filled(11), filled(12)]))
    expect(map.shaftCandidates).toEqual([])
    expect(map.diagnostics).toHaveLength(3)
  })

  it('does not let a wall-hosted void (door / window) punch a hole in the slab', () => {
    const map = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [
            { id: 'slab:1', kind: 'slab', footprint: bbox(0, 2000, 0, 2000) },
            { id: 'wall:1', kind: 'wall', footprint: bbox(0, 2000, 900, 1100) },
          ],
          voids: [{ id: 'opening:door', kind: 'void', footprint: bbox(500, 1400, 600, 1400), hostId: 'wall:1' }],
        }),
      ]),
    )

    const grid = map.grids[0]
    // Cell (4, 3) has its centre (875, 625) inside the door void's bbox and
    // clear of the wall; the void belongs to the wall, so the slab under it
    // stays solid.
    expect(isCellBlocked(grid, 4, 3)).toBe(true)
    // Wall cell: blocked regardless of the void.
    expect(isCellBlocked(grid, 4, 4)).toBe(true)

    // Legacy input without a host carves every slab (unchanged behaviour).
    const legacy = buildContinuityMap(
      mmInput([
        storey(10, {
          obstructions: [{ id: 'slab:1', kind: 'slab', footprint: bbox(0, 2000, 0, 2000) }],
          voids: [{ id: 'opening:door', kind: 'void', footprint: bbox(500, 1400, 600, 1400) }],
        }),
      ]),
    )
    expect(isCellBlocked(legacy.grids[0], 4, 3)).toBe(false)
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

// ---------------------------------------------------------------------------
// G3 additive queries: structure layer, dense clusters, office core shafts
// ---------------------------------------------------------------------------

const mInput = (storeys: ContinuityStoreyInput[]): ContinuityMapInput => ({ units: 'm', storeys })

/**
 * Synthetic office floor in metres: a 30 × 20 m slab, a facade wall along the
 * bottom edge, a dense core (lift shaft box + stair enclosure + service walls)
 * around x 12–18, z 6–14 with a 2.5 × 5 m stair void, two small shaft openings
 * next to the core, one small shaft opening far away at the facade, one
 * sleeve (0.05 m²) in the core and one long slot (5 × 0.5 m) in the core.
 */
function officeFloor(storeyId: number): ContinuityStoreyInput {
  return storey(storeyId, {
    obstructions: [
      { id: 'slab:1', kind: 'slab', footprint: bbox(0, 30, 0, 20) },
      { id: 'wall:facade', kind: 'wall', footprint: bbox(0, 30, 0, 0.25) },
      // Core: lift shaft box 12–15 × 6–9 (four walls), stair enclosure 15–18 × 6–14,
      // service walls crossing the core block.
      { id: 'wall:c1', kind: 'wall', footprint: bbox(12, 15, 6, 6.3) },
      { id: 'wall:c2', kind: 'wall', footprint: bbox(12, 15, 8.7, 9) },
      { id: 'wall:c3', kind: 'wall', footprint: bbox(12, 12.3, 6, 14) },
      { id: 'wall:c4', kind: 'wall', footprint: bbox(14.7, 15, 6, 14) },
      { id: 'wall:c5', kind: 'wall', footprint: bbox(15, 18, 6, 6.3) },
      { id: 'wall:c6', kind: 'wall', footprint: bbox(15, 18, 13.7, 14) },
      { id: 'wall:c7', kind: 'wall', footprint: bbox(17.7, 18, 6, 14) },
      { id: 'wall:c8', kind: 'wall', footprint: bbox(12, 18, 10.5, 10.8) },
      { id: 'wall:c9', kind: 'wall', footprint: bbox(12, 18, 12.2, 12.5) },
      { id: 'column:a', kind: 'column', footprint: bbox(13.4, 13.9, 11.2, 11.7) },
    ],
    voids: [
      // Stair void inside the enclosure (large, 2.5 × 5 = 12.5 m²).
      { id: 'opening:stair', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(15.3, 17.8, 6.5, 11.5) },
      // Two core shafts (0.6 × 1.0 and 0.8 × 0.8) just outside the core walls.
      { id: 'opening:shaft-a', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(11, 11.6, 7, 8) },
      { id: 'opening:shaft-b', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(18.4, 19.2, 12.4, 13.2) },
      // A shaft-sized opening far from the core (facade, x=2).
      { id: 'opening:far', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(2, 2.8, 1, 1.8) },
      // Sleeve (0.2 × 0.25 = 0.05 m²) in the core.
      { id: 'opening:sleeve', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(13, 13.2, 9.5, 9.75) },
      // Slot (5 × 0.5 = 2.5 m², aspect 10) along the core.
      { id: 'opening:slot', kind: 'slab-opening', hostId: 'slab:1', footprint: bbox(12.5, 17.5, 14.5, 15) },
    ],
  })
}

const OFFICE_RULES = {
  shaftMinAreaM2: 0.1,
  shaftMaxAreaM2: 6,
  shaftMaxAspectRatio: 4,
  coreRadiusM: 6,
  denseWindowM: 3,
  denseStructureMinDensity: 0.3,
  largeVoidMinAreaM2: 4,
}

describe('structure layer + directional probe', () => {
  it('records walls/columns in structureBlocked and never slabs', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const grid = map.grids[0]
    expect(grid.structureBlocked).toBeDefined()
    // A slab-only cell: blocked (slab) but not structure.
    const slabOnly = probeContinuityCell(map, 1, { x: 5, z: 10 })
    expect(slabOnly.status).toBe('blocked')
    const slabIndex = (slabOnly as { cell: { col: number; row: number } }).cell
    expect(grid.structureBlocked![slabIndex.row * grid.columns + slabIndex.col]).toBe(0)
    // A facade wall cell: structure.
    const wall = probeContinuityCell(map, 1, { x: 5, z: 0.1 }) as { cell: { col: number; row: number } }
    expect(grid.structureBlocked![wall.cell.row * grid.columns + wall.cell.col]).toBe(1)
  })

  it('probes toward the nearest wall along an axis and reports null when nothing is met', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const grid = map.grids[0]
    // From open floor at (5, 1.5) walking -z hits the facade wall (~1.4 m away).
    const toFacade = probeStructureAlongAxis(grid, { x: 5, z: 1.5 }, 'z', -1, 3)
    expect(toFacade).not.toBeNull()
    expect(toFacade!).toBeGreaterThan(1)
    expect(toFacade!).toBeLessThan(1.6)
    // Walking +z from the same point finds nothing within 3 m.
    expect(probeStructureAlongAxis(grid, { x: 5, z: 1.5 }, 'z', 1, 3)).toBeNull()
    // Grids without the layer answer null.
    expect(probeStructureAlongAxis({ ...grid, structureBlocked: undefined }, { x: 5, z: 1.5 }, 'z', -1, 3)).toBeNull()
  })
})

describe('findDenseStructureClusters', () => {
  it('finds the core as one cluster and ignores a lone facade wall', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const clusters = findDenseStructureClusters(map.grids[0], 3, 0.3)
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    // Every cluster lies in the core block, none along the facade.
    for (const cluster of clusters) {
      expect(cluster.center.x).toBeGreaterThan(11)
      expect(cluster.center.x).toBeLessThan(19)
      expect(cluster.center.z).toBeGreaterThan(5)
      expect(cluster.center.z).toBeLessThan(15)
      expect(cluster.peakDensity).toBeGreaterThanOrEqual(0.3)
    }
    // Deterministic ids.
    expect(clusters.map((cluster) => cluster.id)).toEqual(clusters.map((_, index) => `dense-structure:1:${index}`))
  })

  it('returns nothing without a structure layer or when the window exceeds the grid', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    expect(findDenseStructureClusters({ ...map.grids[0], structureBlocked: undefined }, 3, 0.3)).toEqual([])
    expect(findDenseStructureClusters(map.grids[0], 500, 0.3)).toEqual([])
  })
})

describe('selectOfficeCoreShafts', () => {
  it('keeps only shaft-like openings near the core and explains every verdict', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const selection = selectOfficeCoreShafts(map, 1, OFFICE_RULES)
    const byId = new Map(selection.candidates.map((entry) => [entry.candidate.id, entry]))

    const shaftA = byId.get('slab-opening:1:opening:shaft-a')!
    const shaftB = byId.get('slab-opening:1:opening:shaft-b')!
    const far = byId.get('slab-opening:1:opening:far')!
    const stair = byId.get('slab-opening:1:opening:stair')!
    const sleeve = byId.get('slab-opening:1:opening:sleeve')!
    const slot = byId.get('slab-opening:1:opening:slot')!

    expect(shaftA.selected).toBe(true)
    expect(shaftA.areaM2).toBeCloseTo(0.6, 6)
    expect(shaftA.coreAnchor).not.toBeNull()
    expect(shaftA.reason).toMatch(/^core shaft/)
    expect(shaftB.selected).toBe(true)
    expect(shaftB.areaM2).toBeCloseTo(0.64, 6)

    expect(far.selected).toBe(false)
    expect(far.shaftLike).toBe(true)
    expect(far.rejection).toBe('outside-core-radius')
    expect(far.distanceToDenseStructureM!).toBeGreaterThan(OFFICE_RULES.coreRadiusM)

    expect(stair.selected).toBe(false)
    expect(stair.rejection).toBe('area-above-max')
    expect(stair.areaM2).toBeCloseTo(12.5, 6)
    expect(stair.reason).toContain('used as a core anchor')

    expect(sleeve.selected).toBe(false)
    expect(sleeve.rejection).toBe('area-below-min')

    expect(slot.selected).toBe(false)
    expect(slot.rejection).toBe('aspect-above-max')
    expect(slot.aspectRatio).toBeCloseTo(10, 6)

    expect(selection.selected.map((candidate) => candidate.id)).toEqual([
      'slab-opening:1:opening:shaft-a',
      'slab-opening:1:opening:shaft-b',
    ])
    expect(selection.largeVoids).toHaveLength(1)
    expect(selection.largeVoids[0].repeating).toBe(false)
    expect(selection.diagnostics.some((line) => line.includes('single-storey'))).toBe(true)
  })

  it('anchors on a stair void alone when the grid has no structure layer', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const stripped = { ...map, grids: map.grids.map((grid) => ({ ...grid, structureBlocked: undefined })) }
    const selection = selectOfficeCoreShafts(stripped, 1, OFFICE_RULES)
    expect(selection.denseClusters).toEqual([])
    const shaftA = selection.candidates.find((entry) => entry.candidate.id === 'slab-opening:1:opening:shaft-a')!
    expect(shaftA.selected).toBe(true)
    expect(shaftA.coreAnchor).toBe('stair-lift-void')
    expect(shaftA.distanceToDenseStructureM).toBeNull()
    const far = selection.candidates.find((entry) => entry.candidate.id === 'slab-opening:1:opening:far')!
    expect(far.selected).toBe(false)
    expect(selection.diagnostics.some((line) => line.includes('no wall/column layer'))).toBe(true)
  })

  it('marks repeating stair voids from aligned-void candidates and converts mm maps to metres', () => {
    const floors = [1, 2, 3].map((id) => {
      const floor = officeFloor(id)
      const scale = (footprint: PlanFootprint): PlanFootprint =>
        footprint.shape === 'bbox'
          ? bbox(footprint.bounds.minX * 1000, footprint.bounds.maxX * 1000, footprint.bounds.minZ * 1000, footprint.bounds.maxZ * 1000)
          : footprint
      return {
        ...floor,
        obstructions: floor.obstructions.map((o) => ({ ...o, footprint: scale(o.footprint) })),
        voids: floor.voids.map((v) => ({ ...v, footprint: scale(v.footprint) })),
      }
    })
    const map = buildContinuityMap(mmInput(floors))
    const selection = selectOfficeCoreShafts(map, 2, OFFICE_RULES)
    expect(selection.units).toBe('mm')
    const repeating = selection.largeVoids.filter((anchor) => anchor.repeating)
    expect(repeating.length).toBeGreaterThanOrEqual(1)
    expect(repeating[0].areaM2).toBeCloseTo(12.5, 6)
    const shaftA = selection.candidates.find((entry) => entry.candidate.id === 'slab-opening:2:opening:shaft-a')!
    expect(shaftA.selected).toBe(true)
    expect(shaftA.areaM2).toBeCloseTo(0.6, 6)
    // Same input twice → identical output.
    expect(selectOfficeCoreShafts(map, 2, OFFICE_RULES)).toEqual(selection)
  })

  it('reports an unknown storey explicitly', () => {
    const map = buildContinuityMap(mInput([officeFloor(1)]))
    const selection = selectOfficeCoreShafts(map, 99, OFFICE_RULES)
    expect(selection.candidates).toEqual([])
    expect(selection.selected).toEqual([])
    expect(selection.diagnostics[0]).toContain('no obstruction grid for storey 99')
  })
})
