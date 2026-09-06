import { describe, expect, it } from 'vitest'
import type { ContinuityStoreyInput } from '@/domain/continuityMap'
import {
  convertContinuityElevationsToMeters,
  mergeContinuityStoreyInputs,
  remapContinuityStoreysToHost,
} from './buildContinuityMapForModel'

function storey(overrides: Partial<ContinuityStoreyInput>): ContinuityStoreyInput {
  return {
    storeyId: 1,
    storeyName: 'Storey',
    elevation: 0,
    obstructions: [
      {
        id: 'wall:10',
        kind: 'wall',
        // Footprints are metres already (web-ifc GetFlatMesh output) and must
        // pass through the boundary untouched.
        footprint: { shape: 'bbox', bounds: { minX: 1.5, maxX: 2.5, minZ: -3, maxZ: -2 } },
      },
    ],
    voids: [],
    spaces: [],
    ...overrides,
  }
}

describe('convertContinuityElevationsToMeters', () => {
  it('converts raw cm elevations (096-style) to metres and leaves footprints untouched', () => {
    const input = [storey({ elevation: 3015 })]
    const converted = convertContinuityElevationsToMeters(input, 'cm')
    expect(converted[0].elevation).toBeCloseTo(30.15, 9)
    expect(converted[0].obstructions[0].footprint).toEqual(input[0].obstructions[0].footprint)
    // Pure: the input array is not mutated.
    expect(input[0].elevation).toBe(3015)
  })

  it('converts raw mm elevations (Duplex-style) to metres', () => {
    const converted = convertContinuityElevationsToMeters([storey({ elevation: 3000 })], 'mm')
    expect(converted[0].elevation).toBeCloseTo(3, 9)
  })
})

describe('remapContinuityStoreysToHost', () => {
  it('rewrites linked storey ids to host ids and drops unmapped storeys with a diagnostic', () => {
    const input = [
      storey({ storeyId: 77, storeyName: '00' }),
      storey({ storeyId: 78, storeyName: 'roof only in linked file' }),
    ]
    const remap = remapContinuityStoreysToHost(input, new Map([[77, 5]]))

    expect(remap.storeys).toHaveLength(1)
    expect(remap.storeys[0].storeyId).toBe(5)
    expect(remap.storeys[0].storeyName).toBe('00')
    expect(remap.diagnostics).toHaveLength(1)
    expect(remap.diagnostics[0]).toContain('78')
    expect(remap.diagnostics[0]).toContain('no aligned host storey')
    // Pure: the input storey keeps its linked id.
    expect(input[0].storeyId).toBe(77)
  })
})

describe('mergeContinuityStoreyInputs (V3 multi-model)', () => {
  it('concatenates per-storey geometry from several files under host storey ids with file-prefixed element ids', () => {
    const host = [storey({ storeyId: 5, storeyName: 'L04', elevation: 18 })]
    const structure = [
      storey({
        storeyId: 5,
        storeyName: 'L04 (linked name)',
        elevation: 18,
        obstructions: [{ id: 'column:1', kind: 'column', footprint: { shape: 'bbox', bounds: { minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.5 } } }],
        voids: [{ id: 'opening:9', kind: 'slab-opening', footprint: { shape: 'bbox', bounds: { minX: 3, maxX: 3.6, minZ: 3, maxZ: 3.6 } } }],
      }),
      storey({ storeyId: 6, storeyName: 'L05', elevation: 21.5, obstructions: [] }),
    ]

    const merged = mergeContinuityStoreyInputs([
      { fileName: 'host.ifc', storeys: host },
      { fileName: 'structure.ifc', storeys: structure },
    ])

    expect(merged.map((entry) => entry.storeyId)).toEqual([5, 6])
    // Host is first, so its name wins for the shared storey.
    expect(merged[0].storeyName).toBe('L04')
    expect(merged[0].obstructions.map((item) => item.id)).toEqual(['host.ifc:wall:10', 'structure.ifc:column:1'])
    expect(merged[0].voids.map((item) => item.id)).toEqual(['structure.ifc:opening:9'])
    expect(merged[1].storeyName).toBe('L05')
    // Pure: inputs are untouched.
    expect(host[0].obstructions[0].id).toBe('wall:10')
  })

  it('orders storeys bottom-to-top even when files list them in a different order', () => {
    const merged = mergeContinuityStoreyInputs([
      { fileName: 'a.ifc', storeys: [storey({ storeyId: 3, elevation: 9 }), storey({ storeyId: 1, elevation: 0 })] },
      { fileName: 'b.ifc', storeys: [storey({ storeyId: 2, elevation: 4.5 })] },
    ])
    expect(merged.map((entry) => entry.storeyId)).toEqual([1, 2, 3])
  })
})
