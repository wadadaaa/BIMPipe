import { describe, expect, it } from 'vitest'
import type { Storey } from '@/domain/types'
import { classifyFloors, getEligibleStoreyIdsForAutoRisers } from './floorClassification'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'

function storey(id: number, name: string, elevation: number): Storey {
  return { id, name, elevation, modelId: 'm1' }
}

describe('floorClassification', () => {
  it('classifies basement, standard, roof, and penthouse floors', () => {
    const result = classifyFloors([
      storey(1, 'Basement B1', -3),
      storey(2, 'Level 1', 0),
      storey(3, 'Level 2', 3),
      storey(4, 'Level 3', 6),
      storey(5, 'Roof', 9),
    ])

    expect(result.map((entry) => [entry.storeyId, entry.class])).toEqual([
      [1, 'basement'],
      [2, 'standard'],
      [3, 'standard'],
      [4, 'penthouse'],
      [5, 'roof'],
    ])
    expect(result.find((entry) => entry.class === 'penthouse')?.reasons[0]).toContain('last non-basement')
  })

  it('excludes basement, roof, and penthouse from auto-placement by default', () => {
    const ids = getEligibleStoreyIdsForAutoRisers([
      storey(1, 'Basement', -3),
      storey(2, 'Level 1', 0),
      storey(3, 'Level 2', 3),
      storey(4, 'Level 3', 6),
      storey(5, 'Roof', 9),
    ], DEFAULT_RISER_PLACEMENT_RULE_PROFILE)

    expect(ids).toEqual([2, 3])
  })

  it('can include penthouse when rule is changed', () => {
    const ids = getEligibleStoreyIdsForAutoRisers([
      storey(2, 'Level 1', 0),
      storey(3, 'Level 2', 3),
      storey(4, 'Level 3', 6),
    ], { ...DEFAULT_RISER_PLACEMENT_RULE_PROFILE, penthouseRule: 'allow_new_risers' })

    expect(ids).toEqual([2, 3, 4])
  })
})
