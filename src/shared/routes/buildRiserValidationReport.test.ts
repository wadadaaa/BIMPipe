import { describe, expect, it } from 'vitest'
import { RISER_STRATEGY_DECISION, type RiserStrategyDecision } from '@/domain/decideRiserStrategyPerToiletRoom'
import type { Riser, Storey } from '@/domain/types'
import { buildRiserValidationReport } from './buildRiserValidationReport'

const STOREYS: Storey[] = [
  { id: 10, name: 'Basement', elevation: -3, modelId: 'm' },
  { id: 20, name: 'Level 1', elevation: 0, modelId: 'm' },
  { id: 30, name: 'Level 2', elevation: 3, modelId: 'm' },
  { id: 40, name: 'Roof', elevation: 6, modelId: 'm' },
]

const RISERS: Riser[] = [
  { id: 'r-2', stackId: 's-1', stackLabel: 'R1', storeyId: 30, position: { x: 1, y: 3, z: 1 } },
  { id: 'r-1', stackId: 's-1', stackLabel: 'R1', storeyId: 20, position: { x: 1, y: 0, z: 1 } },
]

function decision(overrides: Partial<RiserStrategyDecision>): RiserStrategyDecision {
  return {
    decisionId: 'd-1',
    groupId: 'g-1',
    areaId: 'a-1',
    storeyId: 20,
    decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    reasons: ['ok'],
    debug: { confidence: 1, overlapGroupIds: [] },
    ...overrides,
  }
}

describe('buildRiserValidationReport', () => {
  it('reports processed and skipped floors deterministically', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
    })

    expect(report.processedFloors.map((f) => f.storeyId)).toEqual([10, 20, 30, 40])
    expect(report.skippedFloors.map((f) => f.storeyId)).toEqual([10, 30, 40])
    expect(report.penthouseExceptionFloors.map((f) => f.storeyId)).toEqual([30])
  })


  it('exposes penthouse exception floors explicitly', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      floorClassifications: [
        { storeyId: 10, class: 'basement', confidence: 1, reasons: [] },
        { storeyId: 20, class: 'standard', confidence: 1, reasons: [] },
        { storeyId: 30, class: 'penthouse', confidence: 1, reasons: [] },
        { storeyId: 40, class: 'roof', confidence: 1, reasons: [] },
      ],
      risers: RISERS,
    })

    expect(report.penthouseExceptionFloors.map((f) => f.storeyId)).toEqual([30])
    expect(report.summary.penthouseExceptionFloorCount).toBe(1)
  })

  it('includes detected toilet fixtures and toilet-room summaries', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
      detectionAggregation: {
        floors: [],
        kitchensByStoreyId: {},
        fixturesByStoreyId: {
          20: [
            { expressId: 2002, name: 'WC-A', kind: 'TOILETPAN', storeyId: 20, position: null },
            { expressId: 2001, name: 'WC-B', kind: 'TOILETPAN', storeyId: 20, position: null },
          ],
        },
      },
    })

    expect(report.detectedFixtures.map((f) => f.expressId)).toEqual([2001, 2002])
    expect(report.detectedToiletRooms.map((t) => t.toiletRoomId)).toEqual([
      'toilet-room:20:2001',
      'toilet-room:20:2002',
    ])
  })

  it('separates existing vs newly added risers from decisions', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
      placementDecisions: [
        decision({ decisionId: 'd-2', decision: RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, coveredByGroupId: 'g-existing' }),
      ],
    })

    expect(report.newlyAddedRisers.map((r) => r.riserId)).toEqual(['r-1', 'r-2'])
    expect(report.existingRisers).toEqual([{ groupId: 'g-existing' }])
  })

  it('extracts reused groups and coordination issues deterministically', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
      placementDecisions: [
        decision({
          decisionId: 'd-4',
          decision: RISER_STRATEGY_DECISION.COORDINATION_REQUIRED,
          reasons: ['multiple stronger overlapping groups have equal strength; coordination required'],
          debug: { confidence: 0.5, overlapGroupIds: ['g-x', 'g-y'] },
        }),
        decision({ decisionId: 'd-3', decision: RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, coveredByGroupId: 'g-z' }),
      ],
    })

    expect(report.reusedRiserGroups).toEqual(['g-z'])
    expect(report.coordinationIssues).toHaveLength(1)
    expect(report.coordinationIssues[0]?.decisionId).toBe('d-4')
  })


  it('marks coordination-required and uncovered detected toilet rooms as unresolved', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
      detectionAggregation: {
        floors: [],
        kitchensByStoreyId: {},
        fixturesByStoreyId: {
          20: [
            { expressId: 2001, name: 'WC-A', kind: 'TOILETPAN', storeyId: 20, position: null },
            { expressId: 2002, name: 'WC-B', kind: 'TOILETPAN', storeyId: 20, position: null },
          ],
        },
      },
      placementDecisions: [
        decision({
          decisionId: 'd-7',
          areaId: 'toilet-room:20:2001',
          decision: RISER_STRATEGY_DECISION.COORDINATION_REQUIRED,
          reasons: ['coordination required'],
        }),
      ],
    })

    expect(report.unresolvedToiletRooms).toEqual([
      {
        toiletRoomId: 'toilet-room:20:2001',
        storeyId: 20,
        groupId: 'g-1',
        reasons: ['coordination required'],
      },
      {
        toiletRoomId: 'toilet-room:20:2002',
        storeyId: 20,
        groupId: null,
        reasons: ['detected toilet room has no placement decision'],
      },
    ])
  })

  it('emits missing detection aggregation warning without blocking report', () => {
    const report = buildRiserValidationReport({
      exportRunId: 'run-1',
      timestamp: '2026-05-12T00:00:00.000Z',
      sourceIfcName: 'a.ifc',
      storeys: STOREYS,
      risers: RISERS,
    })

    expect(report.validationIssues.map((issue) => issue.code)).toContain('DETECTION_AGGREGATION_MISSING')
  })
})
