import { describe, expect, it } from 'vitest'
import type { EngineerRiserStack } from '@/domain/engineerPipes'
import { computeGauntletMetrics } from '@/domain/gauntletMetrics'
import type { GauntletMetricsInput } from './gauntletFloorPipeline'
import { gauntletMetricsInputFromPipeline } from './gauntletMetricsInput'

function engineerStack(id: string, xM: number, yM: number, zMinM: number, zMaxM: number): EngineerRiserStack {
  return {
    id,
    systemClass: 'sanitary',
    xM,
    yM,
    zMinM,
    zMaxM,
    extentM: zMaxM - zMinM,
    storeys: [{ id: 41, name: '01' }],
    spannedStoreyIds: [41],
    diameterMm: 110,
    segmentExpressIds: [1],
  }
}

/** Minimal pipeline metrics input: storey 41 (band [3, 6) m), two of our stacks, three engineer stacks (one below the band). */
function pipelineInput(): GauntletMetricsInput {
  return {
    spec: {
      floor: 'synthetic',
      host: { path: 'x.ifc', fileName: 'x.ifc' },
      linked: [],
      storey: { name: '01' },
      storeyLabel: 'Storey 01',
      wholeBuildingExtent: true,
    },
    hostStorey: { id: 41, name: '01', elevationSource: 300 },
    storeyBandM: { bottomM: 3, topM: 6 },
    comparisonInput: {
      ourRisers: [
        { id: 'a-41', stackId: 'stack-a', storeyId: 41, position: { x: 0, y: 3, z: 0 } },
        { id: 'a-37', stackId: 'stack-a', storeyId: 37, position: { x: 0, y: 0, z: 0 } },
        { id: 'b-41', stackId: 'stack-b', storeyId: 41, position: { x: 10, y: 3, z: -5 } },
        { id: 'c-37', stackId: 'stack-c', storeyId: 37, position: { x: 50, y: 0, z: 50 } },
      ],
      ourRiserUnits: 'm',
      ourBranchRoutes: [],
      ourAssignments: [
        {
          fixtureExpressId: 1,
          kind: 'TOILETPAN',
          storeyId: 41,
          unassigned: false,
          riserId: 'a-41',
          stackId: 'stack-a',
          fixturePosition: { x: 1, y: 3, z: 0 },
          riserPosition: { x: 0, y: 3, z: 0 },
          planDistance: 1,
          units: 'm',
          assignedBy: 'wet-core',
          exceedsMaxBranchLength: false,
        },
        { fixtureExpressId: 2, kind: 'SINK', storeyId: 41, unassigned: true, fixturePosition: { x: 9, y: 3, z: 0 }, reason: 'no-riser-within-branch-length' },
        { fixtureExpressId: 3, kind: 'SINK', storeyId: 41, unassigned: true, fixturePosition: null, reason: 'no-plan-position' },
      ],
      engineerRisers: {
        sanitaryStacks: [
          engineerStack('e1', 1, 0, 0, 9), // intersects, 1 m from stack-a
          engineerStack('e2', 10, -2, 0, 9), // intersects, 3 m from stack-b
          engineerStack('e3', 10, -5, 0, 2.5), // below the band: excluded
        ],
        ventStacks: [],
        stubs: [],
        minStackExtentM: 3,
        minStackExtentSource: 'storey-pitch-median',
      },
      storeyScope: { ourStoreyId: 41, engineerBandM: { storeyId: 41, bottomM: 3, topM: 6 } },
      engineerSegments: [],
    },
    report: {
      riserCounts: {
        oursStacksTotal: 3,
        oursStacksOnStorey: 2,
        oursPerFloorEntries: 4,
        engineerStacksTotal: 3,
        engineerStacksIntersectingStorey: 2,
        engineerVentStacksTotal: 0,
        engineerVentStacksIntersectingStorey: 0,
        engineerStubs: 0,
      },
      engineerStackDefinition: { minStackExtentM: 3, minStackExtentSource: 'storey-pitch-median', storeyOverlapMinM: 0.1 },
      storeyScope: { ourStoreyId: 41, engineerStoreyId: 41, engineerBandBottomM: 3, engineerBandTopM: 6 },
      storeyScopeReason: null,
      meanNearestEngineerRiserDistanceM: 2,
      branchLengths: {
        scope: 'storey',
        oursTotalM: 7.5,
        oursSegmentCount: 3,
        engineerTotalM: 6,
        engineerSegmentCount: 2,
        engineerSegmentsWithNullLength: 0,
        ratioOursToEngineer: 1.25,
      },
      fixtures: { oursAssignedCount: 1, oursUnassignedCount: 2, engineerConnectedCount: null, engineerConnectedNote: '' },
    },
    engineerStoreyHorizontals: {
      hangDepthM: 1.2,
      inBand: 2,
      inHang: 4,
      both: 1,
      total: 5,
      literalBandSelection: { segments: 2, byGeometry: 2, byContainment: 0, byContainmentRejected: 0, byContainmentRejectedLengthM: 0 },
    },
    engineerStacks: { intersecting: 2, served: 2, passThrough: [], joinToleranceM: 0.5 },
    engineerBranchRuns: {
      literalBand: { segments: 2, byContainment: 0, totalM: 6 },
      union: { segments: 5, inBandOnly: 1, inHangOnly: 3, both: 1, totalM: 30 },
      hangBandRuns: [],
    },
    storeyBelow: { id: 37, name: 'GF', fixtures: 0 },
    cores: [],
    coreCollectors: [],
    continuityProbes: [
      { stackId: 'stack-a', stackLabel: 'R1', anchor: 'wet-core', position: { x: 0, y: 3, z: 0 }, placementRule: 'shaft', flagged: false, probe: { status: 'free', cell: { col: 1, row: 1 } } },
      { stackId: 'stack-b', stackLabel: 'R2', anchor: 'wet-core', position: { x: 10, y: 3, z: -5 }, placementRule: 'centroid', flagged: true, probe: { status: 'blocked', cell: { col: 4, row: 2 } } },
    ],
    fixtures: { merged: 3, byKind: { TOILETPAN: 1, SINK: 2 }, duplicates: 0 },
    timingsMs: {},
    diagnostics: [],
  }
}

describe('gauntletMetricsInputFromPipeline', () => {
  it('scopes our stacks to the host storey, engineer stacks to the band, and counts positioned/routed fixtures', () => {
    const input = gauntletMetricsInputFromPipeline(pipelineInput())
    expect(input.stackProbes).toEqual([
      { stackId: 'stack-a', stackLabel: 'R1', status: 'free' },
      { stackId: 'stack-b', stackLabel: 'R2', status: 'blocked' },
    ])
    // stack-a mean of its storey-41 entry only (the storey-37 entry is another floor), stack-c has no storey-41 entry.
    expect(input.ourStacks).toEqual([
      { xM: 0, yM: 0 },
      { xM: 10, yM: -5 },
    ])
    expect(input.engineerStacks).toEqual([
      { xM: 1, yM: 0 },
      { xM: 10, yM: -2 },
    ])
    expect(input.ourBranchTotalM).toBe(7.5)
    expect(input.engineerBranchTotalM).toEqual({ union: 30, literalBand: 6 })
    // Fixture 3 has no plan position: not "positioned"; fixture 2 is positioned but unrouted.
    expect(input.fixtures).toEqual({ positioned: 2, routed: 1 })

    const metrics = computeGauntletMetrics(input)
    expect(metrics.obstruction).toBe(1)
    expect(metrics.stacksRatio).toBe(1)
    expect(metrics.meanDistToEngineerStackM).toBeCloseTo(2, 6)
    expect(metrics.branchRatio).toBeCloseTo(0.25, 6)
    expect(metrics.branchRatioLiteralBand).toBeCloseTo(1.25, 6)
    expect(metrics.routedFraction).toBe(0.5)
    expect(metrics.verdict).toBe('red')
    expect(metrics.reds.map((line) => line.split(':')[0])).toEqual(['obstruction', 'branch length', 'routed'])
  })

  it('turns empty engineer sets into null totals and an empty engineer stack list without a band', () => {
    const base = pipelineInput()
    base.comparisonInput.storeyScope = null
    base.engineerBranchRuns.union = { segments: 0, inBandOnly: 0, inHangOnly: 0, both: 0, totalM: 0 }
    base.engineerBranchRuns.literalBand = { segments: 0, byContainment: 0, totalM: 0 }
    const input = gauntletMetricsInputFromPipeline(base)
    expect(input.engineerStacks).toEqual([])
    expect(input.engineerBranchTotalM).toEqual({ union: null, literalBand: null })
    // Without a storey scope our stacks fall back to the host storey.
    expect(input.ourStacks).toHaveLength(2)
  })
})
