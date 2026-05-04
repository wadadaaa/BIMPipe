import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RISER_PLACEMENT_RULE_PROFILE,
  resolveRiserPlacementRuleProfile,
} from './riserPlacementProfile'

describe('riserPlacementProfile', () => {
  it('provides the expected default profile', () => {
    expect(DEFAULT_RISER_PLACEMENT_RULE_PROFILE).toMatchObject({
      typicalFloor: 'L2',
      excludedFloorTypes: ['basement', 'roof'],
      penthouseRule: 'exclude_new_risers',
      roomOverlapThreshold: 0.5,
      fixtureOffsetToleranceMm: 450,
      riserCoverageRadiusMm: 1800,
      addRiserOnlyWhenNoExistingGroupCoversToilet: true,
      createCoordinationIssues: true,
    })
  })

  it('fills missing fields with safe defaults', () => {
    expect(resolveRiserPlacementRuleProfile({ typicalFloor: 'Level 4' })).toMatchObject({
      typicalFloor: 'Level 4',
      excludedFloorTypes: ['basement', 'roof'],
      penthouseRule: 'exclude_new_risers',
      createCoordinationIssues: true,
    })
  })
})
