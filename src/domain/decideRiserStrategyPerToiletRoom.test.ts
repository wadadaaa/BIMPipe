import { describe, expect, it } from 'vitest'
import { decideRiserStrategyPerToiletRoom, RISER_STRATEGY_DECISION } from './decideRiserStrategyPerToiletRoom'
import type { VerticalWetGroup } from './groupWetAreasVertically'

const group = (groupId: string, members: VerticalWetGroup['members'], confidence = 0.9): VerticalWetGroup => ({
  groupId,
  members,
  debug: { confidence, reasons: [] },
})

const member = (areaId: string, storeyId: number, eligibleForNewRisers: boolean, confidence = 0.9): VerticalWetGroup['members'][number] => ({
  areaId,
  storeyId,
  eligibleForNewRisers,
  overlapRatio: 1,
  centroidDistanceMeters: 0,
  planBounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
  debug: { confidence, reasons: [] },
})

describe('decideRiserStrategyPerToiletRoom', () => {
  it('places one riser for an eligible anchor group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([group('g1', [member('a1', 101, true)])])
    expect(decisions[0].decision).toBe(RISER_STRATEGY_DECISION.RISER_PLACED)
  })


  it('places one primary riser decision per eligible group and covers other eligible members', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('a-low', 101, true), member('a-high', 102, true)]),
    ])

    const placed = decisions.filter((d) => d.groupId === 'g1' && d.decision === RISER_STRATEGY_DECISION.RISER_PLACED)
    const covered = decisions.find((d) => d.groupId === 'g1' && d.areaId === 'a-high')

    expect(placed).toHaveLength(1)
    expect(placed[0].areaId).toBe('a-low')
    expect(covered?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
    expect(covered?.coveredByGroupId).toBe('g1')
  })

  it('marks eligible overlaps as covered by stronger group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-strong', [member('a-base', 101, true), member('a-top', 102, true)], 0.95),
      group('g-weak', [member('a-base', 101, true)], 0.7),
    ])

    const weakDecision = decisions.find((d) => d.groupId === 'g-weak' && d.areaId === 'a-base')
    expect(weakDecision?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
    expect(weakDecision?.coveredByGroupId).toBe('g-strong')
  })

  it('group with only ineligible members is EXCLUDED_FLOOR for all members', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('b1', 1, false), member('r1', 99, false)]),
    ])
    expect(decisions.every((d) => d.decision === RISER_STRATEGY_DECISION.EXCLUDED_FLOOR)).toBe(true)
  })

  it('marks non-eligible top member as penthouse served by placed lower group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('l2', 102, true), member('ph', 103, false)]),
    ])

    const penthouse = decisions.find((d) => d.areaId === 'ph')
    expect(penthouse?.decision).toBe(RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER)
    expect(penthouse?.servedByGroupId).toBe('g1')
  })

  it('ineligible member below eligible storey is EXCLUDED_FLOOR', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('below', 100, false), member('eligible', 101, true)]),
    ])

    const below = decisions.find((d) => d.areaId === 'below')
    expect(below?.decision).toBe(RISER_STRATEGY_DECISION.EXCLUDED_FLOOR)
  })

  it('ineligible middle member is not penthouse-served', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('lower', 101, true), member('middle', 102, false), member('upper', 103, true)]),
    ])

    const middle = decisions.find((d) => d.areaId === 'middle')
    expect(middle?.decision).toBe(RISER_STRATEGY_DECISION.EXCLUDED_FLOOR)
  })

  it('prevents duplicate RISER_PLACED for losing same-storey single-member overlap', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-main', [member('a1', 101, true), member('a2', 102, true)]),
      group('g-loser', [member('a2', 102, true)]),
    ])

    const placedInLoser = decisions.filter((d) => d.groupId === 'g-loser' && d.decision === RISER_STRATEGY_DECISION.RISER_PLACED)
    const loser = decisions.find((d) => d.groupId === 'g-loser')
    expect(placedInLoser).toHaveLength(0)
    expect(loser?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
  })

  it('uses deterministic groupId tie-break when strength metrics are equal', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-a', [member('overlap', 101, true), member('a2', 102, true)], 0.9),
      group('g-b', [member('overlap', 101, true), member('b2', 102, true)], 0.9),
      group('g-candidate', [member('overlap', 101, true)], 0.9),
    ])

    const candidate = decisions.find((d) => d.groupId === 'g-candidate' && d.areaId === 'overlap')
    expect(candidate?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
    expect(candidate?.coveredByGroupId).toBe('g-a')
  })

  it('returns stable decision IDs independent of input group order', () => {
    const groups = [group('g1', [member('a1', 101, true)]), group('g2', [member('a2', 102, true)])]
    const idsA = decideRiserStrategyPerToiletRoom(groups).map((d) => d.decisionId)
    const idsB = decideRiserStrategyPerToiletRoom([...groups].reverse()).map((d) => d.decisionId)
    expect(idsA).toEqual(idsB)
  })
})
