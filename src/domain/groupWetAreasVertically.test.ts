import { describe, expect, it } from 'vitest'
import type { Storey } from '@/domain/types'
import { groupWetAreasVertically, type DetectedWetArea, type StoreyEligibilityById } from './groupWetAreasVertically'

const STOREYS: Storey[] = [
  { id: 101, name: 'L1', elevation: 0, modelId: 'm1' },
  { id: 103, name: 'L3', elevation: 6, modelId: 'm1' },
  { id: 102, name: 'L2', elevation: 3, modelId: 'm1' },
]

const ELIGIBILITY: StoreyEligibilityById = new Map([
  [101, true],
  [102, true],
  [103, false],
])

describe('groupWetAreasVertically', () => {
  it('groups typical aligned wet areas across floors', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'a-101', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'a-102', storeyId: 102, planBounds: { minX: 0.05, maxX: 2.05, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY)
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map((member) => member.storeyId)).toEqual([101, 102])
  })

  it('keeps overlap-gate failures as separate single-member groups', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'g1', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'g2', storeyId: 102, planBounds: { minX: 4, maxX: 6, minZ: 4, maxZ: 6 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY)
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.members.length === 1)).toBe(true)
  })

  it('keeps centroid-distance-gate failures as separate single-member groups', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'g1', storeyId: 101, planBounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 } },
      { areaId: 'g2', storeyId: 102, planBounds: { minX: 8.5, maxX: 18.5, minZ: 0, maxZ: 10 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY, {
      minOverlapRatio: 0.1,
      maxCentroidDistanceMm: 1000,
      minConfidenceToGroup: 0.2,
    })

    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.members.length === 1)).toBe(true)
  })

  it('keeps at most one member per storey using strongest deterministic candidate', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'base', storeyId: 101, planBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 } },
      { areaId: 'strong', storeyId: 102, planBounds: { minX: 0.1, maxX: 4.1, minZ: 0.1, maxZ: 4.1 } },
      { areaId: 'weak', storeyId: 102, planBounds: { minX: 1, maxX: 5, minZ: 1, maxZ: 5 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY)
    expect(groups).toHaveLength(2)
    expect(groups[0].members.map((member) => member.areaId)).toEqual(['base', 'strong'])
  })

  it('uses stable content-based groupId independent of input order', () => {
    const wetAreasA: DetectedWetArea[] = [
      { areaId: 'w2', storeyId: 102, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'w1', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]
    const wetAreasB = [...wetAreasA].reverse()

    const groupA = groupWetAreasVertically(wetAreasA, STOREYS, ELIGIBILITY)[0]
    const groupB = groupWetAreasVertically(wetAreasB, STOREYS, ELIGIBILITY)[0]
    expect(groupA.groupId).toBe(groupB.groupId)
  })

  it('orders members by storey elevation, not id ordering', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'low', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'high', storeyId: 103, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'mid', storeyId: 102, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY)
    expect(groups[0].members.map((member) => member.storeyId)).toEqual([101, 102, 103])
  })

  it('defaults eligibility to false when storey id is missing in eligibility map', () => {
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'missing-floor', storeyId: 999, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, ELIGIBILITY)
    expect(groups[0].members[0].eligibleForNewRisers).toBe(false)
  })

  it('passes ineligible basement/roof floors through as eligibleForNewRisers false', () => {
    const eligibility: StoreyEligibilityById = new Map([
      [101, false],
      [102, true],
      [103, false],
    ])
    const wetAreas: DetectedWetArea[] = [
      { areaId: 'basement-like', storeyId: 101, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'standard', storeyId: 102, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
      { areaId: 'roof-like', storeyId: 103, planBounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } },
    ]

    const groups = groupWetAreasVertically(wetAreas, STOREYS, eligibility)
    expect(groups[0].members.map((member) => member.eligibleForNewRisers)).toEqual([false, true, false])
  })
})
