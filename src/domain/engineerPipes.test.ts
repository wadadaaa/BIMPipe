import { describe, expect, it } from 'vitest'
import {
  ENGINEER_RISER_MIN_DIAMETER_MM,
  ENGINEER_RISER_XY_GROUPING_TOLERANCE_M,
  ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM,
  groupEngineerRiserStacks,
  isVerticalEngineerSegment,
  type EngineerPipeNetwork,
  type EngineerPipeSegment,
} from './engineerPipes'

/** Synthetic segment factory (neutral names, centimetre source units). */
function segment(overrides: Partial<EngineerPipeSegment> & { expressId: number }): EngineerPipeSegment {
  return {
    name: `Pipe ${overrides.expressId}`,
    systemName: 'XX-GRV 1',
    storeyId: 100,
    storeyName: 'Level A',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 300 },
    endpointSource: 'extrusion-axis',
    outerDiameterMm: 110,
    lengthM: 3,
    invertElevationM: 0.1,
    ...overrides,
  }
}

/** Centimetre-unit network wrapper (metersPerSourceUnit = 0.01). */
function network(segments: EngineerPipeSegment[]): EngineerPipeNetwork {
  return {
    metersPerSourceUnit: 0.01,
    storeys: [
      { id: 100, name: 'Level A', elevationSource: 0 },
      { id: 200, name: 'Level B', elevationSource: 300 },
    ],
    segments,
  }
}

/** Neutral synthetic prefixes matching the `XX-*` fixture system names. */
const SYNTHETIC_PREFIXES = ['XX-GRV', 'XX-VNT'] as const

describe('isVerticalEngineerSegment', () => {
  it('accepts a perfectly vertical segment', () => {
    expect(isVerticalEngineerSegment(segment({ expressId: 1 }))).toBe(true)
  })

  it('accepts a segment tilted less than the tolerance', () => {
    // 4 degrees off vertical: dx = tan(4deg) * dz
    const dx = Math.tan((4 * Math.PI) / 180) * 300
    const tilted = segment({ expressId: 1, end: { x: dx, y: 0, z: 300 } })
    expect(isVerticalEngineerSegment(tilted)).toBe(true)
  })

  it('rejects a segment tilted more than the tolerance', () => {
    const dx = Math.tan((10 * Math.PI) / 180) * 300
    const tilted = segment({ expressId: 1, end: { x: dx, y: 0, z: 300 } })
    expect(isVerticalEngineerSegment(tilted)).toBe(false)
  })

  it('rejects horizontal, zero-length, and endpoint-less segments', () => {
    expect(isVerticalEngineerSegment(segment({ expressId: 1, end: { x: 300, y: 0, z: 0 } }))).toBe(false)
    expect(isVerticalEngineerSegment(segment({ expressId: 1, end: { x: 0, y: 0, z: 0 } }))).toBe(false)
    expect(isVerticalEngineerSegment(segment({ expressId: 1, start: null, end: null }))).toBe(false)
  })
})

describe('groupEngineerRiserStacks', () => {
  it('exports a consistent mm/m grouping tolerance pair', () => {
    expect(ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM / 1000).toBe(ENGINEER_RISER_XY_GROUPING_TOLERANCE_M)
  })

  it('groups vertical segments at the same XY across storeys into one stack', () => {
    const stacks = groupEngineerRiserStacks(
      network([
        segment({ expressId: 1, storeyId: 100, storeyName: 'Level A', start: { x: 100, y: 200, z: 0 }, end: { x: 100, y: 200, z: 300 } }),
        segment({ expressId: 2, storeyId: 200, storeyName: 'Level B', start: { x: 110, y: 205, z: 300 }, end: { x: 110, y: 205, z: 600 } }),
      ]),
      { systemPrefixes: SYNTHETIC_PREFIXES },
    )

    expect(stacks).toHaveLength(1)
    expect(stacks[0].id).toBe('engineer-riser-1')
    expect(stacks[0].segmentExpressIds).toEqual([1, 2])
    // Storeys sorted by elevation ascending.
    expect(stacks[0].storeys).toEqual([
      { id: 100, name: 'Level A' },
      { id: 200, name: 'Level B' },
    ])
    // Mean of midpoints: x = (100 + 110) / 2 cm = 1.05 m
    expect(stacks[0].xM).toBeCloseTo(1.05, 10)
    expect(stacks[0].yM).toBeCloseTo(2.025, 10)
  })

  it('separates stacks farther apart than the XY tolerance', () => {
    const stacks = groupEngineerRiserStacks(
      network([
        segment({ expressId: 1, start: { x: 100, y: 200, z: 0 }, end: { x: 100, y: 200, z: 300 } }),
        // 26 cm away in plan = 0.26 m > 0.25 m tolerance
        segment({ expressId: 2, start: { x: 126, y: 200, z: 0 }, end: { x: 126, y: 200, z: 300 } }),
      ]),
      { systemPrefixes: SYNTHETIC_PREFIXES },
    )
    expect(stacks).toHaveLength(2)
    // Sorted by xM ascending, deterministic ids.
    expect(stacks.map((stack) => stack.id)).toEqual(['engineer-riser-1', 'engineer-riser-2'])
    expect(stacks[0].xM).toBeLessThan(stacks[1].xM)
  })

  it('excludes segments below the minimum riser diameter', () => {
    const stacks = groupEngineerRiserStacks(
      network([
        segment({ expressId: 1, outerDiameterMm: 50 }),
        segment({ expressId: 2, outerDiameterMm: null }),
      ]),
      { systemPrefixes: SYNTHETIC_PREFIXES },
    )
    expect(stacks).toHaveLength(0)
  })

  it('accepts diameters within floating-point noise of the minimum', () => {
    const stacks = groupEngineerRiserStacks(
      network([segment({ expressId: 1, outerDiameterMm: ENGINEER_RISER_MIN_DIAMETER_MM - 1e-9 })]),
      { systemPrefixes: SYNTHETIC_PREFIXES },
    )
    expect(stacks).toHaveLength(1)
  })

  it('includes SW-GRV and VNT prefixes and excludes other systems', () => {
    const stacks = groupEngineerRiserStacks(
      network([
        segment({ expressId: 1, systemName: 'SW-GRV 14', start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 300 } }),
        segment({ expressId: 2, systemName: 'VNT 2', start: { x: 5, y: 5, z: 0 }, end: { x: 5, y: 5, z: 300 } }),
        segment({ expressId: 3, systemName: 'CW 5', start: { x: 1000, y: 0, z: 0 }, end: { x: 1000, y: 0, z: 300 } }),
        segment({ expressId: 4, systemName: null, start: { x: 2000, y: 0, z: 0 }, end: { x: 2000, y: 0, z: 300 } }),
      ]),
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].segmentExpressIds).toEqual([1, 2])
  })

  it('uses the largest member diameter for the stack', () => {
    const stacks = groupEngineerRiserStacks(
      network([
        segment({ expressId: 1, outerDiameterMm: 110 }),
        segment({ expressId: 2, outerDiameterMm: 160, storeyId: 200, storeyName: 'Level B' }),
      ]),
      { systemPrefixes: SYNTHETIC_PREFIXES },
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].diameterMm).toBe(160)
  })

  it('is deterministic regardless of input segment order', () => {
    const segments = [
      segment({ expressId: 3, start: { x: 500, y: 200, z: 0 }, end: { x: 500, y: 200, z: 300 } }),
      segment({ expressId: 1, start: { x: 100, y: 200, z: 0 }, end: { x: 100, y: 200, z: 300 } }),
      segment({ expressId: 2, storeyId: 200, storeyName: 'Level B', start: { x: 100, y: 200, z: 300 }, end: { x: 100, y: 200, z: 600 } }),
    ]
    const forward = groupEngineerRiserStacks(network(segments), { systemPrefixes: SYNTHETIC_PREFIXES })
    const reversed = groupEngineerRiserStacks(network([...segments].reverse()), {
      systemPrefixes: SYNTHETIC_PREFIXES,
    })
    expect(reversed).toEqual(forward)
    expect(forward).toHaveLength(2)
  })

  it('returns an empty array for an empty network', () => {
    expect(groupEngineerRiserStacks(network([]))).toEqual([])
  })
})
