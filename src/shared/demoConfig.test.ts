import { describe, expect, it } from 'vitest'

import { buildDemoModeUploadError, isStoreyIncludedInDemoScope, parseDemoRuntimeConfig } from '@/shared/demoConfig'

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

describe('buildDemoModeUploadError', () => {
  it('returns null when demo mode is disabled', () => {
    expect(buildDemoModeUploadError('any.ifc', { enabled: false })).toBeNull()
  })

  it('returns null for the configured demo model file', () => {
    const runtime = parseDemoRuntimeConfig({
      name: 'demo',
      model: { fileName: 'ADAM_10.ifc', schema: 'IFC2X3', source: 'Autodesk Revit 2024', assetPath: 'external/demo-assets/ADAM_10.ifc' },
      scope: { includedFloors: ['קומה 1'], excludedFloors: [] },
      routing: { mode: 'demo', allowManualRiserSelection: true },
    })
    expect(buildDemoModeUploadError('ADAM_10.ifc', runtime)).toBeNull()
  })

  it('returns an error for the wrong upload file in demo mode', () => {
    const runtime = parseDemoRuntimeConfig({
      name: 'demo',
      model: { fileName: 'ADAM_10.ifc', schema: 'IFC2X3', source: 'Autodesk Revit 2024', assetPath: 'external/demo-assets/ADAM_10.ifc' },
      scope: { includedFloors: ['קומה 1'], excludedFloors: [] },
      routing: { mode: 'demo', allowManualRiserSelection: true },
    })
    expect(buildDemoModeUploadError('other.ifc', runtime)).toContain('ADAM_10.ifc')
  })
})

describe('parseDemoRuntimeConfig', () => {
  it('throws for invalid config shape', () => {
    expect(() => parseDemoRuntimeConfig({ name: 'demo' })).toThrow(/Demo mode config is invalid/)
  })
})
