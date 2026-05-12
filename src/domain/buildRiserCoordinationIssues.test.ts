import { describe, expect, it } from 'vitest'
import {
  buildRiserCoordinationIssues,
  RISER_COORDINATION_ISSUE_REASON_CODE,
} from './buildRiserCoordinationIssues'
import { RISER_STRATEGY_DECISION, type RiserStrategyDecision } from './decideRiserStrategyPerToiletRoom'

function makeDecision(overrides: Partial<RiserStrategyDecision> = {}): RiserStrategyDecision {
  return {
    decisionId: 'decision|g1|101|a1',
    groupId: 'g1',
    areaId: 'a1',
    storeyId: 101,
    decision: RISER_STRATEGY_DECISION.COORDINATION_REQUIRED,
    reasons: ['multiple stronger overlapping groups have equal strength; coordination required'],
    debug: { confidence: 0.8, overlapGroupIds: ['g2', 'g3'] },
    ...overrides,
  }
}

describe('buildRiserCoordinationIssues', () => {
  it('returns empty array when there are no COORDINATION_REQUIRED decisions', () => {
    const decisions: RiserStrategyDecision[] = [
      makeDecision({ decision: RISER_STRATEGY_DECISION.RISER_PLACED }),
      makeDecision({ decision: RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP }),
      makeDecision({ decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE }),
      makeDecision({ decision: RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER }),
      makeDecision({ decision: RISER_STRATEGY_DECISION.EXCLUDED_FLOOR }),
    ]

    expect(buildRiserCoordinationIssues(decisions)).toEqual([])
  })

  it('creates one coordination issue for an ambiguous overlapping/same-storey decision', () => {
    const [issue] = buildRiserCoordinationIssues([makeDecision()])

    expect(issue.reasonCode).toBe(RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP)
    expect(issue.recommendedAction).toBe('Choose the intended serving riser group or add an explicit coverage exception rule.')
  })

  it('creates one coordination issue for penthouse serving ambiguity', () => {
    const [issue] = buildRiserCoordinationIssues([
      makeDecision({ reasons: ['penthouse serving group is ambiguous; coordination required'] }),
    ])

    expect(issue.reasonCode).toBe(RISER_COORDINATION_ISSUE_REASON_CODE.PENTHOUSE_UNSERVED)
    expect(issue.recommendedAction).toBe(
      'Review penthouse toilet manually and either assign it to a lower riser group or create an explicit exception rule.',
    )
  })

  it('includes relatedGroupIds from debug.overlapGroupIds and references', () => {
    const [issue] = buildRiserCoordinationIssues([
      makeDecision({ coveredByGroupId: 'g9', servedByGroupId: 'g8', debug: { confidence: 0.8, overlapGroupIds: ['g2', 'g8'] } }),
    ])

    expect(issue.relatedGroupIds).toEqual(['g2', 'g8', 'g9'])
  })

  it('includes stable deterministic issueId', () => {
    const [issue] = buildRiserCoordinationIssues([makeDecision({ storeyId: 200, groupId: 'g-a', areaId: 'area-7' })])

    expect(issue.issueId).toBe('riser-coordination|200|g-a|area-7|AMBIGUOUS_SERVING_GROUP')
  })

  it('output ordering is stable regardless of input order', () => {
    const a = makeDecision({ decisionId: 'b', groupId: 'g2', areaId: 'a2', storeyId: 2, reasons: ['ambiguous'] })
    const b = makeDecision({ decisionId: 'a', groupId: 'g1', areaId: 'a1', storeyId: 1, reasons: ['penthouse serving group is ambiguous'] })

    const idsA = buildRiserCoordinationIssues([a, b]).map((issue) => issue.issueId)
    const idsB = buildRiserCoordinationIssues([b, a]).map((issue) => issue.issueId)

    expect(idsA).toEqual(idsB)
  })

  it('preserves original decision reasons in debug metadata', () => {
    const reasons = ['primary eligible member has ambiguous serving group; coordination required']
    const [issue] = buildRiserCoordinationIssues([makeDecision({ reasons })])

    expect(issue.debug.originalReasons).toEqual(reasons)
  })

  it('supports optional storey/area/fixture labels without making them required', () => {
    const [issue] = buildRiserCoordinationIssues(
      [makeDecision({ storeyId: 42, areaId: 'area-42' })],
      {
        storeyNameById: { 42: 'Level 42' },
        areaLabelById: new Map([['area-42', 'Toilet Room 42']]),
        fixtureLabelByAreaId: { 'area-42': 'WC-42' },
      },
    )

    expect(issue.storeyName).toBe('Level 42')
    expect(issue.areaLabel).toBe('Toilet Room 42')
    expect(issue.fixtureLabel).toBe('WC-42')
  })

  it('falls back to AMBIGUOUS_SERVING_GROUP when no specific reason is inferred', () => {
    const [issue] = buildRiserCoordinationIssues([makeDecision({ reasons: ['coordination required'] })])
    expect(issue.reasonCode).toBe(RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP)
  })
})
