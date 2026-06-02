import { describe, expect, it } from 'vitest'
import type { DemoConfig } from '@/shared/demoConfig'
import type { Fixture, Storey } from '@/domain/types'
import { buildSuggestedRisers } from './buildSuggestedRisers'

const storeys: Storey[] = [
  { id: 1, name: 'קומה 1', elevation: 300, modelId: 'model-1' },
  { id: 2, name: 'קומה 2', elevation: 600, modelId: 'model-1' },
  { id: 3, name: 'קומה 3', elevation: 900, modelId: 'model-1' },
  { id: 4, name: 'קומה 4', elevation: 1200, modelId: 'model-1' },
  { id: 99, name: 'מרתף 1', elevation: -300, modelId: 'model-1' },
]

const toilet: Fixture = {
  expressId: 11,
  name: 'WC-11',
  kind: 'TOILETPAN',
  storeyId: 2,
  position: { x: 100, y: 600, z: 100 },
}

const demoConfig: DemoConfig = {
  name: 'test demo',
  model: { fileName: 'tower.ifc', schema: 'IFC2X3', source: 'x', assetPath: 'x' },
  // Demo routing is deliberately scoped to a single floor.
  scope: { includedFloors: ['קומה 2'], excludedFloors: [] },
  routing: { mode: 'demo', allowManualRiserSelection: true },
}

function makeLabeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

describe('buildSuggestedRisers', () => {
  it('spans every eligible floor as one vertical stack even when the demo scope is a single floor', () => {
    const risers = buildSuggestedRisers(storeys, 2, [toilet], [], null, makeLabeler(), {
      enabled: true,
      config: demoConfig,
    })

    // Eligible floors: 1, 2, 3 (floor 4 is the penthouse, מרתף 1 is a basement — both excluded).
    // The riser is a vertical shaft, so it must appear on all eligible floors, not only קומה 2.
    expect(new Set(risers.map((riser) => riser.storeyId))).toEqual(new Set([1, 2, 3]))
    // All entries belong to the same physical stack.
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
    expect(new Set(risers.map((riser) => riser.stackLabel))).toEqual(new Set(['R1']))
  })

  it('spans the residential floors but honors demo-excluded floors (ADAM_10-like)', () => {
    const adamStoreys: Storey[] = [
      { id: 10, name: '-2.5', elevation: -250, modelId: 'model-1' },
      { id: 11, name: '-1 מרתף', elevation: -100, modelId: 'model-1' },
      { id: 12, name: 'קומת קרקע', elevation: 0, modelId: 'model-1' },
      { id: 13, name: 'קומה 1', elevation: 300, modelId: 'model-1' },
      { id: 14, name: 'קומה 2', elevation: 600, modelId: 'model-1' },
      { id: 15, name: 'קומה 3', elevation: 900, modelId: 'model-1' },
      { id: 16, name: 'קומה 4', elevation: 1200, modelId: 'model-1' },
      { id: 17, name: 'גג', elevation: 1500, modelId: 'model-1' },
    ]
    const adamConfig: DemoConfig = {
      ...demoConfig,
      scope: {
        includedFloors: ['קומת קרקע', 'קומה 1', 'קומה 2'],
        excludedFloors: ['-2.5', '-1 מרתף', 'גג'],
      },
    }
    const adamToilet: Fixture = { ...toilet, storeyId: 14, position: { x: 100, y: 600, z: 100 } }

    const risers = buildSuggestedRisers(adamStoreys, 14, [adamToilet], [], null, makeLabeler(), {
      enabled: true,
      config: adamConfig,
    })

    const floorIds = new Set(risers.map((riser) => riser.storeyId))
    // The shaft spans the residential floors. Crucially קומה 3 (15) is included — the floor where
    // the user reported risers vanishing. The Hebrew roof "גג" and "-2.5" are demo-excluded, and
    // the named basement is classifier-excluded, so the shaft never lands on them.
    expect(floorIds.has(15)).toBe(true) // קומה 3 — the reported bug
    expect(floorIds.has(14)).toBe(true) // קומה 2 (placement floor)
    expect(floorIds.has(12)).toBe(true) // ground
    expect(floorIds.has(10)).toBe(false) // '-2.5' demo-excluded
    expect(floorIds.has(11)).toBe(false) // named basement, classifier-excluded
    expect(floorIds.has(17)).toBe(false) // Hebrew roof demo-excluded
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
  })

  it('keeps the same stack across floors when demo mode is disabled', () => {
    const risers = buildSuggestedRisers(storeys, 2, [toilet], [], null, makeLabeler(), { enabled: false })

    expect(new Set(risers.map((riser) => riser.storeyId))).toEqual(new Set([1, 2, 3]))
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
  })
})
