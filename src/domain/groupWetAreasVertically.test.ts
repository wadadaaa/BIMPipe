import { describe, expect, it } from 'vitest'
import type { Storey } from '@/domain/types'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import { groupWetAreasVertically, type DetectedWetArea } from './groupWetAreasVertically'

function aggregationForStoreys(storeys: Storey[], eligible: Record<number, boolean>): StoreyDetectionAggregation {
  return {
    floors: storeys.map((storey) => ({
      storeyId: storey.id,
      storeyName: storey.name,
      floorClass: 'standard',
      fixtureCount: 0,
      toiletCount: 0,
      kitchenCount: 0,
      eligibleForNewRisers: eligible[storey.id] ?? false,
      eligibilityReason: 'test',
    })),
    fixturesByStoreyId: {},
    kitchensByStoreyId: {},
  }
}

function wet(areaId: string, storeyId: number, minX: number, maxX: number, minZ: number, maxZ: number): DetectedWetArea {
  return { areaId, storeyId, bounds: { minX, maxX, minZ, maxZ } }
}

describe('groupWetAreasVertically', () => {
  it('keeps at most one member per storey using strongest deterministic candidate', () => {
    const storeys: Storey[] = [
      { id: 100, name: 'L1', elevation: 0, modelId: 'm1' },
      { id: 200, name: 'L2', elevation: 3, modelId: 'm1' },
    ]
    const aggregation = aggregationForStoreys(storeys, { 100: true, 200: true })
    const areas = [
      wet('base', 100, 0, 4, 0, 4),
      wet('strong', 200, 0.2, 4.2, 0.2, 4.2),
      wet('weak', 200, 0.9, 4.9, 0.9, 4.9),
    ]

    const [group] = groupWetAreasVertically(areas, aggregation, {
      minOverlapRatio: 0.4,
      maxCentroidDistanceMeters: 2,
      storeys,
    })
    const upperMembers = group.members.filter((m) => m.storeyId === 200)

    expect(upperMembers).toHaveLength(1)
    expect(upperMembers[0].areaId).toBe('strong')
  })

  it('uses stable content-based group id and numeric storey ids', () => {
    const storeys: Storey[] = [
      { id: 1, name: 'One', elevation: 0, modelId: 'm' },
      { id: 2, name: 'Two', elevation: 3, modelId: 'm' },
    ]
    const aggregation = aggregationForStoreys(storeys, { 1: true, 2: false })

    const forward = groupWetAreasVertically(
      [wet('a', 1, 0, 2, 0, 2), wet('b', 2, 0, 2, 0, 2)],
      aggregation,
      { storeys },
    )
    const reverse = groupWetAreasVertically(
      [wet('b', 2, 0, 2, 0, 2), wet('a', 1, 0, 2, 0, 2)],
      aggregation,
      { storeys },
    )

    expect(forward[0].groupId).toBe(reverse[0].groupId)
    expect(forward[0].members.map((m) => typeof m.storeyId)).toEqual(['number', 'number'])
  })

  it('orders members by storey elevation and handles missing storey metadata', () => {
    const storeys: Storey[] = [
      { id: 20, name: 'High', elevation: 6, modelId: 'm' },
      { id: 10, name: 'Low', elevation: 0, modelId: 'm' },
    ]
    const aggregation = aggregationForStoreys(storeys, { 10: true, 20: false })
    const [group] = groupWetAreasVertically(
      [wet('upper', 20, 1, 3, 1, 3), wet('lower', 10, 1, 3, 1, 3), wet('unknown', 99, 1, 3, 1, 3)],
      aggregation,
      { storeys },
    )

    expect(group.members.map((m) => m.storeyId)).toEqual([10, 20, 99])
    expect(groupWetAreasVertically([wet('unknown', 99, 0, 1, 0, 1)], aggregation)[0].members[0].eligibleForNewRisers).toBe(false)
  })
})
