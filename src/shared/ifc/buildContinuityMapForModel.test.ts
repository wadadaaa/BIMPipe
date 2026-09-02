import { describe, expect, it } from 'vitest'
import type { ContinuityStoreyInput } from '@/domain/continuityMap'
import {
  convertContinuityElevationsToMeters,
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
