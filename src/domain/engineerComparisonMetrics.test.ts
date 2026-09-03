import { describe, expect, it } from 'vitest'
import { computeEngineerComparison, type EngineerComparisonInput } from './engineerComparisonMetrics'
import type { EngineerPipeSegment, EngineerRiserStack } from './engineerPipes'
import type { FloorRoutes } from './branchRouting'
import type { FixtureRiserAssignment } from './assignFixturesToRisers'

function engineerStack(overrides: Partial<EngineerRiserStack> & { id: string }): EngineerRiserStack {
  return {
    xM: 0,
    yM: 0,
    storeys: [{ id: 100, name: 'Level A' }],
    diameterMm: 110,
    segmentExpressIds: [1],
    ...overrides,
  }
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
    engineerRisers: [],
    engineerSegments: [],
  }
}

describe('computeEngineerComparison', () => {
  it('produces explicit zeros/nulls for empty input — never NaN', () => {
    const report = computeEngineerComparison(emptyInput())

    expect(report.riserCounts).toEqual({ oursStacks: 0, oursPerFloorEntries: 0, engineerStacks: 0 })
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

  it('counts our stacks by distinct stackId and entries per floor', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      ourRisers: [
        { id: 'r1-a', stackId: 'stack-1', storeyId: 100, position: { x: 1, y: 0, z: 2 } },
        { id: 'r1-b', stackId: 'stack-1', storeyId: 200, position: { x: 1, y: 3, z: 2 } },
        { id: 'r2-a', stackId: 'stack-2', storeyId: 100, position: { x: 5, y: 0, z: 2 } },
      ],
    })

    expect(report.riserCounts.oursStacks).toBe(2)
    expect(report.riserCounts.oursPerFloorEntries).toBe(3)
  })

  it('computes mean nearest engineer distance in metres with mm-unit our risers', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'mm',
      ourRisers: [
        // Stack at plan (1 m, 2 m)
        { id: 'r1', stackId: 'stack-1', storeyId: 100, position: { x: 1000, y: 0, z: 2000 } },
        // Stack at plan (5 m, 2 m)
        { id: 'r2', stackId: 'stack-2', storeyId: 100, position: { x: 5000, y: 0, z: 2000 } },
      ],
      engineerRisers: [
        engineerStack({ id: 'engineer-riser-1', xM: 1, yM: 2 }), // distance 0 to stack-1
        engineerStack({ id: 'engineer-riser-2', xM: 5, yM: 5 }), // distance 3 to stack-2
      ],
    })

    // stack-1 nearest = 0, stack-2 nearest = 3 -> mean 1.5
    expect(report.meanNearestEngineerRiserDistanceM).toBeCloseTo(1.5, 10)
  })

  it('averages per-floor entries into one plan point per stack', () => {
    const report = computeEngineerComparison({
      ...emptyInput(),
      ourRiserUnits: 'm',
      ourRisers: [
        { id: 'r1-a', stackId: 'stack-1', storeyId: 100, position: { x: 1, y: 0, z: 2 } },
        { id: 'r1-b', stackId: 'stack-1', storeyId: 200, position: { x: 3, y: 3, z: 2 } },
      ],
      engineerRisers: [engineerStack({ id: 'engineer-riser-1', xM: 2, yM: 2 })],
    })

    // Stack mean plan point is (2, 2) -> distance 0.
    expect(report.meanNearestEngineerRiserDistanceM).toBeCloseTo(0, 10)
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
