import { describe, expect, it } from 'vitest'

import { isStoreyIncludedInDemoScope } from '@/shared/demoConfig'

describe('isStoreyIncludedInDemoScope', () => {
  it('normalizes floor names across case, whitespace, NBSP, and NFC', () => {
    const config = {
      name: 'demo',
      model: {
        fileName: 'ADAM_10.ifc',
        schema: 'IFC2X3',
        source: 'Autodesk Revit 2024',
        assetPath: 'external/demo-assets/ADAM_10.ifc',
      },
      scope: {
        includedFloors: [' KOMA\u00A01 ', 'E\u0301tage'],
        excludedFloors: ['Roof '],
      },
      routing: {
        mode: 'demo',
        allowManualRiserSelection: true,
      },
    }

    expect(isStoreyIncludedInDemoScope('koma 1', config)).toBe(true)
    expect(isStoreyIncludedInDemoScope('  étage ', config)).toBe(true)
    expect(isStoreyIncludedInDemoScope(' roof', config)).toBe(false)
  })
})
