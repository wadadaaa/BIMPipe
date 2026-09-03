import { describe, expect, it } from 'vitest'
import { computeEngineerComparison, type EngineerComparisonInput } from './engineerComparisonMetrics'
import type { EngineerPipeSegment, EngineerRiserStack } from './engineerPipes'
import type { FloorRoutes } from './branchRouting'
import type { FixtureRiserAssignment } from './assignFixturesToRisers'

function engineerStack(overrides: Partial<EngineerRiserStack> & { id: string }): EngineerRiserStack {
  const zMinM = overrides.zMinM ?? 0
  const zMaxM = overrides.zMaxM ?? 3
  return {
    systemClass: 'sanitary',
    xM: 0,
    yM: 0,
    zMinM,
    zMaxM,
    extentM: zMaxM - zMinM,
    storeys: [{ id: 100, name: 'Level A' }],
    spannedStoreyIds: [100],
    diameterMm: 110,
    segmentExpressIds: [1],
    ...overrides,
  }
}

function engineerRisers(
  overrides: Partial<EngineerComparisonInput['engineerRisers']> = {},
): EngineerComparisonInput['engineerRisers'] {
  return {
    sanitaryStacks: [],
    ventStacks: [],
    stubs: [],
    minStackExtentM: 3,
    minStackExtentSource: 'storey-pitch-median',
    ...overrides,
  }
}

/** Scope: our storey 100 vs engineer storey 100 whose band is [0, 3) m. */
const SCOPE_LEVEL_A: EngineerComparisonInput['storeyScope'] = {
  ourStoreyId: 100,
  engineerBandM: { storeyId: 100, bottomM: 0, topM: 3 },
}

function engineerSegment(expressId: number, lengthM: number | null): EngineerPipeSegment {
  return {
    expressId,
    name: `Pipe ${expressId}`,
    systemName: 'XX-GRV 1',
    storeyId: 100,
    storeyName: 'Level A',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 100, y: 0, z: 0 },
    endpointSource: 'extrusion-axis',
    outerDiameterMm: 110,
    lengthM,
    invertElevationM: null,
  }
}

function emptyInput(): EngineerComparisonInput {
  return {
    ourRisers: [],
    ourRiserUnits: 'm',
    ourBranchRoutes: [],
    ourAssignments: [],
    engineerRisers: engineerRisers(),
    storeyScope: null,
    engineerSegments: [],
  }
}

describe('computeEngineerComparison', () => {
  it('produces explicit zeros/nulls for empty input — never NaN', () => {
    const report = computeEngineerComparison(emptyInput())

    expect(report.riserCounts).toEqual({
      oursStacksTotal: 0,
      oursStacksOnStorey: null,
      oursPerFloorEntries: 0,
      engineerStacksTotal: 0,
      engineerStacksIntersectingStorey: null,
      engineerVentStacksTotal: 0,
      engineerVentStacksIntersectingStorey: null,
      engineerStubs: 0,
    })
    expect(report.engineerStackDefinition).toEqual({
      minStackExtentM: 3,
      minStackExtentSource: 'storey-pitch-median',
      storeyOverlapMinM: 0.1,
    })
    expect(report.storeyScope).toBeNull()
    expect(report.storeyScopeReason).toMatch(/no floor is open/i)
    expect(report.meanNearestEngineerRiserDistanceM).toBeNull()
    expect(report.branchLengths.oursTotalM).toBe(0)
    expect(report.branchLengths.engineerTotalM).toBeNull()
    expect(report.branchLengths.engineerSegmentsWithNullLength).toBe(0)
    expect(report.branchLengths.ratioOursToEngineer).toBeNull()
    expect(report.fixtures.oursAssignedCount).toBe(0)
    expect(report.fixtures.oursUnassignedCount).toBe(0)
    expect(report.fixtures.engineerConnectedCount).toBeNull()
    expect(report.fixtures.engineerConnectedNote).toContain('IfcRelConnectsPorts')
    expect(JSON.stringify(report)).not.toContain('NaN')
  })

  it('counts our stacks by distinct stackId model-wide, on the scoped storey, and entries per floor', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      storeyScope: { ourStoreyId: 200, engineerBandM: { storeyId: 200, bottomM: 3, topM: 6 } },
      ourRisers: [
        { id: 'r1-a', stackId: 'stack-1', storeyId: 100, position: { x: 1, y: 0, z: 2 } },
        { id: 'r1-b', stackId: 'stack-1', storeyId: 200, position: { x: 1, y: 3, z: 2 } },
        { id: 'r2-a', stackId: 'stack-2', storeyId: 100, position: { x: 5, y: 0, z: 2 } },
      ],
    })

    expect(report.riserCounts.oursStacksTotal).toBe(2)
    expect(report.riserCounts.oursStacksOnStorey).toBe(1)
    expect(report.riserCounts.oursPerFloorEntries).toBe(3)
  })

  it('computes mean nearest engineer distance in metres with mm-unit our risers', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'mm',
      storeyScope: SCOPE_LEVEL_A,
      ourRisers: [
        // Stack at plan (1 m, 2 m)
        { id: 'r1', stackId: 'stack-1', storeyId: 100, position: { x: 1000, y: 0, z: 2000 } },
        // Stack at plan (5 m, 2 m)
        { id: 'r2', stackId: 'stack-2', storeyId: 100, position: { x: 5000, y: 0, z: 2000 } },
      ],
      engineerRisers: engineerRisers({
        sanitaryStacks: [
          engineerStack({ id: 'engineer-riser-1', xM: 1, yM: 2 }), // distance 0 to stack-1
          engineerStack({ id: 'engineer-riser-2', xM: 5, yM: 5 }), // distance 3 to stack-2
        ],
      }),
    })

    // stack-1 nearest = 0, stack-2 nearest = 3 -> mean 1.5
    expect(report.meanNearestEngineerRiserDistanceM).toBeCloseTo(1.5, 10)
  })

  it('averages the scoped storey entries into one plan point per stack', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      storeyScope: SCOPE_LEVEL_A,
      ourRisers: [
        { id: 'r1-a', stackId: 'stack-1', storeyId: 100, position: { x: 2, y: 0, z: 2 } },
        // Entry on another storey does not enter the scoped plan point.
        { id: 'r1-b', stackId: 'stack-1', storeyId: 200, position: { x: 40, y: 3, z: 2 } },
      ],
      engineerRisers: engineerRisers({
        sanitaryStacks: [engineerStack({ id: 'engineer-riser-1', xM: 2, yM: 2 })],
      }),
    })

    expect(report.meanNearestEngineerRiserDistanceM).toBeCloseTo(0, 10)
  })

  it('uses only engineer stacks intersecting the scoped storey band for counts and distance', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      // Storey 100 band [0, 3).
      storeyScope: SCOPE_LEVEL_A,
      ourRisers: [{ id: 'r1', stackId: 'stack-1', storeyId: 100, position: { x: 0, y: 0, z: 0 } }],
      engineerRisers: engineerRisers({
        sanitaryStacks: [
          // Intersects the band, 4 m away.
          engineerStack({ id: 'engineer-riser-1', xM: 4, yM: 0, zMinM: 0, zMaxM: 15 }),
          // Closer (1 m) but its Z-range starts at storey 2: excluded from the storey comparison.
          engineerStack({ id: 'engineer-riser-2', xM: 1, yM: 0, zMinM: 3, zMaxM: 12 }),
        ],
        ventStacks: [
          engineerStack({ id: 'engineer-vent-1', systemClass: 'vent', xM: 0, yM: 0, zMinM: 0, zMaxM: 15 }),
          engineerStack({ id: 'engineer-vent-2', systemClass: 'vent', xM: 0, yM: 0, zMinM: 6, zMaxM: 15 }),
        ],
        stubs: [engineerStack({ id: 'engineer-stub-1', xM: 0, yM: 0, zMinM: 0.5, zMaxM: 0.9 })],
      }),
    })

    expect(report.riserCounts.engineerStacksTotal).toBe(2)
    expect(report.riserCounts.engineerStacksIntersectingStorey).toBe(1)
    expect(report.riserCounts.engineerVentStacksTotal).toBe(2)
    expect(report.riserCounts.engineerVentStacksIntersectingStorey).toBe(1)
    expect(report.riserCounts.engineerStubs).toBe(1)
    // Vent at distance 0 and stub are never candidates; riser-2 is out of the storey -> 4 m.
    expect(report.meanNearestEngineerRiserDistanceM).toBeCloseTo(4, 10)
    expect(report.storeyScope).toEqual({
      ourStoreyId: 100,
      engineerStoreyId: 100,
      engineerBandBottomM: 0,
      engineerBandTopM: 3,
    })
    expect(report.storeyScopeReason).toBeNull()
  })

  it('serialises an open-ended top band as null and keeps totals when the scope is unresolved', () => {
    const topBand = computeEngineerComparison({
      ...emptyInput(),
      storeyScope: { ourStoreyId: 5, engineerBandM: { storeyId: 55, bottomM: 12, topM: Infinity } },
      engineerRisers: engineerRisers({
        sanitaryStacks: [engineerStack({ id: 'engineer-riser-1', zMinM: 0, zMaxM: 20 })],
      }),
    })
    expect(topBand.storeyScope?.engineerBandTopM).toBeNull()
    expect(topBand.riserCounts.engineerStacksIntersectingStorey).toBe(1)
    expect(JSON.stringify(topBand)).not.toContain('Infinity')

    const unresolved = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      storeyScope: { ourStoreyId: 5, engineerBandM: null },
      ourRisers: [{ id: 'r1', stackId: 'stack-1', storeyId: 5, position: { x: 0, y: 0, z: 0 } }],
      engineerRisers: engineerRisers({
        sanitaryStacks: [engineerStack({ id: 'engineer-riser-1' })],
      }),
    })
    expect(unresolved.riserCounts.oursStacksTotal).toBe(1)
    expect(unresolved.riserCounts.oursStacksOnStorey).toBeNull()
    expect(unresolved.riserCounts.engineerStacksTotal).toBe(1)
    expect(unresolved.riserCounts.engineerStacksIntersectingStorey).toBeNull()
    expect(unresolved.meanNearestEngineerRiserDistanceM).toBeNull()
    expect(unresolved.storeyScope).toBeNull()
    expect(unresolved.storeyScopeReason).toMatch(/no counterpart storey/i)
  })

  it('sums our branch lengths per floor units and compares against engineer psets', () => {
    const routes: FloorRoutes[] = [
      {
        storeyId: 100,
        planUnits: 'mm',
        segments: [
          {
            id: 'branch-seg|100|r1|0',
            start: { x: 0, z: 0, elevation: 40 },
            end: { x: 2000, z: 0, elevation: 0 },
            axis: 'x',
            kind: 'fixture-branch',
            servedFixtureExpressIds: [1],
            riserId: 'r1',
          },
        ],
      },
      {
        storeyId: 200,
        planUnits: 'm',
        segments: [
          {
            id: 'branch-seg|200|r1|0',
            start: { x: 0, z: 3, elevation: 0.06 },
            end: { x: 0, z: 0, elevation: 0 },
            axis: 'z',
            kind: 'fixture-branch',
            servedFixtureExpressIds: [2],
            riserId: 'r1',
          },
        ],
      },
    ]

    const report = computeEngineerComparison({
      ...emptyInput(),
      ourBranchRoutes: routes,
      engineerSegments: [engineerSegment(1, 6), engineerSegment(2, 4), engineerSegment(3, null)],
    })

    // 2000 mm + 3 m = 5 m ours; engineer 6 + 4 = 10 m.
    expect(report.branchLengths.oursTotalM).toBeCloseTo(5, 10)
    expect(report.branchLengths.engineerTotalM).toBeCloseTo(10, 10)
    expect(report.branchLengths.engineerSegmentsWithNullLength).toBe(1)
    expect(report.branchLengths.ratioOursToEngineer).toBeCloseTo(0.5, 10)
  })

  it('returns a null ratio when the engineer total is zero (no Infinity)', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      engineerSegments: [engineerSegment(1, 0)],
    })
    expect(report.branchLengths.engineerTotalM).toBe(0)
    expect(report.branchLengths.ratioOursToEngineer).toBeNull()
  })

  it('counts assigned and unassigned fixtures', () => {
    const assignments: FixtureRiserAssignment[] = [
      {
        fixtureExpressId: 1,
        kind: 'TOILETPAN',
        storeyId: 100,
        unassigned: false,
        riserId: 'r1',
        stackId: 'stack-1',
        fixturePosition: { x: 0, y: 0, z: 0 },
        riserPosition: { x: 0, y: 0, z: 0 },
        planDistance: 0,
        units: 'm',
      },
      {
        fixtureExpressId: 2,
        kind: 'SINK',
        storeyId: 100,
        unassigned: true,
        fixturePosition: null,
        reason: 'no-plan-position',
      },
    ]

    const report = computeEngineerComparison({ ...emptyInput(), ourAssignments: assignments })
    expect(report.fixtures.oursAssignedCount).toBe(1)
    expect(report.fixtures.oursUnassignedCount).toBe(1)
  })

  it('is JSON-serialisable for the debug/Decisions display', () => {
    const report = computeEngineerComparison(emptyInput())
    expect(() => JSON.stringify(report)).not.toThrow()
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })
})
