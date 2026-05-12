import { describe, expect, it } from 'vitest'
import type { Storey } from '@/domain/types'
import { RISER_STRATEGY_DECISION } from '@/domain/decideRiserStrategyPerToiletRoom'
import { buildRuntimePlacementStrategy, TOILET_ROOM_PROXY_HALF_WIDTH_M } from './buildRuntimePlacementStrategy'

const STOREYS: Storey[] = [
  { id: 1, name: 'L1', elevation: 0, modelId: 'm' },
  { id: 2, name: 'L2', elevation: 3, modelId: 'm' },
]

describe('buildRuntimePlacementStrategy', () => {
  it('uses explicit toilet proxy width constant for vertical grouping envelope', () => {
    expect(TOILET_ROOM_PROXY_HALF_WIDTH_M).toBe(0.6)
  })

  it('adds fallback coordination decision for toilets missing from grouped inputs', () => {
    const result = buildRuntimePlacementStrategy(STOREYS, {
      floors: [
        { storeyId: 1, storeyName: 'L1', floorClass: 'standard', fixtureCount: 1, toiletCount: 1, kitchenCount: 0, eligibleForNewRisers: true, eligibilityReason: 'ok' },
        { storeyId: 2, storeyName: 'L2', floorClass: 'standard', fixtureCount: 1, toiletCount: 1, kitchenCount: 0, eligibleForNewRisers: true, eligibilityReason: 'ok' },
      ],
      fixturesByStoreyId: {
        1: [{ expressId: 11, name: 'WC-11', kind: 'TOILETPAN', storeyId: 1, position: { x: 1, y: 0, z: 1 } }],
        2: [{ expressId: 22, name: 'WC-22', kind: 'TOILETPAN', storeyId: 2, position: null }],
      },
      kitchensByStoreyId: {},
    })

    const fallback = result.placementDecisions.find((d) => d.areaId === 'toilet-room:2:22')
    expect(fallback?.decision).toBe(RISER_STRATEGY_DECISION.COORDINATION_REQUIRED)
  })
})
