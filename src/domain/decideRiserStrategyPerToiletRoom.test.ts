import { describe, expect, it } from 'vitest'
import { decideRiserStrategyPerToiletRoom, RISER_STRATEGY_DECISION } from './decideRiserStrategyPerToiletRoom'
import type { VerticalWetGroup } from './groupWetAreasVertically'

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

describe('decideRiserStrategyPerToiletRoom', () => {
  it('places one riser for an eligible anchor group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('a1', 101, true)]),
    ])

    expect(decisions[0].decision).toBe(RISER_STRATEGY_DECISION.RISER_PLACED)
  })

  it('marks non-primary eligible overlaps as covered by stronger group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-strong', [member('a-base', 101, true), member('a-top', 102, true)], 0.95),
      group('g-weak', [member('a-base', 101, true)], 0.7),
    ])

    const weakDecision = decisions.find((d) => d.groupId === 'g-weak' && d.areaId === 'a-base')
    expect(weakDecision?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
    expect(weakDecision?.coveredByGroupId).toBe('g-strong')
  })

  it('marks non-eligible basement/roof as excluded when not served by placed group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('roof-a', 199, false)]),
    ])

    expect(decisions[0].decision).toBe(RISER_STRATEGY_DECISION.EXCLUDED_FLOOR)
  })

  it('marks non-eligible top member as penthouse served by placed lower group', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g1', [member('l2', 102, true), member('ph', 103, false)]),
    ])

    const penthouse = decisions.find((d) => d.areaId === 'ph')
    expect(penthouse?.decision).toBe(RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER)
    expect(penthouse?.servedByGroupId).toBe('g1')
  })

  it('prevents duplicate RISER_PLACED for losing same-storey single-member overlap', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-main', [member('a1', 101, true), member('a2', 102, true)]),
      group('g-loser', [member('a2', 102, true)]),
    ])

    expect(decisions.filter((d) => d.decision === RISER_STRATEGY_DECISION.RISER_PLACED)).toHaveLength(2)
    const loser = decisions.find((d) => d.groupId === 'g-loser')
    expect(loser?.decision).toBe(RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP)
  })

  it('flags ambiguous same-storey overlap as COORDINATION_REQUIRED', () => {
    const decisions = decideRiserStrategyPerToiletRoom([
      group('g-a', [member('overlap', 101, true), member('a2', 102, true)], 0.9),
      group('g-b', [member('overlap', 101, true), member('b2', 103, true)], 0.9),
      group('g-candidate', [member('overlap', 101, true)]),
    ])

    const ambiguous = decisions.find((d) => d.groupId === 'g-candidate' && d.areaId === 'overlap')
    expect(ambiguous?.decision).toBe(RISER_STRATEGY_DECISION.COORDINATION_REQUIRED)
  })

  it('returns stable decision IDs independent of input group order', () => {
    const groups = [
      group('g1', [member('a1', 101, true)]),
      group('g2', [member('a2', 102, true)]),
    ]

    const idsA = decideRiserStrategyPerToiletRoom(groups).map((d) => d.decisionId)
    const idsB = decideRiserStrategyPerToiletRoom([...groups].reverse()).map((d) => d.decisionId)

    expect(idsA).toEqual(idsB)
  })
})
