import { describe, expect, it } from 'vitest'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import { groupWetAreasVertically, type DetectedWetArea } from './groupWetAreasVertically'

const aggregation: StoreyDetectionAggregation = {
  floors: [
    {
      storeyId: 30,
      storeyName: 'Roof',
      floorClass: 'roof',
      fixtureCount: 0,
      toiletCount: 0,
      kitchenCount: 0,
      eligibleForNewRisers: false,
      eligibilityReason: 'excluded roof floor',
    },
    {
      storeyId: 10,
      storeyName: 'Ground',
      floorClass: 'standard',
      fixtureCount: 0,
      toiletCount: 0,
      kitchenCount: 0,
      eligibleForNewRisers: true,
      eligibilityReason: 'eligible for new riser generation',
    },
    {
      storeyId: 20,
      storeyName: 'Level 1',
      floorClass: 'standard',
      fixtureCount: 0,
      toiletCount: 0,
      kitchenCount: 0,
      eligibleForNewRisers: true,
      eligibilityReason: 'eligible for new riser generation',
    },
  ],
  fixturesByStoreyId: { 10: [], 20: [], 30: [] },
  kitchensByStoreyId: { 10: [], 20: [], 30: [] },
}

function area(id: string, storeyId: number, minX: number, minZ: number, maxX: number, maxZ: number, confidence = 1): DetectedWetArea {
  return {
    id,
    storeyId,
    centroid: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    bounds: { minX, minZ, maxX, maxZ },
    confidence,
  }
}

describe('groupWetAreasVertically', () => {
  it('enforces one member per non-base storey by strongest deterministic score', () => {
    const groups = groupWetAreasVertically(
      [
        area('base', 10, 0, 0, 2000, 2000, 1),
        area('l2-high-intrinsic-low-pair', 20, 1800, 1800, 2800, 2800, 1),
        area('l2-strong-pair', 20, 50, 50, 1950, 1950, 0.7),
      ],
      aggregation,
    )

    expect(groups).toHaveLength(2)
    const baseGroup = groups.find((g) => g.members.some((m) => m.areaId === 'base'))
    expect(baseGroup?.members.map((m) => m.areaId)).toEqual(['base', 'l2-strong-pair'])
    expect(baseGroup?.members.filter((m) => m.storeyId === 20)).toHaveLength(1)
  })

  it('builds stable content-based group ids and uses elevation order from aggregation floors', () => {
    const inputA = [area('b', 10, 0, 0, 1000, 1000), area('a', 20, 0, 0, 1000, 1000)]
    const inputB = [area('a', 20, 0, 0, 1000, 1000), area('b', 10, 0, 0, 1000, 1000)]

    const groupsA = groupWetAreasVertically(inputA, aggregation)
    const groupsB = groupWetAreasVertically(inputB, aggregation)

    expect(groupsA[0].groupId).toBe('vwg:10:b|20:a')
    expect(groupsA[0].groupId).toBe(groupsB[0].groupId)
  })

  it('keeps a single wet area as its own group', () => {
    const groups = groupWetAreasVertically([area('solo', 10, 0, 0, 1000, 1000)], aggregation)
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(1)
    expect(groups[0].members[0].areaId).toBe('solo')
  })

  it('marks missing storey from aggregation floors as not eligible', () => {
    const groups = groupWetAreasVertically([area('unknown-storey', 99, 0, 0, 1000, 1000)], aggregation)
    expect(groups[0].members[0].eligibleForNewRisers).toBe(false)
  })

  it('honors custom minOverlapRatio, maxCentroidDistanceMm, and minPairScoreToGroup options', () => {
    const wetAreas = [
      area('base', 10, 0, 0, 1000, 1000, 1),
      area('candidate', 20, 100, 100, 1100, 1100, 0.7),
    ]

    const strict = groupWetAreasVertically(wetAreas, aggregation, {
      minOverlapRatio: 0.9,
      maxCentroidDistanceMm: 100,
      minPairScoreToGroup: 0.95,
    })
    expect(strict.find((g) => g.members.some((m) => m.areaId === 'base'))?.members).toHaveLength(1)

    const relaxed = groupWetAreasVertically(wetAreas, aggregation, {
      minOverlapRatio: 0.3,
      maxCentroidDistanceMm: 1000,
      minPairScoreToGroup: 0.5,
    })
    expect(relaxed.find((g) => g.members.some((m) => m.areaId === 'base'))?.members).toHaveLength(2)
  })
})
