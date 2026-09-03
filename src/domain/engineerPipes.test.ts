import { describe, expect, it } from 'vitest'
import {
  ENGINEER_RISER_CHAIN_GAP_M,
  ENGINEER_RISER_CHAIN_GAP_MM,
  ENGINEER_RISER_EXTENT_EPSILON_M,
  ENGINEER_RISER_EXTENT_EPSILON_MM,
  ENGINEER_RISER_MIN_DIAMETER_MM,
  ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M,
  ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_MM,
  ENGINEER_RISER_SYSTEM_PREFIXES,
  ENGINEER_RISER_XY_GROUPING_TOLERANCE_M,
  ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM,
  ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
  ENGINEER_STACK_STOREY_OVERLAP_MIN_MM,
  classifyEngineerRiserStacks,
  deriveStoreyPitchM,
  isVerticalEngineerSegment,
  stackIntersectsBand,
  stacksIntersectingBand,
  storeySlabBandM,
  type EngineerPipeNetwork,
  type EngineerPipeSegment,
  type EngineerStoreyRef,
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

/** Centimetre-unit network wrapper (metersPerSourceUnit = 0.01), two storeys 3 m apart. */
function network(segments: EngineerPipeSegment[], storeys?: EngineerStoreyRef[]): EngineerPipeNetwork {
  return {
    metersPerSourceUnit: 0.01,
    storeys: storeys ?? [
      { id: 100, name: 'Level A', elevationSource: 0 },
      { id: 200, name: 'Level B', elevationSource: 300 },
    ],
    segments,
  }
}

/** Neutral synthetic prefixes matching the `XX-*` fixture system names. */
const SYNTHETIC_CLASSES = {
  sanitarySystemPrefixes: ['XX-GRV'],
  ventSystemPrefixes: ['XX-VNT'],
} as const

/** Sanitary stacks for the common case where only the sanitary class matters. */
function sanitaryStacks(net: EngineerPipeNetwork) {
  return classifyEngineerRiserStacks(net, SYNTHETIC_CLASSES).sanitaryStacks
}

/** Vertical cm-unit segment from z0 to z1 at plan (x, y). */
function vertical(
  expressId: number,
  x: number,
  y: number,
  z0: number,
  z1: number,
  overrides: Partial<EngineerPipeSegment> = {},
): EngineerPipeSegment {
  return segment({ expressId, start: { x, y, z: z0 }, end: { x, y, z: z1 }, ...overrides })
}

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

describe('constants', () => {
  it('exports consistent mm/m constant pairs', () => {
    expect(ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM / 1000).toBe(ENGINEER_RISER_XY_GROUPING_TOLERANCE_M)
    expect(ENGINEER_RISER_CHAIN_GAP_MM / 1000).toBe(ENGINEER_RISER_CHAIN_GAP_M)
    expect(ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_MM / 1000).toBe(ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M)
    expect(ENGINEER_RISER_EXTENT_EPSILON_MM / 1000).toBe(ENGINEER_RISER_EXTENT_EPSILON_M)
    expect(ENGINEER_STACK_STOREY_OVERLAP_MIN_MM / 1000).toBe(ENGINEER_STACK_STOREY_OVERLAP_MIN_M)
  })

  it('extraction prefixes are the union of the sanitary and vent classes', () => {
    expect(ENGINEER_RISER_SYSTEM_PREFIXES).toEqual(['SW-GRV', 'VNT'])
  })
})

describe('deriveStoreyPitchM', () => {
  it('returns the median positive consecutive pitch in metres (cm source)', () => {
    // Pitches: 3.0, 3.2, 3.2, 5.0 -> median (3.2 + 3.2) / 2 = 3.2
    const pitch = deriveStoreyPitchM(
      [
        { id: 1, name: 'a', elevationSource: 0 },
        { id: 2, name: 'b', elevationSource: 300 },
        { id: 3, name: 'c', elevationSource: 620 },
        { id: 4, name: 'd', elevationSource: 940 },
        { id: 5, name: 'e', elevationSource: 1440 },
      ],
      0.01,
    )
    expect(pitch).toBeCloseTo(3.2, 10)
  })

  it('ignores duplicate elevations and returns null without two distinct ones', () => {
    expect(
      deriveStoreyPitchM(
        [
          { id: 1, name: 'a', elevationSource: 0 },
          { id: 2, name: 'a-dup', elevationSource: 0 },
        ],
        0.01,
      ),
    ).toBeNull()
    expect(deriveStoreyPitchM([], 0.01)).toBeNull()
    // Duplicate does not add a zero pitch: single pitch of 3 m remains.
    expect(
      deriveStoreyPitchM(
        [
          { id: 1, name: 'a', elevationSource: 0 },
          { id: 2, name: 'a-dup', elevationSource: 0 },
          { id: 3, name: 'b', elevationSource: 300 },
        ],
        0.01,
      ),
    ).toBeCloseTo(3, 10)
  })
})

describe('storeySlabBandM / stackIntersectsBand', () => {
  const storeys: EngineerStoreyRef[] = [
    { id: 1, name: 'L1', elevationSource: 0 },
    { id: 2, name: 'L2', elevationSource: 300 },
    { id: 3, name: 'L3', elevationSource: 600 },
  ]
  const net = network([], storeys)

  it('bands run from the storey elevation to the next storey above; top is open-ended', () => {
    expect(storeySlabBandM(net, 1)).toEqual({ storeyId: 1, bottomM: 0, topM: 3 })
    expect(storeySlabBandM(net, 2)).toEqual({ storeyId: 2, bottomM: 3, topM: 6 })
    expect(storeySlabBandM(net, 3)).toEqual({ storeyId: 3, bottomM: 6, topM: Infinity })
    expect(storeySlabBandM(net, 99)).toBeNull()
  })

  it('a run ending at the band bottom does not intersect; one starting there does', () => {
    const band = storeySlabBandM(net, 2)!
    expect(stackIntersectsBand({ zMinM: 0, zMaxM: 3 }, band)).toBe(false)
    expect(stackIntersectsBand({ zMinM: 3, zMaxM: 6 }, band)).toBe(true)
    // Overlap must exceed the 0.1 m minimum.
    expect(stackIntersectsBand({ zMinM: 0, zMaxM: 3.05 }, band)).toBe(false)
    expect(stackIntersectsBand({ zMinM: 0, zMaxM: 3.2 }, band)).toBe(true)
    // Pass-through run intersects every band it crosses, including the open top band.
    expect(stackIntersectsBand({ zMinM: -5, zMaxM: 50 }, storeySlabBandM(net, 3)!)).toBe(true)
  })

  it('stacksIntersectingBand preserves input order', () => {
    const band = storeySlabBandM(net, 1)!
    const runs = [
      { id: 'b', zMinM: 0, zMaxM: 9 },
      { id: 'skip', zMinM: 3, zMaxM: 9 },
      { id: 'a', zMinM: -1, zMaxM: 1 },
    ]
    expect(stacksIntersectingBand(runs, band).map((run) => run.id)).toEqual(['b', 'a'])
  })
})

describe('classifyEngineerRiserStacks', () => {
  it('groups vertical segments at the same XY across storeys into one stack with a Z-range', () => {
    const stacks = sanitaryStacks(
      network([
        vertical(1, 100, 200, 0, 300, { storeyId: 100, storeyName: 'Level A' }),
        vertical(2, 110, 205, 300, 600, { storeyId: 200, storeyName: 'Level B' }),
      ]),
    )

    expect(stacks).toHaveLength(1)
    expect(stacks[0].id).toBe('engineer-riser-1')
    expect(stacks[0].systemClass).toBe('sanitary')
    expect(stacks[0].segmentExpressIds).toEqual([1, 2])
    // Storeys sorted by elevation ascending.
    expect(stacks[0].storeys).toEqual([
      { id: 100, name: 'Level A' },
      { id: 200, name: 'Level B' },
    ])
    expect(stacks[0].spannedStoreyIds).toEqual([100, 200])
    // Mean of midpoints: x = (100 + 110) / 2 cm = 1.05 m
    expect(stacks[0].xM).toBeCloseTo(1.05, 10)
    expect(stacks[0].yM).toBeCloseTo(2.025, 10)
    expect(stacks[0].zMinM).toBeCloseTo(0, 10)
    expect(stacks[0].zMaxM).toBeCloseTo(6, 10)
    expect(stacks[0].extentM).toBeCloseTo(6, 10)
  })

  it('separates stacks farther apart than the XY tolerance', () => {
    const stacks = sanitaryStacks(
      network([
        vertical(1, 100, 200, 0, 300),
        // 26 cm away in plan = 0.26 m > 0.25 m tolerance
        vertical(2, 126, 200, 0, 300),
      ]),
    )
    expect(stacks).toHaveLength(2)
    // Sorted by xM ascending, deterministic ids.
    expect(stacks.map((stack) => stack.id)).toEqual(['engineer-riser-1', 'engineer-riser-2'])
    expect(stacks[0].xM).toBeLessThan(stacks[1].xM)
  })

  it('excludes segments below the minimum riser diameter from every class', () => {
    const classification = classifyEngineerRiserStacks(
      network([
        segment({ expressId: 1, outerDiameterMm: 50 }),
        segment({ expressId: 2, outerDiameterMm: null }),
        segment({ expressId: 3, outerDiameterMm: 50, systemName: 'XX-VNT 1' }),
      ]),
      SYNTHETIC_CLASSES,
    )
    expect(classification.sanitaryStacks).toHaveLength(0)
    expect(classification.ventStacks).toHaveLength(0)
    expect(classification.stubs).toHaveLength(0)
  })

  it('accepts diameters within floating-point noise of the minimum', () => {
    const stacks = sanitaryStacks(
      network([segment({ expressId: 1, outerDiameterMm: ENGINEER_RISER_MIN_DIAMETER_MM - 1e-9 })]),
    )
    expect(stacks).toHaveLength(1)
  })

  it('never mixes a vent into a sanitary stack even at the same XY, and excludes other systems', () => {
    const classification = classifyEngineerRiserStacks(
      network([
        vertical(1, 0, 0, 0, 300, { systemName: 'SW-GRV 14' }),
        vertical(2, 5, 5, 0, 300, { systemName: 'VNT 2' }),
        vertical(3, 1000, 0, 0, 300, { systemName: 'CW 5' }),
        vertical(4, 2000, 0, 0, 300, { systemName: null }),
      ]),
    )
    expect(classification.sanitaryStacks).toHaveLength(1)
    expect(classification.sanitaryStacks[0].segmentExpressIds).toEqual([1])
    expect(classification.ventStacks).toHaveLength(1)
    expect(classification.ventStacks[0].id).toBe('engineer-vent-1')
    expect(classification.ventStacks[0].systemClass).toBe('vent')
    expect(classification.ventStacks[0].segmentExpressIds).toEqual([2])
    expect(classification.stubs).toHaveLength(0)
  })

  it('uses the largest member diameter for the stack', () => {
    const stacks = sanitaryStacks(
      network([
        vertical(1, 0, 0, 0, 300, { outerDiameterMm: 110 }),
        vertical(2, 0, 0, 300, 600, { outerDiameterMm: 160, storeyId: 200, storeyName: 'Level B' }),
      ]),
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].diameterMm).toBe(160)
  })

  it('derives the extent threshold from the storey pitch and falls back to the constant', () => {
    const derived = classifyEngineerRiserStacks(network([]), SYNTHETIC_CLASSES)
    expect(derived.storeyPitchM).toBeCloseTo(3, 10)
    expect(derived.minStackExtentM).toBeCloseTo(3, 10)
    expect(derived.minStackExtentSource).toBe('storey-pitch-median')

    const single = classifyEngineerRiserStacks(
      network([], [{ id: 1, name: 'only', elevationSource: 612 }]),
      SYNTHETIC_CLASSES,
    )
    expect(single.storeyPitchM).toBeNull()
    expect(single.minStackExtentM).toBe(ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M)
    expect(single.minStackExtentSource).toBe('fallback-constant')

    const overridden = classifyEngineerRiserStacks(network([]), { ...SYNTHETIC_CLASSES, minStackExtentM: 1 })
    expect(overridden.minStackExtentM).toBe(1)
    expect(overridden.minStackExtentSource).toBe('option')
  })

  it('accepts a run that misses the threshold by less than the extent epsilon', () => {
    // Pitch 3 m; run 2.995 m falls short by 5 mm < 10 mm epsilon.
    const classification = classifyEngineerRiserStacks(
      network([vertical(1, 0, 0, 0, 299.5)]),
      SYNTHETIC_CLASSES,
    )
    expect(classification.sanitaryStacks).toHaveLength(1)
    expect(classification.stubs).toHaveLength(0)
  })

  it('splits one XY group into separate runs when the Z gap exceeds the chain gap', () => {
    // Same XY: a 3 m run at z 0..3, then a gap of 2 m, then a 3 m run at z 5..8.
    const classification = classifyEngineerRiserStacks(
      network([vertical(1, 0, 0, 0, 300), vertical(2, 0, 0, 500, 800)]),
      SYNTHETIC_CLASSES,
    )
    expect(classification.sanitaryStacks).toHaveLength(2)
    // Same XY -> ordered by zMinM.
    expect(classification.sanitaryStacks.map((stack) => stack.zMinM)).toEqual([0, 5])
    expect(classification.sanitaryStacks.map((stack) => stack.segmentExpressIds)).toEqual([[1], [2]])

    // Gap of 0.9 m chains into one 8 m run.
    const chained = classifyEngineerRiserStacks(
      network([vertical(1, 0, 0, 0, 300), vertical(2, 0, 0, 390, 800)]),
      SYNTHETIC_CLASSES,
    )
    expect(chained.sanitaryStacks).toHaveLength(1)
    expect(chained.sanitaryStacks[0].extentM).toBeCloseTo(8, 10)
  })

  it('is deterministic regardless of input segment order', () => {
    const segments = [
      vertical(3, 500, 200, 0, 300),
      vertical(1, 100, 200, 0, 300),
      vertical(2, 100, 200, 300, 600, { storeyId: 200, storeyName: 'Level B' }),
      vertical(4, 100, 200, 0, 40, { systemName: 'XX-VNT 1' }),
    ]
    const forward = classifyEngineerRiserStacks(network(segments), SYNTHETIC_CLASSES)
    const reversed = classifyEngineerRiserStacks(network([...segments].reverse()), SYNTHETIC_CLASSES)
    expect(reversed).toEqual(forward)
    expect(forward.sanitaryStacks).toHaveLength(2)
    expect(forward.stubs).toHaveLength(1)
  })

  it('returns empty arrays for an empty network', () => {
    const classification = classifyEngineerRiserStacks(network([]))
    expect(classification.sanitaryStacks).toEqual([])
    expect(classification.ventStacks).toEqual([])
    expect(classification.stubs).toEqual([])
  })
})

describe('classifyEngineerRiserStacks on a synthetic 5-storey tower (3 m pitch)', () => {
  const storeys: EngineerStoreyRef[] = [1, 2, 3, 4, 5].map((level) => ({
    id: level,
    name: `L${level}`,
    elevationSource: (level - 1) * 300,
  }))

  /** One 3 m segment per storey at plan (x, y), contained in its storey. */
  function perStoreySegments(
    firstExpressId: number,
    x: number,
    y: number,
    levels: number[],
    overrides: Partial<EngineerPipeSegment> = {},
  ): EngineerPipeSegment[] {
    return levels.map((level, index) =>
      vertical(firstExpressId + index, x, y, (level - 1) * 300, level * 300, {
        storeyId: level,
        storeyName: `L${level}`,
        ...overrides,
      }),
    )
  }

  const tower = network(
    [
      // Stack A: spans all 5 storeys, 5 segments.
      ...perStoreySegments(10, 100, 100, [1, 2, 3, 4, 5]),
      // Stack B: storeys 2..4 only.
      ...perStoreySegments(20, 900, 100, [2, 3, 4]),
      // Stub C: a 0.4 m vertical piece under a fixture on storey 3.
      vertical(30, 1700, 100, 630, 670, { storeyId: 3, storeyName: 'L3' }),
      // Vent stack D: spans all storeys.
      ...perStoreySegments(40, 100, 900, [1, 2, 3, 4, 5], { systemName: 'XX-VNT 1' }),
    ],
    storeys,
  )
  const classification = classifyEngineerRiserStacks(tower, SYNTHETIC_CLASSES)

  it('threshold is the 3 m pitch and the classes come out as 2 sanitary, 1 vent, 1 stub', () => {
    expect(classification.minStackExtentM).toBeCloseTo(3, 10)
    expect(classification.minStackExtentSource).toBe('storey-pitch-median')
    expect(classification.sanitaryStacks.map((stack) => stack.id)).toEqual([
      'engineer-riser-1',
      'engineer-riser-2',
    ])
    expect(classification.sanitaryStacks[0].extentM).toBeCloseTo(15, 10) // A
    expect(classification.sanitaryStacks[1].extentM).toBeCloseTo(9, 10) // B
    expect(classification.sanitaryStacks[1].spannedStoreyIds).toEqual([2, 3, 4])
    expect(classification.ventStacks.map((stack) => stack.id)).toEqual(['engineer-vent-1'])
    expect(classification.ventStacks[0].extentM).toBeCloseTo(15, 10)
    expect(classification.stubs.map((stack) => stack.id)).toEqual(['engineer-stub-1'])
    expect(classification.stubs[0].systemClass).toBe('sanitary')
    expect(classification.stubs[0].segmentExpressIds).toEqual([30])
    expect(classification.stubs[0].extentM).toBeCloseTo(0.4, 10)
  })

  it('storey 1 -> only A; storey 3 -> A and B; storey 5 -> only A', () => {
    const intersecting = (level: number) =>
      stacksIntersectingBand(classification.sanitaryStacks, storeySlabBandM(tower, level)!).map(
        (stack) => stack.id,
      )
    expect(intersecting(1)).toEqual(['engineer-riser-1'])
    expect(intersecting(3)).toEqual(['engineer-riser-1', 'engineer-riser-2'])
    expect(intersecting(5)).toEqual(['engineer-riser-1'])
    // Vent stack D intersects every storey but is never in the sanitary set.
    expect(stacksIntersectingBand(classification.ventStacks, storeySlabBandM(tower, 1)!)).toHaveLength(1)
  })

  it('uses segment Z-ranges, not containment storeys, when a full-height run is drawn on one storey', () => {
    // One 0..15 m pipe contained in storey 3 only (as 096 models its tower runs on one storey).
    const singleStoreyModel = network(
      [vertical(50, 100, 100, 0, 1500, { storeyId: 3, storeyName: 'L3' })],
      storeys,
    )
    const stacks = classifyEngineerRiserStacks(singleStoreyModel, SYNTHETIC_CLASSES).sanitaryStacks
    expect(stacks).toHaveLength(1)
    expect(stacks[0].storeys).toEqual([{ id: 3, name: 'L3' }])
    expect(stacks[0].spannedStoreyIds).toEqual([1, 2, 3, 4, 5])
    for (const level of [1, 2, 3, 4, 5]) {
      expect(stacksIntersectingBand(stacks, storeySlabBandM(singleStoreyModel, level)!)).toHaveLength(1)
    }

    // A 0..7.5 m pipe on storey 5 reaches storeys 1..3 only (storey 3 band [6, 9) overlaps 1.5 m).
    const partial = network(
      [vertical(51, 100, 100, 0, 750, { storeyId: 5, storeyName: 'L5' })],
      storeys,
    )
    const partialStacks = classifyEngineerRiserStacks(partial, SYNTHETIC_CLASSES).sanitaryStacks
    expect(partialStacks[0].spannedStoreyIds).toEqual([1, 2, 3])
    expect(stacksIntersectingBand(partialStacks, storeySlabBandM(partial, 5)!)).toHaveLength(0)
  })
})
