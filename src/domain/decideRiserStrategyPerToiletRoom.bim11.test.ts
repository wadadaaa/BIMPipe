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

  it('ignores selector-less exception rules instead of matching every room', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'empty-rule',
      reason: 'this should not suppress placement without a selector',
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-empty-rule', [member('toilet-room-101', 101, true)]),
    ], { storeys: STOREYS, exceptionRules })

    expect(decisions[0]).toMatchObject({
      decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    })
    expect(decisions[0].coveredByExceptionRuleId).toBeUndefined()
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

  it('supports group-scoped exception rules for eligible standard-floor rooms', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'existing-riser-for-group',
      groupIds: ['g-group-rule'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-group-rule', [member('toilet-room-101', 101, true)]),
    ], { storeys: STOREYS, exceptionRules })

    expect(decisions[0]).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'existing-riser-for-group',
    })
  })

  it('requires all non-empty exception selectors to match', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'group-and-storey-rule',
      groupIds: ['g-and-rule'],
      storeyIds: [102],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-and-rule', [member('toilet-room-101', 101, true)]),
    ], { storeys: STOREYS, exceptionRules })

    expect(decisions[0]).toMatchObject({
      decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    })
    expect(decisions[0].coveredByExceptionRuleId).toBeUndefined()
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

  it('uses exception coverage before stronger overlapping group coverage for explicitly covered eligible rooms', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'manual-exception-for-shared-room',
      areaIds: ['shared-toilet-room'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-existing', [member('shared-toilet-room', 101, true), member('upper-room', 102, true)], 0.95),
      group('g-candidate', [member('shared-toilet-room', 101, true)], 0.7),
    ], { storeys: STOREYS, exceptionRules })

    const candidate = decisions.find((decision) => decision.groupId === 'g-candidate')

    expect(candidate).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'manual-exception-for-shared-room',
    })
    expect(candidate?.coveredByGroupId).toBeUndefined()
  })

  it('applies area-scoped exception only to a non-primary eligible member when primary remains uncovered', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'upper-room-only-exception',
      areaIds: ['upper-toilet-room'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-partial-area-rule', [
        member('primary-toilet-room', 101, true),
        member('upper-toilet-room', 102, true),
      ]),
    ], { storeys: STOREYS, exceptionRules })

    const primary = decisions.find((decision) => decision.areaId === 'primary-toilet-room')
    const upper = decisions.find((decision) => decision.areaId === 'upper-toilet-room')

    expect(primary).toMatchObject({
      decision: RISER_STRATEGY_DECISION.RISER_PLACED,
    })
    expect(upper).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'upper-room-only-exception',
    })
  })

  it('inherits exception coverage from the primary eligible room instead of creating duplicate risers for the same vertical group', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'existing-shaft-through-primary-room',
      areaIds: ['primary-toilet-room'],
      reason: 'primary room is already served by an existing shaft',
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
    expect(upper?.reasons[0]).toBe('primary room is already served by an existing shaft')
  })

  it('preserves inherited exception coverage precedence over stronger overlapping group coverage', () => {
    const exceptionRules: RiserCoverageExceptionRule[] = [{
      ruleId: 'primary-exception-overlap-rule',
      areaIds: ['shared-primary-room'],
    }]

    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-strong', [
        member('upper-toilet-room', 102, true),
        member('strong-extra-room', 103, true),
      ], 0.95),
      group('g-candidate', [
        member('shared-primary-room', 101, true),
        member('upper-toilet-room', 102, true),
      ], 0.7),
    ], { storeys: STOREYS, exceptionRules })

    const candidateUpper = decisions.find((decision) =>
      decision.groupId === 'g-candidate' && decision.areaId === 'upper-toilet-room')

    expect(candidateUpper).toMatchObject({
      decision: RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE,
      coveredByExceptionRuleId: 'primary-exception-overlap-rule',
    })
    expect(candidateUpper?.coveredByGroupId).toBeUndefined()
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
      reason: 'existing shaft continues through the penthouse stack',
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
    expect(penthouse?.reasons[0]).toBe('existing shaft continues through the penthouse stack')
  })
})
