import { describe, expect, it } from 'vitest'
import type { Storey } from '@/domain/types'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import { groupWetAreasVertically, type DetectedWetArea } from './groupWetAreasVertically'

const STOREYS: Storey[] = [
  { id: 101, name: 'L1', elevation: 0, modelId: 'm1' },
  { id: 103, name: 'L3', elevation: 6, modelId: 'm1' },
  { id: 102, name: 'L2', elevation: 3, modelId: 'm1' },
]

const AGGREGATION: StoreyDetectionAggregation = {
  floors: [
    { storeyId: 101, storeyName: 'L1', floorClass: 'standard', fixtureCount: 2, toiletCount: 2, kitchenCount: 0, eligibleForNewRisers: true, eligibilityReason: 'ok' },
    { storeyId: 102, storeyName: 'L2', floorClass: 'standard', fixtureCount: 2, toiletCount: 2, kitchenCount: 0, eligibleForNewRisers: true, eligibilityReason: 'ok' },
    { storeyId: 103, storeyName: 'L3', floorClass: 'roof', fixtureCount: 1, toiletCount: 1, kitchenCount: 0, eligibleForNewRisers: false, eligibilityReason: 'roof' },
  ],
  fixturesByStoreyId: { 101: [], 102: [], 103: [] },
  kitchensByStoreyId: { 101: [], 102: [], 103: [] },
}

describe('groupWetAreasVertically', () => {
  it('groups typical aligned wet areas across floors', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'a-101', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'a-102', storeyId: 102, planBounds: { minX: 0.05, maxX: 2.05, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map((member) => member.storeyId)).toEqual([101, 102])
  })

  it('allows shifted fixture inside approximately aligned wet room', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'a-base', storeyId: 101, planBounds: { minX: 10, maxX: 13, minZ: 10, maxZ: 13 } },
      { areaId: 'a-shift', storeyId: 102, planBounds: { minX: 10.3, maxX: 13.3, minZ: 10.3, maxZ: 13.3 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(2)
  })

  it('does not group non-overlapping wet areas', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'a1', storeyId: 101, planBounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } },
      { areaId: 'a2', storeyId: 102, planBounds: { minX: 5, maxX: 6, minZ: 5, maxZ: 6 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups).toHaveLength(2)
  })

  it('keeps at most one member per storey using strongest deterministic candidate', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'base', storeyId: 101, planBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 } },
      { areaId: 'strong', storeyId: 102, planBounds: { minX: 0.1, maxX: 4.1, minZ: 0.1, maxZ: 4.1 } },
      { areaId: 'weak', storeyId: 102, planBounds: { minX: 1, maxX: 5, minZ: 1, maxZ: 5 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups).toHaveLength(2)
    expect(groups[0].members.map((member) => member.areaId)).toEqual(['base', 'strong'])
  })

  it('uses stable content-based groupId independent of input order', () => {
    const wetAreasA: DetectedWetArea[] = [
      { areaId: 'w2', storeyId: 102, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'w1', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]
    const wetAreasB = [...wetAreasA].reverse()

    const groupA = groupWetAreasVertically(wetAreasA, STOREYS, AGGREGATION)[0]
    const groupB = groupWetAreasVertically(wetAreasB, STOREYS, AGGREGATION)[0]
    expect(groupA.groupId).toBe(groupB.groupId)
  })

  it('orders members by storey elevation, not id ordering', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'low', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'high', storeyId: 103, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'mid', storeyId: 102, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups[0].members.map((member) => member.storeyId)).toEqual([101, 102, 103])
  })

  it('defaults eligibility to false when storey metadata is missing in aggregation', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'missing-floor', storeyId: 999, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    expect(groups[0].members[0].eligibleForNewRisers).toBe(false)
  })

  it('supports custom threshold options', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'a', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'b', storeyId: 102, planBounds: { minX: 0.8, maxX: 2.8, minZ: 0.8, maxZ: 2.8 } },
    ]

    const strict = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION)
    const relaxed = groupWetAreasVertically(wetAreas, STOREYS, AGGREGATION, {
      minOverlapRatio: 0.1,
      maxCentroidDistanceMm: 2500,
      minConfidenceToGroup: 0.2,
    })

    expect(strict).toHaveLength(2)
    expect(relaxed).toHaveLength(1)
  })
})
