import { describe, expect, it } from 'vitest'
import {
  decideRiserStrategyPerToiletRoom,
  RISER_STRATEGY_DECISION,
  type RiserCoverageExceptionRule,
} from './decideRiserStrategyPerToiletRoom'
import type { VerticalWetGroup } from './groupWetAreasVertically'
import type { Storey } from './types'

const group = (groupId: string, members: VerticalWetGroup['members'], confidence = 0.9): VerticalWetGroup => ({
  groupId,
  members,
  debug: { confidence, reasons: [] },
})

const member = (
  areaId: string,
  storeyId: number,
  eligibleForNewRisers: boolean,
  confidence = 0.9,
): VerticalWetGroup['members'][number] => ({
  areaId,
  storeyId,
  eligibleForNewRisers,
  overlapRatio: 1,
  centroidDistanceMeters: 0,
  planBounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
  debug: { confidence, reasons: [] },
})

const storey = (id: number, elevation: number): Storey => ({
  id,
  elevation,
  modelId: 'm1',
  name: `S${id}`,
})

const STOREYS = [storey(100, 0), storey(101, 3), storey(102, 6), storey(103, 9)]

describe('decideRiserStrategyPerToiletRoom BIM-11 exception coverage', () => {
  it('places a new riser on a standard eligible floor when no group or exception covers the toilet', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-new', [member('toilet-room-101', 101, true)]),
    ], { storeys: STOREYS })

    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      groupId: 'g-new',
      areaId: 'toilet-room-101',
      storeyId: 101,
      decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    })
  })

  it('does not place a new riser when an exception rule covers the eligible toilet room', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'manual-existing-riser-A',
      areaIds: ['toilet-room-101'],
      reason: 'manual review found an existing riser covering this room',
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-exception', [member('toilet-room-101', 101, true)]),
    ], { storeys: STOREYS, exceptionRules })

    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      groupId: 'g-exception',
      areaId: 'toilet-room-101',
      storeyId: 101,
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'manual-existing-riser-A',
    })
    expect(decisions[0].reasons[0]).toContain('manual review found an existing riser')
  })

  it('supports storey-scoped exception rules for eligible standard-floor rooms', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'existing-riser-on-storey-102',
      storeyIds: [102],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-storey-rule', [
        member('toilet-room-101', 101, true),
        member('toilet-room-102', 102, true),
      ]),
    ], { storeys: STOREYS, exceptionRules })

    const lower = decisions.find((decision) => decision.areaId === 'toilet-room-101')
    const coveredStorey = decisions.find((decision) => decision.areaId === 'toilet-room-102')

    expect(lower).toMatchObject({
      decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    })
    expect(coveredStorey).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'existing-riser-on-storey-102',
    })
  })

  it('keeps ineligible non-penthouse floors excluded even when a broad exception rule matches them', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'broad-basement-rule-should-not-relabel-excluded-floor',
      storeyIds: [100],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-basement', [
        member('basement-room', 100, false),
        member('standard-room', 101, true),
      ]),
    ], { storeys: STOREYS, exceptionRules })

    const basement = decisions.find((decision) => decision.areaId === 'basement-room')

    expect(basement).toMatchObject({
      decision: RISER_STRATEGY_DECISION.EXCLUDED_FLOOR,
    })
    expect(basement?.coveredByExceptionRuleId).toBeUndefined()
  })

  it('inherits exception coverage from the primary eligible room instead of creating duplicate risers for the same vertical group', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'existing-shaft-through-primary-room',
      areaIds: ['primary-toilet-room'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-vertical', [
        member('primary-toilet-room', 101, true),
        member('upper-toilet-room', 102, true),
      ]),
    ], { storeys: STOREYS, exceptionRules })

    const placed = decisions.filter((decision) => decision.decision === RISER_STRATEGY_DECISION.RISER_PLACED)
    const primary = decisions.find((decision) => decision.areaId === 'primary-toilet-room')
    const upper = decisions.find((decision) => decision.areaId === 'upper-toilet-room')

    expect(placed).toHaveLength(0)
    expect(primary).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'existing-shaft-through-primary-room',
    })
    expect(upper).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'existing-shaft-through-primary-room',
    })
  })

  it('preserves existing group coverage precedence and still avoids duplicates', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-existing', [member('shared-toilet-room', 101, true), member('upper-room', 102, true)], 0.95),
      group('g-candidate', [member('shared-toilet-room', 101, true)], 0.7),
    ], { storeys: STOREYS })

    const candidate = decisions.find((decision) => decision.groupId === 'g-candidate')
    const placed = decisions.filter((decision) => decision.decision === RISER_STRATEGY_DECISION.RISER_PLACED)

    expect(placed).toHaveLength(1)
    expect(candidate).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP,
      coveredByGroupId: 'g-existing',
    })
  })

  it('does not add a new riser on an ineligible penthouse by default when the lower eligible member is already exception-covered', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'existing-shaft-serves-penthouse-stack',
      areaIds: ['standard-room'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-penthouse', [
        member('standard-room', 102, true),
        member('penthouse-room', 103, false),
      ]),
    ], { storeys: STOREYS, exceptionRules })

    const placed = decisions.filter((decision) => decision.decision === RISER_STRATEGY_DECISION.RISER_PLACED)
    const penthouse = decisions.find((decision) => decision.areaId === 'penthouse-room')

    expect(placed).toHaveLength(0)
    expect(penthouse).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'existing-shaft-serves-penthouse-stack',
    })
  })
})
