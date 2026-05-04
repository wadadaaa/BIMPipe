import { describe, expect, it, vi } from 'vitest'
import type { Fixture, KitchenArea, Storey } from '@/domain/types'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from '@/shared/routes/riserPlacementProfile'
import { aggregateStoreyDetections } from './aggregateStoreyDetections'

function storey(id: number, name: string, elevation: number): Storey {
  return { id, name, elevation, modelId: 'm1' }
}

describe('aggregateStoreyDetections', () => {
  it('aggregates toilets and kitchens across all floors and marks eligibility', async () => {
    const storeys: Storey[] = [
      storey(1, 'Basement B1', -3),
      storey(2, 'Level 1', 0),
      storey(3, 'Level 2', 3),
      storey(4, 'Level 3', 6),
      storey(5, 'Roof', 9),
    ]

    const fixtureByFloor: Record<number, Fixture[]> = {
      1: [fixture(101, 1, 'TOILETPAN')],
      2: [fixture(201, 2, 'TOILETPAN'), fixture(202, 2, 'SINK')],
      3: [fixture(301, 3, 'TOILETPAN')],
      4: [fixture(401, 4, 'TOILETPAN')],
      5: [fixture(501, 5, 'TOILETPAN')],
    }

    const kitchenByFloor: Record<number, KitchenArea[]> = {
      2: [kitchen(2001, 2)],
      4: [kitchen(4001, 4)],
    }

    const result = await aggregateStoreyDetections(
      {} as never,
      1,
      storeys,
      DEFAULT_RISER_PLACEMENT_RULE_PROFILE,
      {
        detectFixtures: vi.fn(async (_api, _id, storeyId) => fixtureByFloor[storeyId] ?? []),
        detectKitchens: vi.fn(async (_api, _id, storeyId) => kitchenByFloor[storeyId] ?? []),
      },
    )

    expect(result.fixturesByStoreyId[2]).toHaveLength(1)
    expect(result.fixturesByStoreyId[2][0].kind).toBe('TOILETPAN')
    expect(result.kitchensByStoreyId[4]).toHaveLength(1)

    expect(result.floors.map((entry) => [entry.storeyId, entry.floorClass, entry.eligibleForNewRisers])).toEqual([
      [1, 'basement', false],
      [2, 'standard', true],
      [3, 'standard', true],
      [4, 'penthouse', false],
      [5, 'roof', false],
    ])

    const penthouse = result.floors.find((entry) => entry.storeyId === 4)
    expect(penthouse?.eligibilityReason).toContain('penthouse analyzed')
  })
})

function fixture(expressId: number, storeyId: number, kind: Fixture['kind']): Fixture {
  return {
    expressId,
    storeyId,
    kind,
    name: `F-${expressId}`,
    position: { x: 0, y: 0, z: 0 },
  }
}

function kitchen(expressId: number, storeyId: number): KitchenArea {
  return {
    expressId,
    storeyId,
    name: `K-${expressId}`,
    position: { x: 0, y: 0, z: 0 },
  }
}
