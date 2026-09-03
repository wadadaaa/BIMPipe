import { describe, expect, it } from 'vitest'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import { groupBranchRunsByStack, summarizeBranchRunsForDebug } from './branchRouteSummary'

function segment(overrides: Partial<RouteSegment> & Pick<RouteSegment, 'id' | 'riserId'>): RouteSegment {
  return {
    start: { x: 0, z: 0, elevation: 0 },
    end: { x: 0, z: 0, elevation: 0 },
    axis: 'x',
    kind: 'fixture-branch',
    servedFixtureExpressIds: [],
    diameterMm: 50,
    ...overrides,
  }
}

const floor: FloorRoutes = {
  storeyId: 7,
  planUnits: 'mm',
  segments: [
    segment({
      id: 'a0',
      riserId: 'r10',
      riserStackId: 'stack-10',
      start: { x: 0, z: 0, elevation: 20 },
      end: { x: 1000, z: 0, elevation: 0 },
      servedFixtureExpressIds: [1],
      diameterMm: 110,
    }),
    segment({
      id: 'b0',
      riserId: 'r2',
      riserStackId: 'stack-2',
      start: { x: 0, z: 0, elevation: 60 },
      end: { x: 0, z: 3000, elevation: 0 },
      axis: 'z',
      kind: 'trunk',
      servedFixtureExpressIds: [3, 2],
      diameterMm: 63,
    }),
    segment({
      id: 'b1',
      riserId: 'r2',
      riserStackId: 'stack-2',
      start: { x: 500, z: 0, elevation: 70 },
      end: { x: 0, z: 0, elevation: 60 },
      servedFixtureExpressIds: [3],
      diameterMm: 50,
    }),
  ],
}

describe('groupBranchRunsByStack', () => {
  it('groups segments per stack with metres, distinct fixtures/diameters and natural label order', () => {
    const groups = groupBranchRunsByStack(
      floor,
      new Map([
        ['r10', 'R10'],
        ['r2', 'R2'],
      ]),
    )

    expect(groups).toEqual([
      {
        stackId: 'stack-2',
        stackLabel: 'R2',
        riserId: 'r2',
        segmentCount: 2,
        fixtureExpressIds: [2, 3],
        totalLengthM: 3.5,
        diametersMm: [50, 63],
        slopePercent: 2,
      },
      {
        stackId: 'stack-10',
        stackLabel: 'R10',
        riserId: 'r10',
        segmentCount: 1,
        fixtureExpressIds: [1],
        totalLengthM: 1,
        diametersMm: [110],
        slopePercent: 2,
      },
    ])
  })

  it('falls back to the riser id when no label is known', () => {
    const groups = groupBranchRunsByStack(floor, new Map())
    expect(groups.map((group) => group.stackLabel)).toEqual(['r10', 'r2'])
  })
})

describe('summarizeBranchRunsForDebug', () => {
  it('reports unrouted and over-length fixtures and how assignments were chosen', () => {
    const assignments: FixtureRiserAssignment[] = [
      {
        fixtureExpressId: 1,
        kind: 'TOILETPAN',
        storeyId: 7,
        unassigned: false,
        riserId: 'r10',
        stackId: 'stack-10',
        fixturePosition: { x: 0, y: 0, z: 0 },
        riserPosition: { x: 1000, y: 0, z: 0 },
        planDistance: 1000,
        units: 'mm',
        assignedBy: 'wet-core',
        exceedsMaxBranchLength: false,
      },
      {
        fixtureExpressId: 2,
        kind: 'BATH',
        storeyId: 7,
        unassigned: false,
        riserId: 'r2',
        stackId: 'stack-2',
        fixturePosition: { x: 0, y: 0, z: 0 },
        riserPosition: { x: 0, y: 0, z: 5200 },
        planDistance: 5200,
        units: 'mm',
        assignedBy: 'wet-core',
        exceedsMaxBranchLength: true,
      },
      {
        fixtureExpressId: 3,
        kind: 'SINK',
        storeyId: 7,
        unassigned: false,
        riserId: 'r2',
        stackId: 'stack-2',
        fixturePosition: { x: 0, y: 0, z: 0 },
        riserPosition: { x: 0, y: 0, z: 500 },
        planDistance: 500,
        units: 'mm',
        assignedBy: 'nearest',
        exceedsMaxBranchLength: false,
      },
      {
        fixtureExpressId: 9,
        kind: 'URINAL',
        storeyId: 7,
        unassigned: true,
        fixturePosition: { x: 0, y: 0, z: 0 },
        reason: 'no-riser-within-branch-length',
      },
    ]

    const summary = summarizeBranchRunsForDebug([floor], assignments)

    expect(summary.floors).toHaveLength(1)
    expect(summary.floors[0]).toMatchObject({ storeyId: 7, segmentCount: 3, totalLengthM: 4.5 })
    expect(summary.unrouted).toEqual([
      { fixtureExpressId: 9, kind: 'URINAL', reason: 'no-riser-within-branch-length' },
    ])
    expect(summary.overlength).toEqual([
      { fixtureExpressId: 2, kind: 'BATH', stackId: 'stack-2', planDistanceM: 5.2 },
    ])
    expect(summary.assignedBy).toEqual({ wetCore: 2, nearest: 1 })
  })
})
