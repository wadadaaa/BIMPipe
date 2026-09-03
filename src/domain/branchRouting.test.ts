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
