import { describe, expect, it } from 'vitest'
import { groupWetAreasVertically, type DetectedWetArea } from './groupWetAreasVertically'

const aggregation = {
  floors: [
    { storeyId: 'L1', eligibleForNewRisers: true },
    { storeyId: 'L2', eligibleForNewRisers: true },
    { storeyId: 'L3', eligibleForNewRisers: false },
  ],
}

function area(id: string, storeyId: string, minXmm: number, minYmm: number, maxXmm: number, maxYmm: number, confidence = 1): DetectedWetArea {
  return {
    id,
    storeyId,
    centroid: { xMm: (minXmm + maxXmm) / 2, yMm: (minYmm + maxYmm) / 2 },
    bounds: { minXmm, minYmm, maxXmm, maxYmm },
    confidence,
  }
}

describe('groupWetAreasVertically', () => {
  it('enforces one member per non-base storey by strongest deterministic score', () => {
    const groups = groupWetAreasVertically(
      [
        area('base', 'L1', 0, 0, 2000, 2000, 1),
        area('l2-weak', 'L2', 1500, 1500, 3000, 3000, 0.5),
        area('l2-strong', 'L2', 100, 100, 1900, 1900, 0.9),
      ],
      aggregation,
    )

    expect(groups).toHaveLength(2)
    const baseGroup = groups.find((g) => g.members.some((m) => m.areaId === 'base'))
    expect(baseGroup?.members.map((m) => m.areaId)).toEqual(['base', 'l2-strong'])
    expect(baseGroup?.members.filter((m) => m.storeyId === 'L2')).toHaveLength(1)
  })

  it('builds stable content-based group ids from sorted member ids', () => {
    const inputA = [area('b', 'L1', 0, 0, 1000, 1000), area('a', 'L2', 0, 0, 1000, 1000)]
    const inputB = [area('a', 'L2', 0, 0, 1000, 1000), area('b', 'L1', 0, 0, 1000, 1000)]

    const groupsA = groupWetAreasVertically(inputA, aggregation)
    const groupsB = groupWetAreasVertically(inputB, aggregation)

    expect(groupsA[0].groupId).toBe('vwg:L1:b|L2:a')
    expect(groupsA[0].groupId).toBe(groupsB[0].groupId)
  })

  it('keeps a single wet area as its own group', () => {
    const groups = groupWetAreasVertically([area('solo', 'L1', 0, 0, 1000, 1000)], aggregation)
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(1)
    expect(groups[0].members[0].areaId).toBe('solo')
  })

  it('marks missing storey from aggregation floors as not eligible', () => {
    const groups = groupWetAreasVertically([area('unknown-storey', 'L99', 0, 0, 1000, 1000)], aggregation)
    expect(groups[0].members[0].eligibleForNewRisers).toBe(false)
  })

  it('honors custom minOverlapRatio, maxCentroidDistanceMm, and minConfidenceToGroup options', () => {
    const wetAreas = [
      area('base', 'L1', 0, 0, 1000, 1000, 1),
      area('candidate', 'L2', 100, 100, 1100, 1100, 0.7),
    ]

    const strict = groupWetAreasVertically(wetAreas, aggregation, {
      minOverlapRatio: 0.9,
      maxCentroidDistanceMm: 100,
      minConfidenceToGroup: 0.95,
    })
    expect(strict.find((g) => g.members.some((m) => m.areaId === 'base'))?.members).toHaveLength(1)

    const relaxed = groupWetAreasVertically(wetAreas, aggregation, {
      minOverlapRatio: 0.3,
      maxCentroidDistanceMm: 1000,
      minConfidenceToGroup: 0.5,
    })
    expect(relaxed.find((g) => g.members.some((m) => m.areaId === 'base'))?.members).toHaveLength(2)
  })
})
