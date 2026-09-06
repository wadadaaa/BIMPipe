import { describe, expect, it } from 'vitest'
import {
  BRANCH_LENGTH_LIMIT_M,
  BRANCH_LENGTH_LIMIT_MM,
  BUILDING_TYPOLOGIES,
  DEFAULT_BUILDING_TYPOLOGY,
  MAX_SNAP_OFFICE_M,
  OFFICE_COLLECTOR_MAX_M,
  RESIDENTIAL_COLLECTOR_MAX_M,
  TYPOLOGY_PLACEMENT_RULES,
  buildingTypologySchema,
  describeBuildingTypology,
  isBuildingTypology,
  resolveBranchLengthLimit,
  resolveTypologyPlacementRules,
} from './typology'
import { MAX_BRANCH_LENGTH_M, MAX_BRANCH_LENGTH_MM } from './assignFixturesToRisers'
import { MAX_SNAP_M } from '@/shared/routes/suggestRisers'

describe('building typology', () => {
  it('defaults to residential and validates the two known values', () => {
    expect(DEFAULT_BUILDING_TYPOLOGY).toBe('residential')
    expect(BUILDING_TYPOLOGIES).toEqual(['residential', 'office'])
    expect(buildingTypologySchema.parse('office')).toBe('office')
    expect(buildingTypologySchema.safeParse('hotel').success).toBe(false)
    expect(isBuildingTypology('residential')).toBe(true)
    expect(isBuildingTypology(undefined)).toBe(false)
  })

  it('residential rules reproduce the pre-typology constants exactly', () => {
    const rules = resolveTypologyPlacementRules(undefined)
    expect(rules).toBe(TYPOLOGY_PLACEMENT_RULES.residential)
    expect(rules.stackCandidates).toBe('any')
    expect(rules.maxSnapM).toBe(MAX_SNAP_M)
    expect(rules.branchLengthLimitM).toBe(MAX_BRANCH_LENGTH_M)
    expect(rules.rowCollectors).toBeNull()
    expect(rules.coreShafts).toBeNull()
    expect(BRANCH_LENGTH_LIMIT_M.residential).toBe(MAX_BRANCH_LENGTH_M)
    expect(BRANCH_LENGTH_LIMIT_MM.residential).toBe(MAX_BRANCH_LENGTH_MM)
  })

  it('office rules are opt-in: core shafts only, wider snap, raised (placeholder) branch limit, row collectors', () => {
    const rules = resolveTypologyPlacementRules('office')
    expect(rules.stackCandidates).toBe('core-shafts-only')
    expect(rules.maxSnapM).toBe(MAX_SNAP_OFFICE_M)
    expect(rules.maxSnapM).toBeGreaterThan(TYPOLOGY_PLACEMENT_RULES.residential.maxSnapM)
    expect(rules.branchLengthLimitM).toBe(12)
    expect(rules.rowCollectors?.minFixtures).toBe(3)
    expect(rules.coreShafts?.shaftMinAreaM2).toBeLessThan(rules.coreShafts!.shaftMaxAreaM2)
    expect(rules.coreShafts?.largeVoidMinAreaM2).toBeLessThanOrEqual(rules.coreShafts!.shaftMaxAreaM2)
  })

  it('core-collector limits (R1): residential 8 m placeholder, office = its branch limit, both in the rules table', () => {
    expect(RESIDENTIAL_COLLECTOR_MAX_M).toBe(8)
    expect(RESIDENTIAL_COLLECTOR_MAX_M).toBe(2 * MAX_BRANCH_LENGTH_M)
    expect(OFFICE_COLLECTOR_MAX_M).toBe(BRANCH_LENGTH_LIMIT_M.office)
    expect(TYPOLOGY_PLACEMENT_RULES.residential.coreCollectorMaxM).toBe(RESIDENTIAL_COLLECTOR_MAX_M)
    expect(TYPOLOGY_PLACEMENT_RULES.office.coreCollectorMaxM).toBe(OFFICE_COLLECTOR_MAX_M)
  })

  it('mm and m limits agree for both typologies', () => {
    for (const typology of BUILDING_TYPOLOGIES) {
      expect(BRANCH_LENGTH_LIMIT_MM[typology]).toBe(BRANCH_LENGTH_LIMIT_M[typology] * 1000)
      expect(resolveBranchLengthLimit('m', typology)).toBe(BRANCH_LENGTH_LIMIT_M[typology])
      expect(resolveBranchLengthLimit('mm', typology)).toBe(BRANCH_LENGTH_LIMIT_MM[typology])
    }
    expect(resolveBranchLengthLimit('m', undefined)).toBe(4)
  })

  it('describes the manual decision for the Decisions panel', () => {
    expect(describeBuildingTypology('office')).toBe('Typology: office (manual)')
    expect(describeBuildingTypology('residential')).toBe('Typology: residential (manual)')
  })
})
