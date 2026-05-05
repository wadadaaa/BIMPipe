import { describe, expect, it } from 'vitest'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'
import { groupWetAreasVertically, type DetectedWetArea } from './groupWetAreasVertically'

const aggregation: StoreyDetectionAggregation = {
  floors: [
    floor(1, 'basement', false),
    floor(2, 'standard', true),
    floor(3, 'standard', true),
    floor(4, 'penthouse', false),
    floor(5, 'roof', false),
  ],
  fixturesByStoreyId: {},
  kitchensByStoreyId: {},
}

describe('groupWetAreasVertically', () => {
  it('groups typical aligned toilet wet areas across floors', () => {
    const result = groupWetAreasVertically(aggregation, {
      2: [wetArea('L1-W1', 2, 0, 0, 0, 2, 0, 2)],
      3: [wetArea('L2-W1', 3, 0.1, 0.05, 0, 2, 0, 2)],
    })

    expect(result).toHaveLength(1)
    expect(result[0].members.map((m) => m.storeyId)).toEqual([2, 3])
    expect(result[0].confidence).toBeGreaterThan(0.75)
  })

  it('groups shifted WC positions inside approximately aligned wet rooms', () => {
    const result = groupWetAreasVertically(aggregation, {
      2: [wetArea('A', 2, 1.2, 1.1, 0, 2.4, 0, 2.2)],
      3: [wetArea('B', 3, 1.8, 1.5, 0.4, 2.8, 0.2, 2.4)],
    })

    expect(result).toHaveLength(1)
    expect(result[0].members).toHaveLength(2)
    expect(result[0].reasons.join(' ')).toContain('threshold')
  })

  it('does not group non-overlapping wet areas', () => {
    const result = groupWetAreasVertically(aggregation, {
      2: [wetArea('A', 2, 0, 0, 0, 1, 0, 1)],
      3: [wetArea('B', 3, 10, 10, 9.5, 10.5, 9.5, 10.5)],
    })

    expect(result).toHaveLength(2)
    expect(result.every((group) => group.members.length === 1)).toBe(true)
  })

  it('marks basement and roof members as not eligible for new risers', () => {
    const result = groupWetAreasVertically(aggregation, {
      1: [wetArea('B1', 1, 0, 0, 0, 2, 0, 2)],
      2: [wetArea('L1', 2, 0, 0, 0, 2, 0, 2)],
      5: [wetArea('RF', 5, 0, 0, 0, 2, 0, 2)],
    })

    const group = result.find((entry) => entry.members.length === 3)
    expect(group).toBeDefined()
    expect(group?.members.filter((member) => member.eligibleForNewRisers)).toHaveLength(1)
  })

  it('includes penthouse in analysis but not as new-riser eligible', () => {
    const result = groupWetAreasVertically(aggregation, {
      3: [wetArea('L2', 3, 0, 0, 0, 2, 0, 2)],
      4: [wetArea('PH', 4, 0.1, 0.1, 0, 2, 0, 2)],
    })

    expect(result).toHaveLength(1)
    const penthouseMember = result[0].members.find((member) => member.storeyId === 4)
    expect(penthouseMember?.eligibleForNewRisers).toBe(false)
  })
})

function floor(storeyId: number, floorClass: 'standard' | 'basement' | 'roof' | 'penthouse', eligible: boolean) {
  return {
    storeyId,
    storeyName: `S${storeyId}`,
    floorClass,
    fixtureCount: 0,
    toiletCount: 0,
    kitchenCount: 0,
    eligibleForNewRisers: eligible,
    eligibilityReason: eligible ? 'eligible' : 'excluded',
  }
}

function wetArea(
  id: string,
  storeyId: number,
  centroidX: number,
  centroidZ: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): DetectedWetArea {
  return {
    id,
    storeyId,
    centroid: { x: centroidX, z: centroidZ },
    bounds: { minX, maxX, minZ, maxZ },
    source: 'toilet_cluster',
  }
}
