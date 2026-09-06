import { describe, expect, it } from 'vitest'
import {
  computeBranchRoutes,
  DEFAULT_BRANCH_SLOPE_DROP_MM,
  DEFAULT_BRANCH_SLOPE_RUN_MM,
  type AssignedFixture,
  type PlanPoint,
  type RouteSegment,
} from './branchRouting'

const SLOPE = DEFAULT_BRANCH_SLOPE_DROP_MM / DEFAULT_BRANCH_SLOPE_RUN_MM

const assigned = (
  fixtureExpressId: number,
  fixturePlan: PlanPoint,
  riserPlan: PlanPoint,
  overrides: Partial<AssignedFixture> = {},
): AssignedFixture => ({
  fixtureExpressId,
  fixtureKind: 'TOILETPAN',
  fixturePlan,
  riserId: 'riser-1',
  riserStackId: 'stack-1',
  riserPlan,
  storeyId: 101,
  ...overrides,
})

const planLength = (segment: RouteSegment): number =>
  Math.abs(segment.start.x - segment.end.x) + Math.abs(segment.start.z - segment.end.z)

/** Walks the served segments from the fixture position downstream to the riser. */
const walkPathToRiser = (
  segments: RouteSegment[],
  fixtureExpressId: number,
  fixturePlan: PlanPoint,
  riserPlan: PlanPoint,
): RouteSegment[] => {
  const path: RouteSegment[] = []
  let current = fixturePlan
  for (let hops = 0; hops < segments.length; hops++) {
    if (current.x === riserPlan.x && current.z === riserPlan.z) return path
    const next = segments.find((segment) =>
      segment.servedFixtureExpressIds.includes(fixtureExpressId)
      && segment.start.x === current.x
      && segment.start.z === current.z)
    if (!next) break
    path.push(next)
    current = { x: next.end.x, z: next.end.z }
  }
  if (current.x !== riserPlan.x || current.z !== riserPlan.z) {
    throw new Error(`Path for fixture ${fixtureExpressId} does not reach the riser`)
  }
  return path
}

describe('computeBranchRoutes', () => {
  it('routes a single fixture through one bend at the deterministic corner (riser.x, fixture.z)', () => {
    const riserPlan = { x: 0, z: 0 }
    const floors = computeBranchRoutes([assigned(1, { x: 3, z: 4 }, riserPlan)])

    expect(floors).toHaveLength(1)
    expect(floors[0].storeyId).toBe(101)
    expect(floors[0].planUnits).toBe('m')

    const segments = floors[0].segments
    expect(segments).toHaveLength(2)

    const [xLeg, zLeg] = segments
    expect(xLeg).toMatchObject({
      axis: 'x',
      kind: 'fixture-branch',
      servedFixtureExpressIds: [1],
      riserId: 'riser-1',
      riserStackId: 'stack-1',
    })
    expect(xLeg.start).toMatchObject({ x: 3, z: 4 })
    expect(xLeg.end).toMatchObject({ x: 0, z: 4 })
    expect(xLeg.start.elevation).toBeCloseTo(SLOPE * 7, 10)
    expect(xLeg.end.elevation).toBeCloseTo(SLOPE * 4, 10)

    expect(zLeg.axis).toBe('z')
    expect(zLeg.start).toMatchObject({ x: 0, z: 4 })
    expect(zLeg.end).toMatchObject({ x: 0, z: 0 })
    expect(zLeg.start.elevation).toBeCloseTo(SLOPE * 4, 10)
    expect(zLeg.end.elevation).toBe(0)
  })

  it('emits a single straight segment when fixture and riser share an axis', () => {
    const floors = computeBranchRoutes([assigned(1, { x: 5, z: 0 }, { x: 0, z: 0 })])

    expect(floors[0].segments).toHaveLength(1)
    const [segment] = floors[0].segments
    expect(segment.axis).toBe('x')
    expect(segment.start).toMatchObject({ x: 5, z: 0 })
    expect(segment.end).toMatchObject({ x: 0, z: 0 })
    expect(segment.start.elevation).toBeCloseTo(SLOPE * 5, 10)
    expect(segment.end.elevation).toBe(0)
  })

  it('emits no segments for a fixture exactly at the riser position', () => {
    const floors = computeBranchRoutes([assigned(1, { x: 2, z: 3 }, { x: 2, z: 3 })])

    expect(floors).toHaveLength(1)
    expect(floors[0].segments).toHaveLength(0)
  })

  it('drops elevation toward the riser at 2% of run length on every segment', () => {
    const riserPlan = { x: 0, z: 0 }
    const grid: AssignedFixture[] = []
    let id = 1
    for (const x of [-4, 2, 6]) {
      for (const z of [1, 3, 5]) {
        grid.push(assigned(id++, { x, z }, riserPlan))
      }
    }

    const floors = computeBranchRoutes(grid)
    const segments = floors[0].segments
    expect(segments.length).toBeGreaterThan(0)

    for (const segment of segments) {
      const drop = segment.start.elevation - segment.end.elevation
      expect(drop).toBeGreaterThan(0)
      expect(drop).toBeCloseTo(SLOPE * planLength(segment), 10)
    }

    for (const fixture of grid) {
      const path = walkPathToRiser(segments, fixture.fixtureExpressId, fixture.fixturePlan, riserPlan)
      expect(path.length).toBeGreaterThan(0)
      const elevations = [path[0].start.elevation, ...path.map((segment) => segment.end.elevation)]
      for (let i = 1; i < elevations.length; i++) {
        expect(elevations[i]).toBeLessThan(elevations[i - 1])
      }
      expect(elevations[elevations.length - 1]).toBe(0)
    }
  })

  it('merges shared approach corridors into trunk segments serving every upstream fixture', () => {
    // Both fixtures share the X corridor on z=6 and the full Z approach on x=0.
    const riserPlan = { x: 0, z: 0 }
    const floors = computeBranchRoutes([
      assigned(1, { x: 4, z: 6 }, riserPlan),
      assigned(2, { x: 8, z: 6 }, riserPlan),
    ])

    const segments = floors[0].segments
    // Unmerged L-runs would need 4 segments; the shared corridors merge into 3.
    expect(segments).toHaveLength(3)

    const outerX = segments.find((s) => s.axis === 'x' && s.start.x === 8)
    const trunkX = segments.find((s) => s.axis === 'x' && s.start.x === 4)
    const trunkZ = segments.find((s) => s.axis === 'z')

    expect(outerX).toMatchObject({ kind: 'fixture-branch', servedFixtureExpressIds: [2] })
    expect(outerX?.end).toMatchObject({ x: 4, z: 6 })

    expect(trunkX).toMatchObject({ kind: 'trunk', servedFixtureExpressIds: [1, 2] })
    expect(trunkX?.end).toMatchObject({ x: 0, z: 6 })

    expect(trunkZ).toMatchObject({ kind: 'trunk', servedFixtureExpressIds: [1, 2] })
    expect(trunkZ?.start).toMatchObject({ x: 0, z: 6 })
    expect(trunkZ?.end).toMatchObject({ x: 0, z: 0 })

    // Elevations are continuous across the bend into the shared trunk.
    expect(trunkX?.end.elevation).toBeCloseTo(trunkZ?.start.elevation ?? NaN, 10)
    expect(trunkZ?.start.elevation).toBeCloseTo(SLOPE * 6, 10)
  })

  it('splits merged runs where an upstream fixture joins, keeping served sets constant', () => {
    const riserPlan = { x: 0, z: 5 }
    const floors = computeBranchRoutes([
      assigned(1, { x: 10, z: 5 }, riserPlan),
      assigned(2, { x: 6, z: 5 }, riserPlan),
    ])

    const segments = floors[0].segments
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ kind: 'fixture-branch', servedFixtureExpressIds: [1] })
    expect(segments[0].start).toMatchObject({ x: 10, z: 5 })
    expect(segments[0].end).toMatchObject({ x: 6, z: 5 })
    expect(segments[1]).toMatchObject({ kind: 'trunk', servedFixtureExpressIds: [1, 2] })
    expect(segments[1].start).toMatchObject({ x: 6, z: 5 })
    expect(segments[1].end).toMatchObject({ x: 0, z: 5 })
  })

  it('snaps plan coordinates to 1 mm so floating-point noise neither splits a shared corridor nor emits zero-length segments', () => {
    // Real-model shape: six WCs in a row whose extracted Z differs by ~4e-14 m
    // (matrix noise). Without the snap every WC gets its own X leg and the Z
    // approach splits into five ~1e-14 m segments — which the IFC export
    // rejects as zero-length.
    const rowZ = -4.8906744325591145
    const riserPlan = { x: 9.549999999999999, z: rowZ + 1.2 }
    const floors = computeBranchRoutes(
      [0, 1, 2, 3, 4, 5].map((i) =>
        assigned(100 + i, { x: 11.79875592707247 - 0.9 * i, z: rowZ + i * 4.1e-14 }, riserPlan),
      ),
    )

    const segments = floors[0].segments
    // One X corridor split at every WC (6 segments) plus one straight Z approach.
    expect(segments).toHaveLength(7)
    expect(segments.filter((s) => s.axis === 'x')).toHaveLength(6)
    expect(segments.filter((s) => s.axis === 'z')).toHaveLength(1)
    for (const segment of segments) {
      expect(planLength(segment)).toBeGreaterThanOrEqual(0.001 - 1e-9)
    }
    const trunkZ = segments.find((s) => s.axis === 'z')
    expect(trunkZ).toMatchObject({ kind: 'trunk', servedFixtureExpressIds: [100, 101, 102, 103, 104, 105] })
    // Snapped coordinates are exact millimetres and never -0.
    for (const segment of segments) {
      for (const point of [segment.start, segment.end]) {
        expect(Math.abs(point.x * 1000 - Math.round(point.x * 1000))).toBeLessThan(1e-6)
        expect(Math.abs(point.z * 1000 - Math.round(point.z * 1000))).toBeLessThan(1e-6)
        expect(Object.is(point.x, -0) || Object.is(point.z, -0)).toBe(false)
      }
    }
    // A fixture within 1 mm of the riser snaps onto it and yields no segments.
    const atRiser = computeBranchRoutes([assigned(7, { x: 0.0004, z: -0.0004 }, { x: 0, z: 0 })])
    expect(atRiser[0].segments).toHaveLength(0)
  })

  it('does not merge approaches flowing from opposite sides of the riser', () => {
    const riserPlan = { x: 0, z: 0 }
    const floors = computeBranchRoutes([
      assigned(1, { x: 4, z: 0 }, riserPlan),
      assigned(2, { x: -4, z: 0 }, riserPlan),
    ])

    const segments = floors[0].segments
    expect(segments).toHaveLength(2)
    for (const segment of segments) {
      expect(segment.kind).toBe('fixture-branch')
      expect(segment.servedFixtureExpressIds).toHaveLength(1)
    }
  })

  it('handles mm-scale coordinates with detected units and mm-scale elevations', () => {
    const riserPlan = { x: 0, z: 0 }
    const floors = computeBranchRoutes([assigned(1, { x: 3000, z: 4000 }, riserPlan)])

    expect(floors[0].planUnits).toBe('mm')
    const [xLeg, zLeg] = floors[0].segments
    expect(xLeg.start.elevation).toBeCloseTo(SLOPE * 7000, 8) // 140 mm over a 7000 mm run
    expect(zLeg.end.elevation).toBe(0)
  })

  it('respects an explicit planUnits option over magnitude detection', () => {
    const floors = computeBranchRoutes(
      [assigned(1, { x: 900, z: 400 }, { x: 0, z: 0 })],
      { planUnits: 'mm' },
    )

    expect(floors[0].planUnits).toBe('mm')
  })

  it('groups output per storey and per riser deterministically', () => {
    const upper = { riserId: 'riser-b', riserStackId: 'stack-b', storeyId: 202 }
    const input = [
      assigned(4, { x: 1, z: 2 }, { x: 0, z: 0 }, upper),
      assigned(3, { x: 5, z: 5 }, { x: 4, z: 4 }, { riserId: 'riser-a', riserStackId: undefined }),
      assigned(1, { x: 2, z: 1 }, { x: 0, z: 0 }),
      assigned(2, { x: 3, z: 3 }, { x: 0, z: 0 }),
    ]

    const floors = computeBranchRoutes(input)

    expect(floors.map((floor) => floor.storeyId)).toEqual([101, 202])
    const [lowerFloor, upperFloor] = floors
    const riserIds = [...new Set(lowerFloor.segments.map((segment) => segment.riserId))]
    expect(riserIds).toEqual(['riser-1', 'riser-a'])
    expect(lowerFloor.segments.every((segment, i, all) =>
      i === 0 || all[i - 1].riserId.localeCompare(segment.riserId) <= 0)).toBe(true)
    expect(upperFloor.segments.every((segment) => segment.riserId === 'riser-b')).toBe(true)
    expect(upperFloor.segments.every((segment) => segment.riserStackId === 'stack-b')).toBe(true)

    const shuffled = [input[2], input[0], input[3], input[1]]
    expect(computeBranchRoutes(shuffled)).toEqual(floors)
  })

  it('throws on conflicting plan positions for the same riser on one storey', () => {
    expect(() => computeBranchRoutes([
      assigned(1, { x: 1, z: 1 }, { x: 0, z: 0 }),
      assigned(2, { x: 2, z: 2 }, { x: 0, z: 1 }),
    ])).toThrow('Conflicting plan positions for riser riser-1 on storey 101')
  })
})

describe('computeBranchRoutes with row collectors (office, G3)', () => {
  // Riser at the origin; a WC row of four along x at z = 5 (x 2, 3, 4, 5),
  // collector 0.3 m behind the row (z 5.3, the +z "wall" side).
  const riserPlan = { x: 0, z: 0 }
  const rowInput = [
    assigned(11, { x: 2, z: 5 }, riserPlan),
    assigned(12, { x: 3, z: 5 }, riserPlan),
    assigned(13, { x: 4, z: 5 }, riserPlan),
    assigned(14, { x: 5, z: 5 }, riserPlan),
  ]
  const row = { id: 'row:core:TOILETPAN:x:0', storeyId: 101, axis: 'x' as const, collectorLineCoord: 5.3, memberExpressIds: [11, 12, 13, 14] }

  it('is byte-identical to the plain routing when no rows are passed', () => {
    expect(computeBranchRoutes(rowInput, { rowCollectors: [] })).toEqual(computeBranchRoutes(rowInput))
    const plain = computeBranchRoutes(rowInput)[0].segments
    expect(plain.every((segment) => !('role' in segment) && !('rowId' in segment))).toBe(true)
  })

  it('routes stubs → collector → one run to the riser, with roles, diameters and served sets', () => {
    const [floor] = computeBranchRoutes(rowInput, { rowCollectors: [row] })
    const segments = floor.segments

    const stubs = segments.filter((segment) => segment.role === 'row-stub')
    const collectors = segments.filter((segment) => segment.role === 'row-collector')
    const runs = segments.filter((segment) => segment.role === 'collector-run')
    expect(stubs).toHaveLength(4)
    expect(collectors).toHaveLength(3)
    expect(runs).toHaveLength(2)
    expect(segments).toHaveLength(9)

    for (const stub of stubs) {
      expect(stub.axis).toBe('z')
      expect(stub.kind).toBe('fixture-branch')
      expect(stub.rowId).toBe(row.id)
      expect(stub.start.z).toBe(5)
      expect(stub.end.z).toBeCloseTo(5.3, 9)
      expect(planLength(stub)).toBeCloseTo(0.3, 9)
      expect(stub.diameterMm).toBe(110)
    }

    // Collector end = row extreme nearest the riser along x → x = 2. Flow 5 → 2.
    expect(collectors.map((segment) => [segment.start.x, segment.end.x, segment.servedFixtureExpressIds])).toEqual([
      [5, 4, [14]],
      [4, 3, [13, 14]],
      [3, 2, [12, 13, 14]],
    ])
    for (const collector of collectors) {
      expect(collector.axis).toBe('x')
      expect(collector.start.z).toBeCloseTo(5.3, 9)
      expect(collector.rowId).toBe(row.id)
      expect(collector.diameterMm).toBe(110)
    }
    expect(collectors.reduce((sum, segment) => sum + planLength(segment), 0)).toBeCloseTo(3, 9)

    // ONE L-run from (2, 5.3): X leg to x = 0 at z = 5.3, then Z leg down to the riser.
    const [xRun, zRun] = runs
    expect(xRun.axis).toBe('x')
    expect([xRun.start.x, xRun.start.z, xRun.end.x, xRun.end.z].map((v) => Number(v.toFixed(9)))).toEqual([2, 5.3, 0, 5.3])
    expect(zRun.axis).toBe('z')
    expect([zRun.start.x, zRun.start.z, zRun.end.x, zRun.end.z].map((v) => Number(v.toFixed(9)))).toEqual([0, 5.3, 0, 0])
    for (const run of runs) {
      expect(run.kind).toBe('trunk')
      expect(run.servedFixtureExpressIds).toEqual([11, 12, 13, 14])
      expect(run.diameterMm).toBe(110)
      expect(run.rowId).toBeUndefined()
    }

    // Every member still walks to the riser along served segments; the end member skips the collector.
    for (const member of rowInput) {
      const path = walkPathToRiser(segments, member.fixtureExpressId, member.fixturePlan, riserPlan)
      expect(path[0].role).toBe('row-stub')
      expect(path[path.length - 1].role).toBe('collector-run')
    }
    expect(walkPathToRiser(segments, 11, { x: 2, z: 5 }, riserPlan)).toHaveLength(3)
    expect(walkPathToRiser(segments, 14, { x: 5, z: 5 }, riserPlan)).toHaveLength(6)

    // Slope datum: the riser end is 0; the far WC's stub start is the highest point.
    expect(zRun.end.elevation).toBe(0)
    const farStub = stubs.find((segment) => segment.start.x === 5)!
    expect(farStub.start.elevation).toBeCloseTo(SLOPE * (0.3 + 3 + 2 + 5.3), 9)
    // Elevations are continuous through junctions.
    expect(collectors[0].start.elevation).toBeCloseTo(farStub.end.elevation, 9)
    expect(xRun.start.elevation).toBeCloseTo(collectors[2].end.elevation, 9)

    // Ids are dense and deterministic.
    expect(segments.map((segment) => segment.id)).toEqual(segments.map((_, i) => `branch-seg|101|riser-1|${i}`))
  })

  it('shares the collector run corridor with non-row fixtures and marks it collector-run', () => {
    const basin = assigned(21, { x: 0, z: 7 }, riserPlan, { fixtureKind: 'WASHHANDBASIN' })
    const [floor] = computeBranchRoutes([...rowInput, basin], { rowCollectors: [row] })
    const zLegs = floor.segments.filter((segment) => segment.axis === 'z' && segment.start.x === 0)
    // Basin enters at z 7, the row run at z 5.3: split into two segments on the same corridor.
    expect(zLegs.map((segment) => [segment.start.z, Number(segment.end.z.toFixed(9)), segment.servedFixtureExpressIds, segment.role])).toEqual([
      [7, 5.3, [21], 'collector-run'],
      [5.3, 0, [11, 12, 13, 14, 21], 'collector-run'],
    ])
    expect(zLegs[0].diameterMm).toBe(50)
    expect(zLegs[1].diameterMm).toBe(110)
  })

  it('picks the collector end nearest the riser and handles z-rows and a member at the end', () => {
    // z-row at x = 10 (z 1..3), riser at (10, 6): the end is alongMax (z 3), flow +z.
    const riser = { x: 10, z: 6 }
    const input = [assigned(1, { x: 10, z: 1 }, riser), assigned(2, { x: 10, z: 2 }, riser), assigned(3, { x: 10, z: 3 }, riser)]
    const zRow = { id: 'row:z', storeyId: 101, axis: 'z' as const, collectorLineCoord: 9.7, memberExpressIds: [1, 2, 3] }
    const [floor] = computeBranchRoutes(input, { rowCollectors: [zRow] })
    const collectors = floor.segments.filter((segment) => segment.role === 'row-collector')
    expect(collectors.map((segment) => [segment.start.z, segment.end.z, segment.servedFixtureExpressIds])).toEqual([
      [1, 2, [1]],
      [2, 3, [1, 2]],
    ])
    expect(collectors.every((segment) => Math.abs(segment.start.x - 9.7) < 1e-9)).toBe(true)
    const runs = floor.segments.filter((segment) => segment.role === 'collector-run')
    // From (9.7, 3) to (10, 6): the riser lies beyond the row along z, so the run
    // continues along z on the collector line first, then turns to x at z = 6.
    expect(runs.map((segment) => [segment.axis, Number(segment.start.x.toFixed(3)), segment.start.z, Number(segment.end.x.toFixed(3)), segment.end.z])).toEqual([
      ['x', 9.7, 6, 10, 6],
      ['z', 9.7, 3, 9.7, 6],
    ])
    expect(runs.every((segment) => segment.servedFixtureExpressIds.join() === '1,2,3')).toBe(true)
    for (const member of input) walkPathToRiser(floor.segments, member.fixtureExpressId, member.fixturePlan, riser)
  })

  it('turns perpendicular first when the riser sits within the row extent', () => {
    // x-row x 2..5 at z 5, collector at z 5.3, riser at (3.5, 8) beyond the collector: end = x 2 (tie → min).
    const riser = { x: 3.5, z: 8 }
    const input = rowInput.map((entry) => ({ ...entry, riserPlan: riser }))
    const [floor] = computeBranchRoutes(input, { rowCollectors: [row] })
    const runs = floor.segments.filter((segment) => segment.role === 'collector-run')
    expect(runs.map((segment) => [segment.axis, Number(segment.start.x.toFixed(3)), Number(segment.start.z.toFixed(3)), Number(segment.end.x.toFixed(3)), Number(segment.end.z.toFixed(3))])).toEqual([
      ['x', 2, 8, 3.5, 8],
      ['z', 2, 5.3, 2, 8],
    ])
    for (const member of input) walkPathToRiser(floor.segments, member.fixtureExpressId, member.fixturePlan, riser)
  })

  it('routes row members individually when fewer than two of them are in the riser group, and ignores other storeys', () => {
    const otherRiser = assigned(14, { x: 5, z: 5 }, { x: 9, z: 9 }, { riserId: 'riser-2', riserStackId: 'stack-2' })
    const input = [rowInput[0], rowInput[1], rowInput[2], otherRiser]
    const [floor] = computeBranchRoutes(input, { rowCollectors: [row] })
    const riser2 = floor.segments.filter((segment) => segment.riserId === 'riser-2')
    expect(riser2.every((segment) => segment.role === undefined)).toBe(true)
    expect(riser2.every((segment) => segment.servedFixtureExpressIds.join() === '14')).toBe(true)
    const riser1 = floor.segments.filter((segment) => segment.riserId === 'riser-1')
    expect(riser1.filter((segment) => segment.role === 'row-stub')).toHaveLength(3)

    const otherStoreyRow = { ...row, storeyId: 999 }
    expect(computeBranchRoutes(rowInput, { rowCollectors: [otherStoreyRow] })).toEqual(computeBranchRoutes(rowInput))
  })

  it('is deterministic regardless of input order and works in mm', () => {
    const forward = computeBranchRoutes(rowInput, { rowCollectors: [row] })
    const shuffled = computeBranchRoutes([rowInput[2], rowInput[0], rowInput[3], rowInput[1]], { rowCollectors: [row] })
    expect(shuffled).toEqual(forward)

    const mmInput = rowInput.map((entry) => ({
      ...entry,
      fixturePlan: { x: entry.fixturePlan.x * 1000, z: entry.fixturePlan.z * 1000 },
      riserPlan: { x: 0, z: 0 },
    }))
    const [mmFloor] = computeBranchRoutes(mmInput, { rowCollectors: [{ ...row, collectorLineCoord: 5300 }] })
    expect(mmFloor.planUnits).toBe('mm')
    expect(mmFloor.segments.filter((segment) => segment.role === 'row-stub').every((segment) => planLength(segment) === 300)).toBe(true)
  })
})

describe('computeBranchRoutes with core collectors (R1)', () => {
  // Receiving stack at the origin; the gathered core (fixtures 5 and 6) meets
  // at its junction (6, 2) and drains through one collector run to the stack.
  const riserPlan = { x: 0, z: 0 }
  const collector = { id: 'core-collector|wet-core:101:5+6', storeyId: 101, junction: { x: 6, z: 2 }, memberExpressIds: [5, 6] }
  const input: AssignedFixture[] = [
    assigned(1, { x: 1, z: 0 }, riserPlan), // the receiving core's own fixture
    assigned(5, { x: 7, z: 3 }, riserPlan),
    assigned(6, { x: 6, z: 2 }, riserPlan), // exactly at the junction: no leg of its own
  ]

  it('is byte-identical to the plain routing when no collectors are passed', () => {
    expect(computeBranchRoutes(input, { coreCollectors: [] })).toEqual(computeBranchRoutes(input))
  })

  it('runs every member to the junction, then ONE collector-run to the stack carrying them all, tagged with the collector id', () => {
    const [floor] = computeBranchRoutes(input, { coreCollectors: [collector] })
    const run = floor.segments.filter((segment) => segment.role === 'collector-run')
    const legs = floor.segments.filter((segment) => segment.role === undefined)

    // Junction (6, 2) → stack (0, 0): X-leg along z = 2 then Z-leg along x = 0.
    expect(run.map((segment) => [segment.axis, segment.start.x, segment.start.z, segment.end.x, segment.end.z])).toEqual([
      ['x', 6, 2, 0, 2],
      ['z', 0, 2, 0, 0],
    ])
    expect(run.every((segment) => segment.coreCollectorId === collector.id)).toBe(true)
    expect(run.every((segment) => segment.servedFixtureExpressIds.join() === '5,6')).toBe(true)
    expect(run.reduce((sum, segment) => sum + planLength(segment), 0)).toBe(8) // Manhattan junction → stack

    // Fixture 5 (7, 3) → junction (6, 2) with the plain corner rule (junction.x, fixture.z);
    // fixture 6 sits at the junction and adds nothing; fixture 1 routes directly.
    expect(legs.map((segment) => [segment.servedFixtureExpressIds.join(), segment.axis, segment.start.x, segment.start.z, segment.end.x, segment.end.z])).toEqual([
      ['1', 'x', 1, 0, 0, 0],
      ['5', 'x', 7, 3, 6, 3],
      ['5', 'z', 6, 3, 6, 2],
    ])
    expect(legs.every((segment) => segment.coreCollectorId === undefined)).toBe(true)

    // The slope datum is the stack: fixture 5's first leg starts 1 + 1 + 8 = 10 m of run above it.
    const fixture5Start = legs.find((segment) => segment.servedFixtureExpressIds.join() === '5')!
    expect(fixture5Start.start.elevation).toBeCloseTo(SLOPE * 10, 10)
    const runEnd = run.find((segment) => segment.axis === 'z')!
    expect(runEnd.end.elevation).toBe(0)
    // Ø110 as soon as a WC is served.
    expect(run.every((segment) => segment.diameterMm === 110)).toBe(true)
  })

  it('ignores collectors of other storeys and members outside the riser group, and is order-independent', () => {
    const otherStorey = { ...collector, id: 'core-collector|other', storeyId: 202 }
    expect(computeBranchRoutes(input, { coreCollectors: [otherStorey] })).toEqual(computeBranchRoutes(input))

    const strangers = { ...collector, memberExpressIds: [77, 78] }
    expect(computeBranchRoutes(input, { coreCollectors: [strangers] })).toEqual(computeBranchRoutes(input))

    const forward = computeBranchRoutes(input, { coreCollectors: [collector] })
    const shuffled = computeBranchRoutes([input[2], input[0], input[1]], { coreCollectors: [collector] })
    expect(shuffled).toEqual(forward)
  })

  it('a collector never leaves a stack on a blocked cell: no segment starts or ends off the fixtures / junction / stack', () => {
    const [floor] = computeBranchRoutes(input, { coreCollectors: [collector] })
    const known = new Set(['7,3', '6,3', '6,2', '0,2', '0,0', '1,0'])
    for (const segment of floor.segments) {
      expect(known.has(`${segment.start.x},${segment.start.z}`)).toBe(true)
      expect(known.has(`${segment.end.x},${segment.end.z}`)).toBe(true)
    }
  })
})
