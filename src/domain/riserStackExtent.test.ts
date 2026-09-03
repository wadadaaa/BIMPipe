import { describe, expect, it } from 'vitest'
import type { ContinuityMap, StoreyObstructionGrid } from './continuityMap'
import {
  buildCoreFingerprint,
  computeRiserStackExtent,
  SAME_CORE_RADIUS_M,
  toStackExtentFixtures,
  type RiserStackExtentInput,
  type StackExtentFixture,
  type StackExtentStorey,
} from './riserStackExtent'

// Synthetic 8-storey tower: B1, GF, 1..5, Roof (ids are deliberately not in
// elevation order to prove ordering comes from elevation, not ids).
const B1 = 101
const GF = 102
const L1 = 103
const L2 = 104
const L3 = 105
const L4 = 106
const L5 = 107
const ROOF = 108

const tower: StackExtentStorey[] = [
  { id: ROOF, name: 'Roof', elevation: 21 },
  { id: L5, name: '5', elevation: 18 },
  { id: L4, name: '4', elevation: 15 },
  { id: L3, name: '3', elevation: 12 },
  { id: L2, name: '2', elevation: 9 },
  { id: L1, name: '1', elevation: 6 },
  { id: GF, name: 'GF', elevation: 3 },
  { id: B1, name: 'B1', elevation: 0 },
]

const STACK_XY = { x: 10, z: 20 }

function wc(storeyId: number, dx = 0.4, dz = -0.3): StackExtentFixture {
  return { storeyId, kind: 'TOILETPAN', x: STACK_XY.x + dx, z: STACK_XY.z + dz }
}

// WCs at the same XY on GF..4; nothing on 5 and Roof.
const typicalFixtures: StackExtentFixture[] = [wc(GF), wc(L1), wc(L2), wc(L3), wc(L4)]

function baseInput(overrides: Partial<RiserStackExtentInput> = {}): RiserStackExtentInput {
  return {
    storeys: tower,
    fixtures: typicalFixtures,
    anchorStoreyId: L1,
    stackXY: STACK_XY,
    planUnits: 'm',
    ...overrides,
  }
}

/** One-cell-per-metre grid covering x∈[0,40), z∈[0,40) with the given blocked cells. */
function grid(storeyId: number, storeyName: string, blockedCells: Array<[col: number, row: number]>): StoreyObstructionGrid {
  const columns = 40
  const rows = 40
  const blocked = new Uint8Array(columns * rows)
  for (const [col, row] of blockedCells) blocked[row * columns + col] = 1
  return { storeyId, storeyName, origin: { x: 0, z: 0 }, cellSize: 1, columns, rows, blocked }
}

function mapWith(grids: StoreyObstructionGrid[], shaftCandidates: ContinuityMap['shaftCandidates'] = []): ContinuityMap {
  return { units: 'm', cellSize: 1, grids, shaftCandidates, diagnostics: [] }
}

describe('computeRiserStackExtent', () => {
  it('spans collector B1 up to the last storey with a matching core (4), excluding 5 and the roof', () => {
    const extent = computeRiserStackExtent(baseInput())

    expect(extent.storeyIds).toEqual([B1, GF, L1, L2, L3, L4])
    expect(extent.collectorStoreyId).toBe(B1)
    expect(extent.topStoreyId).toBe(L4)
    expect(extent.anchorCoreFingerprint).toBe('TOILETPAN')
    expect(extent.reasons.some((reason) => reason.startsWith('no matching core on 5'))).toBe(true)
    expect(extent.reasons.some((reason) => reason.startsWith('roof excluded: Roof'))).toBe(true)
    expect(extent.reasons.some((reason) => reason.includes('collector: B1'))).toBe(true)
    expect(extent.reasons.some((reason) => reason.includes('continuity bound skipped: no continuity map'))).toBe(true)
  })

  it('stops directly on the roof when every regular storey above the anchor matches', () => {
    const extent = computeRiserStackExtent(
      baseInput({ fixtures: [...typicalFixtures, wc(L5)], anchorStoreyId: L4 }),
    )

    expect(extent.storeyIds).toEqual([B1, GF, L1, L2, L3, L4, L5])
    expect(extent.topStoreyId).toBe(L5)
    expect(extent.reasons.filter((reason) => reason.startsWith('roof excluded'))).toEqual([
      'roof excluded: Roof is a roof/technical storey',
    ])
  })

  it('stops at a storey whose core at that XY has different kinds only (kitchen vs WC)', () => {
    const fixtures: StackExtentFixture[] = [
      wc(GF),
      wc(L1),
      wc(L2),
      { storeyId: L3, kind: 'KITCHEN', x: STACK_XY.x + 0.5, z: STACK_XY.z },
      wc(L4),
    ]
    const extent = computeRiserStackExtent(baseInput({ fixtures }))

    expect(extent.storeyIds).toEqual([B1, GF, L1, L2])
    expect(extent.topStoreyId).toBe(L2)
    expect(extent.reasons).toContain('no matching core on 3: found KITCHEN, anchor core is TOILETPAN')
  })

  it('uses the wet-core membership fingerprint as the anchor when supplied, instead of the radius probe', () => {
    // The stack was snapped next to a neighbouring basin on the anchor storey (1),
    // so the radius probe reads TOILETPAN+WASHHANDBASIN and finds no match on 2.
    const fixtures: StackExtentFixture[] = [
      wc(GF),
      wc(L1),
      { storeyId: L1, kind: 'WASHHANDBASIN', x: STACK_XY.x + 1, z: STACK_XY.z },
      wc(L2),
      wc(L3),
    ]
    const byRadius = computeRiserStackExtent(baseInput({ fixtures }))
    expect(byRadius.anchorCoreFingerprint).toBe('TOILETPAN+WASHHANDBASIN')
    expect(byRadius.storeyIds).toEqual([B1, GF, L1])

    const byMembership = computeRiserStackExtent(baseInput({ fixtures, anchorCoreFingerprint: 'TOILETPAN' }))
    expect(byMembership.anchorCoreFingerprint).toBe('TOILETPAN')
    expect(byMembership.storeyIds).toEqual([B1, GF, L1, L2, L3])
    expect(byMembership.reasons[0]).toBe('anchor core on 1: TOILETPAN (wet-core membership)')

    // Null behaves like "not supplied".
    expect(computeRiserStackExtent(baseInput({ fixtures, anchorCoreFingerprint: null }))).toEqual(byRadius)
  })

  it('ignores fixtures outside the core radius', () => {
    const farWc: StackExtentFixture = {
      storeyId: L2,
      kind: 'TOILETPAN',
      x: STACK_XY.x + SAME_CORE_RADIUS_M + 0.01,
      z: STACK_XY.z,
    }
    const extent = computeRiserStackExtent(baseInput({ fixtures: [wc(GF), wc(L1), farWc, wc(L3)] }))

    expect(extent.storeyIds).toEqual([B1, GF, L1])
    expect(extent.reasons).toContain('no matching core on 2: found none, anchor core is TOILETPAN')
  })

  it('treats a blocked continuity cell on storey 3 as a hard stop at 2', () => {
    const map = mapWith([grid(L3, '3', [[10, 20]])])
    const extent = computeRiserStackExtent(baseInput({ continuityMap: map }))

    expect(extent.storeyIds).toEqual([B1, GF, L1, L2])
    expect(extent.topStoreyId).toBe(L2)
    expect(extent.reasons.some((reason) => reason.startsWith('stopped at 2: obstruction on 3'))).toBe(true)
  })

  it('passes through a blocked cell when a shaft candidate on that storey contains the position', () => {
    const map = mapWith(
      [grid(L3, '3', [[10, 20]])],
      [
        {
          id: 'shaft-space:105:space:1',
          source: 'shaft-named-space',
          center: { x: 10.2, z: 20.1 },
          bounds: { minX: 9.5, maxX: 11, minZ: 19.5, maxZ: 21 },
          polygon: null,
          storeyIds: [L3],
          name: 'פיר',
        },
      ],
    )
    const extent = computeRiserStackExtent(baseInput({ continuityMap: map }))

    expect(extent.storeyIds).toEqual([B1, GF, L1, L2, L3, L4])
    expect(extent.reasons.some((reason) => reason.includes('obstruction'))).toBe(false)
  })

  it('applies the obstruction bound downward too: the stack bottoms out above the blocked storey', () => {
    const map = mapWith([grid(GF, 'GF', [[10, 20]])])
    const extent = computeRiserStackExtent(baseInput({ continuityMap: map }))

    expect(extent.storeyIds).toEqual([L1, L2, L3, L4])
    expect(extent.collectorStoreyId).toBe(L1)
    expect(extent.reasons.some((reason) => reason.startsWith('stopped below 1: obstruction on GF'))).toBe(true)
  })

  it('never blocks on cells outside the grid, empty grids, or a map in other units', () => {
    const outside = mapWith([grid(L3, '3', [[10, 20]])].map((g) => ({ ...g, origin: { x: 100, z: 100 } })))
    expect(computeRiserStackExtent(baseInput({ continuityMap: outside })).topStoreyId).toBe(L4)

    const empty = mapWith([{ ...grid(L3, '3', []), columns: 0, rows: 0, blocked: new Uint8Array(0) }])
    expect(computeRiserStackExtent(baseInput({ continuityMap: empty })).topStoreyId).toBe(L4)

    const mm: ContinuityMap = { ...mapWith([grid(L3, '3', [[10, 20]])]), units: 'mm' }
    const mismatched = computeRiserStackExtent(baseInput({ continuityMap: mm }))
    expect(mismatched.topStoreyId).toBe(L4)
    expect(mismatched.reasons.some((reason) => reason.includes('differ from plan units'))).toBe(true)
  })

  it('respects the collector override', () => {
    const extent = computeRiserStackExtent(baseInput({ collectorStoreyId: GF }))

    expect(extent.storeyIds).toEqual([GF, L1, L2, L3, L4])
    expect(extent.collectorStoreyId).toBe(GF)
    expect(extent.reasons).toContain('collector: GF (explicit override)')
  })

  it('falls back to the default collector when the override is not a known storey', () => {
    const extent = computeRiserStackExtent(baseInput({ collectorStoreyId: 999 }))

    expect(extent.collectorStoreyId).toBe(B1)
    expect(extent.reasons.some((reason) => reason.includes('override 999 is not a known storey'))).toBe(true)
  })

  it('bottoms out at the anchor when the collector sits above it', () => {
    const extent = computeRiserStackExtent(baseInput({ anchorStoreyId: GF, collectorStoreyId: L2 }))

    expect(extent.storeyIds).toEqual([GF, L1, L2, L3, L4])
    expect(extent.collectorStoreyId).toBe(GF)
    expect(extent.reasons.some((reason) => reason.includes('collector 2 is above the anchor GF'))).toBe(true)
  })

  it('passes Hebrew storey names through untranslated and skips the Hebrew roof', () => {
    const hebrew: StackExtentStorey[] = [
      { id: 1, name: 'מרתף', elevation: -3 },
      { id: 2, name: 'קומת קרקע', elevation: 0 },
      { id: 3, name: 'קומה 1', elevation: 3 },
      { id: 4, name: 'קומה 2', elevation: 6 },
      { id: 5, name: 'גג', elevation: 9 },
    ]
    const extent = computeRiserStackExtent(
      baseInput({ storeys: hebrew, fixtures: [wc(2), wc(3), wc(4)], anchorStoreyId: 3 }),
    )

    expect(extent.storeyIds).toEqual([1, 2, 3, 4])
    expect(extent.reasons).toContain('collector: מרתף (lowest storey excluding roof/technical names)')
    expect(extent.reasons).toContain('roof excluded: גג is a roof/technical storey')
  })

  it('keeps the anchor storey when it has no core at the stack position', () => {
    const extent = computeRiserStackExtent(baseInput({ fixtures: [wc(L2)], anchorStoreyId: L1 }))

    expect(extent.storeyIds).toEqual([B1, GF, L1])
    expect(extent.anchorCoreFingerprint).toBe('')
    expect(extent.reasons).toContain('no matching core on 2: found TOILETPAN, anchor core is none')
  })

  it('includes technical storeys that lie between the collector and the anchor as pass-through levels', () => {
    const withLowTechnical: StackExtentStorey[] = [
      { id: 1, name: 'B1', elevation: 0 },
      { id: 2, name: 'R2', elevation: 3 },
      { id: 3, name: 'GF', elevation: 6 },
      { id: 4, name: '01', elevation: 9 },
      { id: 5, name: 'R1', elevation: 12 },
    ]
    const extent = computeRiserStackExtent(
      baseInput({ storeys: withLowTechnical, fixtures: [wc(4)], anchorStoreyId: 4 }),
    )

    expect(extent.storeyIds).toEqual([1, 2, 3, 4])
    expect(extent.collectorStoreyId).toBe(1)
    expect(extent.topStoreyId).toBe(4)
  })

  it('is deterministic regardless of storey/fixture input order', () => {
    const shuffledInput = baseInput({
      storeys: [...tower].reverse(),
      fixtures: [...typicalFixtures].reverse(),
    })
    expect(computeRiserStackExtent(shuffledInput)).toEqual(computeRiserStackExtent(baseInput()))
  })

  it('throws when the anchor storey is unknown', () => {
    expect(() => computeRiserStackExtent(baseInput({ anchorStoreyId: 999 }))).toThrow(/anchor storey 999/)
  })
})

describe('buildCoreFingerprint / toStackExtentFixtures', () => {
  it('builds a sorted kind set within the radius', () => {
    const fixtures: StackExtentFixture[] = [
      { storeyId: 1, kind: 'WASHHANDBASIN', x: 1, z: 1 },
      { storeyId: 1, kind: 'TOILETPAN', x: 1.5, z: 1 },
      { storeyId: 1, kind: 'TOILETPAN', x: 1.2, z: 1.3 },
      { storeyId: 1, kind: 'BATH', x: 9, z: 9 },
      { storeyId: 2, kind: 'BIDET', x: 1, z: 1 },
    ]
    expect(buildCoreFingerprint(fixtures, 1, { x: 1, z: 1 }, 2.6)).toBe('TOILETPAN+WASHHANDBASIN')
    expect(buildCoreFingerprint(fixtures, 3, { x: 1, z: 1 }, 2.6)).toBe('')
  })

  it('drops position-less fixtures and maps kitchens to the KITCHEN kind', () => {
    const result = toStackExtentFixtures(
      [
        { expressId: 1, name: 'WC', kind: 'TOILETPAN', storeyId: 7, position: { x: 1, y: 2, z: 3 } },
        { expressId: 2, name: 'no geometry', kind: 'SINK', storeyId: 7, position: null },
      ],
      [
        { expressId: 3, name: 'kitchen', storeyId: 8, position: { x: 4, y: 5, z: 6 } },
        { expressId: 4, name: 'kitchen without geometry', storeyId: 8, position: null },
      ],
    )
    expect(result).toEqual([
      { storeyId: 7, kind: 'TOILETPAN', x: 1, z: 3 },
      { storeyId: 8, kind: 'KITCHEN', x: 4, z: 6 },
    ])
  })
})
