import { describe, expect, it } from 'vitest'
import {
  BRANCH_COLLECTOR_DIAMETER_MM,
  BRANCH_DIAMETER_MM_BY_FIXTURE_KIND,
  BRANCH_FALLBACK_DIAMETER_MM,
  BRANCH_SLOPE_PERCENT,
  BRANCH_SLOPE_RATIO,
  DEFAULT_BRANCH_SLOPE_DROP_MM,
  DEFAULT_BRANCH_SLOPE_RUN_MM,
  formatBranchSlopePercent,
  resolveBranchSegmentDiameterMm,
} from './branchDefaults'
import type { FixtureKind } from './types'

describe('branch defaults table', () => {
  it('pins the per-kind diameters: Ø110 WC, Ø50 everything else', () => {
    expect(BRANCH_DIAMETER_MM_BY_FIXTURE_KIND).toEqual({
      TOILETPAN: 110,
      WASHHANDBASIN: 50,
      SINK: 50,
      BATH: 50,
      URINAL: 50,
      BIDET: 50,
      CISTERN: 50,
      OTHER: 50,
    })
    expect(BRANCH_COLLECTOR_DIAMETER_MM).toBe(63)
    expect(BRANCH_FALLBACK_DIAMETER_MM).toBe(110)
  })

  it('pins the 2.0 % slope as a consistent mm pair and ratio', () => {
    expect(BRANCH_SLOPE_PERCENT).toBe(2)
    expect(DEFAULT_BRANCH_SLOPE_DROP_MM / DEFAULT_BRANCH_SLOPE_RUN_MM).toBe(BRANCH_SLOPE_RATIO)
    expect(BRANCH_SLOPE_RATIO * 100).toBeCloseTo(BRANCH_SLOPE_PERCENT, 12)
    expect(formatBranchSlopePercent()).toBe('2.0 %')
  })
})

describe('resolveBranchSegmentDiameterMm', () => {
  it('uses the per-kind diameter for a single fixture', () => {
    expect(resolveBranchSegmentDiameterMm(['TOILETPAN'])).toBe(110)
    expect(resolveBranchSegmentDiameterMm(['WASHHANDBASIN'])).toBe(50)
    expect(resolveBranchSegmentDiameterMm(['BATH'])).toBe(50)
    expect(resolveBranchSegmentDiameterMm(['URINAL'])).toBe(50)
  })

  it('upgrades a shared run of two or more small fixtures to the Ø63 collector', () => {
    expect(resolveBranchSegmentDiameterMm(['BATH', 'BATH'])).toBe(63)
    expect(resolveBranchSegmentDiameterMm(['WASHHANDBASIN', 'SINK', 'BATH'])).toBe(63)
  })

  it('keeps Ø110 whenever a WC is served, shared or not', () => {
    expect(resolveBranchSegmentDiameterMm(['TOILETPAN', 'WASHHANDBASIN'])).toBe(110)
    expect(resolveBranchSegmentDiameterMm(['BATH', 'BATH', 'TOILETPAN'])).toBe(110)
  })

  it('never returns a diameter below the largest served kind', () => {
    const kinds = Object.keys(BRANCH_DIAMETER_MM_BY_FIXTURE_KIND) as FixtureKind[]
    for (const kind of kinds) {
      expect(resolveBranchSegmentDiameterMm([kind])).toBeGreaterThanOrEqual(
        BRANCH_DIAMETER_MM_BY_FIXTURE_KIND[kind],
      )
    }
  })

  it('falls back to Ø110 with no served-fixture information', () => {
    expect(resolveBranchSegmentDiameterMm([])).toBe(BRANCH_FALLBACK_DIAMETER_MM)
  })
})
