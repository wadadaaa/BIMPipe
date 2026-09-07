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
  ENGINEER_FITTING_BRIDGE_TOLERANCE_M,
  ENGINEER_FITTING_BRIDGE_TOLERANCE_MM,
  ENGINEER_HANG_DEPTH_M,
  ENGINEER_HANG_DEPTH_MM,
  ENGINEER_JUNCTION_TOLERANCE_M,
  ENGINEER_JUNCTION_TOLERANCE_MM,
  ENGINEER_SLOPE_AGREEMENT_TOLERANCE_PERCENT,
  ENGINEER_SLOPE_MAX_REPORTED_PERCENT,
  ENGINEER_SLOPE_MIN_DATA_M,
  ENGINEER_SLOPE_MIN_DATA_MM,
  ENGINEER_SLOPE_MIN_RUN_M,
  ENGINEER_SLOPE_MIN_RUN_MM,
  ENGINEER_STACK_JOIN_TOLERANCE_M,
  selectEngineerServedStacks,
  classifyEngineerRiserStacks,
  classifyEngineerRunRoles,
  decodeFittingConnectorExpressId,
  deriveStoreyPitchM,
  ENGINEER_FITTING_MAX_PORTS,
  fittingConnectorExpressId,
  isFittingConnector,
  engineerSegmentHorizontalLengthM,
  engineerSegmentSlopePercent,
  isVerticalEngineerSegment,
  resolveEngineerSegmentSlope,
  selectEngineerBranchSegments,
  selectEngineerStoreyHorizontals,
  slopePercentFromInvertElevations,
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

describe('selectEngineerBranchSegments', () => {
  const storeys: EngineerStoreyRef[] = [
    { id: 1, name: 'L1', elevationSource: 0 },
    { id: 2, name: 'L2', elevationSource: 300 },
    { id: 3, name: 'L3', elevationSource: 600 },
  ]
  /** Horizontal cm-unit segment at height z, 4 m long. */
  const horizontal = (expressId: number, z: number, overrides: Partial<EngineerPipeSegment> = {}) =>
    segment({ expressId, start: { x: 0, y: 0, z }, end: { x: 400, y: 0, z }, lengthM: 4, ...overrides })

  it('keeps horizontal sanitary segments whose Z lies in the band [bottom, top), sorted by expressId', () => {
    const net = network(
      [
        horizontal(9, 450), // L2 band [3, 6)
        horizontal(4, 300), // exactly the band bottom → belongs to L2
        horizontal(5, 600), // exactly the band top → belongs to L3
        horizontal(6, 290), // just below → L1
        horizontal(7, 450, { storeyId: 1 }), // containment disagrees; geometry wins
      ],
      storeys,
    )
    const selection = selectEngineerBranchSegments(net, storeySlabBandM(net, 2)!, {
      systemPrefixes: ['XX-GRV'],
    })
    expect(selection.segments.map((s) => s.expressId)).toEqual([4, 7, 9])
    expect(selection.byGeometryCount).toBe(3)
    expect(selection.byContainmentCount).toBe(0)
  })

  it('excludes vertical runs and other systems, and never counts them', () => {
    const net = network(
      [
        vertical(1, 0, 0, 300, 600),
        horizontal(2, 450, { systemName: 'XX-VNT 3' }),
        horizontal(3, 450, { systemName: null }),
        horizontal(4, 450),
      ],
      storeys,
    )
    const selection = selectEngineerBranchSegments(net, storeySlabBandM(net, 2)!, {
      systemPrefixes: ['XX-GRV'],
    })
    expect(selection.segments.map((s) => s.expressId)).toEqual([4])
  })

  it('falls back to IFC storey containment for segments without a centreline and counts them separately', () => {
    const geometryless = (expressId: number, storeyId: number | null, invertElevationM: number | null) =>
      segment({ expressId, start: null, end: null, endpointSource: null, storeyId, lengthM: 1.5, invertElevationM })
    const net = network(
      [
        horizontal(1, 450),
        geometryless(2, 2, 4.2), // contained in L2, invert inside the band → kept
        geometryless(3, 1, 4.2), // contained elsewhere → not this storey's
        geometryless(4, null, 4.2), // no containment → cannot be placed
        geometryless(5, 2, null), // contained in L2, no invert → containment is all there is → kept
        geometryless(6, 2, 2.0), // 1.0 m under the L2 slab: within the 1.2 m hang depth → kept
      ],
      storeys,
    )
    const selection = selectEngineerBranchSegments(net, storeySlabBandM(net, 2)!, {
      systemPrefixes: ['XX-GRV'],
    })
    expect(selection.segments.map((s) => s.expressId)).toEqual([1, 2, 5, 6])
    expect(selection.byGeometryCount).toBe(1)
    expect(selection.byContainmentCount).toBe(3)
    expect(selection.byContainmentRejectedCount).toBe(0)
    expect(selection.byContainmentRejectedLengthM).toBe(0)
  })

  it('rejects a contained geometry-less segment whose invert contradicts the band, reporting its Pset length', () => {
    // R1 F2 audit: a full-height stack the model files on one storey has no
    // resolved centreline and a Pset invert metres below the storey — it is
    // not a horizontal of that storey and must not inflate its branch length.
    const geometryless = (expressId: number, invertElevationM: number, lengthM: number) =>
      segment({ expressId, start: null, end: null, endpointSource: null, storeyId: 2, lengthM, invertElevationM })
    const net = network(
      [
        geometryless(1, -12.0, 20), // 15 m below the L2 band → rejected
        geometryless(2, 1.79, 5), // 1.21 m under the slab, just beyond the 1.2 m hang depth → rejected
        geometryless(3, 1.8, 2), // exactly at the hang-depth limit → kept
        geometryless(4, 6.0, 7), // at the band top (belongs to L3) → rejected
        geometryless(5, 5.99, 1), // just under the top → kept
      ],
      storeys,
    )
    const selection = selectEngineerBranchSegments(net, storeySlabBandM(net, 2)!, {
      systemPrefixes: ['XX-GRV'],
    })
    expect(selection.segments.map((s) => s.expressId)).toEqual([3, 5])
    expect(selection.byContainmentCount).toBe(2)
    expect(selection.byContainmentRejectedCount).toBe(3)
    expect(selection.byContainmentRejectedLengthM).toBe(32)

    // A wider hang depth keeps the 1.21 m piece; the rule is the option, not a magic number.
    const deeper = selectEngineerBranchSegments(net, storeySlabBandM(net, 2)!, { systemPrefixes: ['XX-GRV'], hangDepthM: 1.5 })
    expect(deeper.segments.map((s) => s.expressId)).toEqual([2, 3, 5])
    expect(deeper.byContainmentRejectedCount).toBe(2)
    expect(deeper.byContainmentRejectedLengthM).toBe(27)

    // Without a band there is no storey to contradict: every geometry-less piece counts by containment.
    const modelWide = selectEngineerBranchSegments(net, null, { systemPrefixes: ['XX-GRV'] })
    expect(modelWide.segments).toHaveLength(5)
    expect(modelWide.byContainmentRejectedCount).toBe(0)
  })

  it('treats the top storey band as open-ended', () => {
    const net = network([horizontal(1, 5000)], storeys)
    expect(selectEngineerBranchSegments(net, storeySlabBandM(net, 3)!, { systemPrefixes: ['XX-GRV'] }).segments).toHaveLength(1)
  })

  it('a null band selects every horizontal sanitary segment model-wide', () => {
    const net = network(
      [
        horizontal(1, 0),
        horizontal(2, 900),
        vertical(3, 0, 0, 0, 900),
        segment({ expressId: 4, start: null, end: null, endpointSource: null, storeyId: null }),
      ],
      storeys,
    )
    const selection = selectEngineerBranchSegments(net, null, { systemPrefixes: ['XX-GRV'] })
    expect(selection.segments.map((s) => s.expressId)).toEqual([1, 2, 4])
    expect(selection.byGeometryCount).toBe(2)
    expect(selection.byContainmentCount).toBe(1)
  })
})

describe('selectEngineerServedStacks', () => {
  const stacks = [
    { id: 'served-at-start', xM: 1, yM: 1 },
    { id: 'served-at-end-within-tolerance', xM: 8.4, yM: 1 }, // 0.4 m from the run end (8, 1)
    { id: 'pass-through', xM: 20, yM: 20 },
    { id: 'just-outside', xM: 8.51, yM: 1 },
  ]
  /** cm-unit horizontal (1, 1) → (8, 1) m. */
  const horizontals = [{ segment: segment({ expressId: 1, start: { x: 100, y: 100, z: 0 }, end: { x: 800, y: 100, z: 0 } }) }]

  it('keeps stacks with a horizontal endpoint within the 0.5 m join tolerance, preserving order, and lists the rest as pass-through', () => {
    expect(ENGINEER_STACK_JOIN_TOLERANCE_M).toBe(0.5)
    const selection = selectEngineerServedStacks(stacks, horizontals, 0.01)
    expect(selection.served.map((stack) => stack.id)).toEqual(['served-at-start', 'served-at-end-within-tolerance'])
    expect(selection.passThrough.map((stack) => stack.id)).toEqual(['pass-through', 'just-outside'])
    expect(selection.joinToleranceM).toBe(0.5)
  })

  it('ignores horizontals without a centreline and honours a custom tolerance', () => {
    const noGeometry = [{ segment: segment({ expressId: 2, start: null, end: null, endpointSource: null }) }]
    expect(selectEngineerServedStacks(stacks, noGeometry, 0.01).served).toEqual([])
    expect(selectEngineerServedStacks(stacks, noGeometry, 0.01).passThrough).toHaveLength(4)
    const wider = selectEngineerServedStacks(stacks, horizontals, 0.01, 0.6)
    expect(wider.served.map((stack) => stack.id)).toEqual(['served-at-start', 'served-at-end-within-tolerance', 'just-outside'])
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

// ---------------------------------------------------------------------------
// G2: storey horizontals (band + hang), slope, run roles
// ---------------------------------------------------------------------------

/** Horizontal cm-unit segment from (x0, y0) to (x1, y1) at heights z0 → z1. */
function horizontal(
  expressId: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number = z0,
  overrides: Partial<EngineerPipeSegment> = {},
): EngineerPipeSegment {
  return segment({ expressId, start: { x: x0, y: y0, z: z0 }, end: { x: x1, y: y1, z: z1 }, ...overrides })
}

describe('selectEngineerStoreyHorizontals', () => {
  const band = { bottomM: 3, topM: 6 }
  const options = { systemPrefixes: ['XX-GRV'] }

  it('admits runs in the storey band, in the hang band under the slab, or both, and counts each rule', () => {
    const net = network([
      horizontal(1, 0, 0, 200, 0, 350), // in band (3.5 m)
      horizontal(2, 0, 0, 200, 0, 275), // hangs 0.25 m under the slab
      horizontal(3, 0, 0, 200, 0, 290, 310), // crosses the slab level: both
      horizontal(4, 0, 0, 200, 0, 170), // 1.3 m under the slab: below the hang band
      horizontal(5, 0, 0, 200, 0, 600), // exactly at the next slab: next storey's band
      horizontal(6, 0, 0, 200, 0, 400, undefined, { systemName: 'XX-VNT 1' }), // other system
      vertical(7, 0, 0, 300, 600), // vertical: never a horizontal
      segment({ expressId: 8, start: null, end: null }), // unresolved
    ])
    const selection = selectEngineerStoreyHorizontals(net, band, options)
    expect(selection.horizontals.map((entry) => [entry.segment.expressId, entry.rule])).toEqual([
      [1, 'in-band'],
      [2, 'in-hang'],
      [3, 'both'],
    ])
    expect(selection.inBandCount).toBe(2)
    expect(selection.inHangCount).toBe(2)
    expect(selection.bothCount).toBe(1)
    expect(selection.unresolvedCount).toBe(1)
    expect(selection.hangDepthM).toBe(ENGINEER_HANG_DEPTH_M)
  })

  it('hangDepthM = 0 reproduces the literal band scope', () => {
    const net = network([horizontal(1, 0, 0, 200, 0, 350), horizontal(2, 0, 0, 200, 0, 275)])
    const selection = selectEngineerStoreyHorizontals(net, band, { ...options, hangDepthM: 0 })
    expect(selection.horizontals.map((entry) => entry.segment.expressId)).toEqual([1])
    expect(selection.inHangCount).toBe(0)
  })

  it('the hang band is half-open: a run exactly at the slab is in the band, not hanging', () => {
    const net = network([horizontal(1, 0, 0, 200, 0, 300)])
    const selection = selectEngineerStoreyHorizontals(net, band, options)
    expect(selection.horizontals[0].rule).toBe('in-band')
  })

  it('an open-ended top band admits everything above the slab', () => {
    const net = network([horizontal(1, 0, 0, 200, 0, 5000)])
    const selection = selectEngineerStoreyHorizontals(net, { bottomM: 3, topM: Infinity }, options)
    expect(selection.horizontals).toHaveLength(1)
  })

  it('exports consistent hang-depth constants', () => {
    expect(ENGINEER_HANG_DEPTH_M).toBeCloseTo(ENGINEER_HANG_DEPTH_MM / 1000, 12)
  })
})

describe('slope math', () => {
  it('endpoint Z over horizontal length: a 2 % fall over 3 m', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 300, 0, 100, 94), 0.01)
    expect(result).toEqual({ slopePercent: 2, source: 'endpoint-z', outlier: false, flat: false })
  })

  it('is negative when the run rises from start to end (caller flips)', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 300, 0, 94, 100), 0.01)
    expect(result.slopePercent).toBeCloseTo(-2, 9)
  })

  it('uses the horizontal (plan) length, not the 3D length', () => {
    // 3-4-5 in plan (5 m horizontal), 0.1 m fall → 2 %.
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 300, 400, 10, 0), 0.01)
    expect(result.slopePercent).toBeCloseTo(2, 9)
    expect(engineerSegmentHorizontalLengthM(horizontal(1, 0, 0, 300, 400, 10, 0), 0.01)).toBeCloseTo(5, 9)
  })

  it('a sub-millimetre fall on a run ≥ 100 mm is a measured 0 % (flat)', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 50, 0, 100, 100.05), 0.01)
    expect(result).toEqual({ slopePercent: 0, source: 'endpoint-z', outlier: false, flat: true })
  })

  it('a sub-millimetre fall on a run < 100 mm is null (unresolvable at 1 mm)', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 5, 0, 100, 100.05), 0.01)
    expect(result.slopePercent).toBeNull()
    expect(result.outlier).toBe(false)
  })

  it('a horizontal length below 1 mm is null, never a division blow-up', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 0.05, 0, 100, 90), 0.01)
    expect(result.slopePercent).toBeNull()
    expect(result.outlier).toBe(false)
  })

  it('flags |slope| > 10 % as an outlier with the raw value, without a drawn slope', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 100, 0, 100, 0), 0.01)
    expect(result.slopePercent).toBeNull()
    expect(result.outlier).toBe(true)
    if (result.outlier) expect(result.rawPercent).toBeCloseTo(100, 9)
    expect(engineerSegmentSlopePercent(horizontal(2, 0, 0, 100, 0, 100, 90), 0.01).slopePercent).toBeCloseTo(10, 9)
  })

  it('missing geometry is null with a reason', () => {
    const result = engineerSegmentSlopePercent(segment({ expressId: 1, start: null, end: null }), 0.01)
    expect(result).toEqual({ slopePercent: null, source: null, outlier: false, reason: 'no resolved centreline' })
  })

  it('prefers invert elevations when both ends are known', () => {
    const result = engineerSegmentSlopePercent(horizontal(1, 0, 0, 400, 0, 100, 100), 0.01, { startM: 1.08, endM: 1.0 })
    expect(result.slopePercent).toBeCloseTo(2, 9)
    expect(result.source).toBe('invert-elevations')
    expect(result.outlier).toBe(false)
    expect(slopePercentFromInvertElevations(null, 1, 4).slopePercent).toBeNull()
    expect(slopePercentFromInvertElevations(1.08, 1, null).slopePercent).toBeNull()
  })

  it('exports consistent slope constants', () => {
    expect(ENGINEER_SLOPE_MIN_DATA_M).toBeCloseTo(ENGINEER_SLOPE_MIN_DATA_MM / 1000, 12)
    expect(ENGINEER_SLOPE_MIN_RUN_M).toBeCloseTo(ENGINEER_SLOPE_MIN_RUN_MM / 1000, 12)
    expect(ENGINEER_SLOPE_MAX_REPORTED_PERCENT).toBe(10)
  })
})

describe('resolveEngineerSegmentSlope (invert elevations with endpoint-Z fallback)', () => {
  // 4 m run along X falling 8 cm start → end by its centreline (2 %).
  const falling = (overrides: Partial<EngineerPipeSegment> = {}) => horizontal(1, 0, 0, 400, 0, 108, 100, overrides)
  // Inverts on their own datum (Revit's are not the geometry's): 20 m above, same 8 cm fall.
  const agreeingInverts = { upperEndM: 21.0, lowerEndM: 20.92 }

  it('draws the invert slope when both ends carry an invert, and reports agreement with endpoint Z', () => {
    const result = resolveEngineerSegmentSlope(falling({ endInvertElevationsM: agreeingInverts }), 0.01)
    expect(result.source).toBe('invert')
    expect(result.slope.slopePercent).toBeCloseTo(2, 9)
    expect(result.slope.source).toBe('invert-elevations')
    expect(result.invert!.slopePercent).toBeCloseTo(2, 9)
    expect(result.endpointZ.slopePercent).toBeCloseTo(2, 9)
    expect(result.differencePercent).toBeCloseTo(0, 9)
    expect(result.disagrees).toBe(false)
    expect(result.agreementTolerancePercent).toBe(ENGINEER_SLOPE_AGREEMENT_TOLERANCE_PERCENT)
  })

  it('prefers the invert slope over endpoint Z when they disagree beyond the tolerance, and flags the run', () => {
    // Inverts say 4 cm over 4 m = 1 %; the centreline says 2 %: 1 pp apart.
    const result = resolveEngineerSegmentSlope(falling({ endInvertElevationsM: { upperEndM: 21.0, lowerEndM: 20.96 } }), 0.01)
    expect(result.source).toBe('invert')
    expect(result.slope.slopePercent).toBeCloseTo(1, 9)
    expect(result.endpointZ.slopePercent).toBeCloseTo(2, 9)
    expect(result.differencePercent).toBeCloseTo(1, 9)
    expect(result.disagrees).toBe(true)
    // A wider tolerance turns the same pair into an agreement; the drawn value is unchanged.
    const lenient = resolveEngineerSegmentSlope(falling({ endInvertElevationsM: { upperEndM: 21.0, lowerEndM: 20.96 } }), 0.01, {
      agreementTolerancePercent: 1.5,
    })
    expect(lenient.disagrees).toBe(false)
    expect(lenient.slope.slopePercent).toBeCloseTo(1, 9)
  })

  it('falls back to endpoint Z when the run carries no both-end inverts — a single invert is never a slope', () => {
    for (const segment of [falling(), falling({ endInvertElevationsM: null }), falling({ invertElevationM: 20.92 })]) {
      const result = resolveEngineerSegmentSlope(segment, 0.01)
      expect(result.source).toBe('endpoint-z')
      expect(result.slope).toEqual({ slopePercent: 2, source: 'endpoint-z', outlier: false, flat: false })
      expect(result.invert).toBeNull()
      expect(result.differencePercent).toBeNull()
      expect(result.disagrees).toBe(false)
    }
  })

  it('signs the invert slope along start → end from the centreline (a rising run is negative, like endpoint Z)', () => {
    const rising = horizontal(1, 0, 0, 400, 0, 100, 108, { endInvertElevationsM: agreeingInverts })
    const result = resolveEngineerSegmentSlope(rising, 0.01)
    expect(result.source).toBe('invert')
    expect(result.slope.slopePercent).toBeCloseTo(-2, 9)
    expect(result.endpointZ.slopePercent).toBeCloseTo(-2, 9)
    expect(result.disagrees).toBe(false)
  })

  it('uses the absolute difference of a pair written the wrong way round', () => {
    const result = resolveEngineerSegmentSlope(falling({ endInvertElevationsM: { upperEndM: 20.92, lowerEndM: 21.0 } }), 0.01)
    expect(result.slope.slopePercent).toBeCloseTo(2, 9)
    expect(result.source).toBe('invert')
  })

  it('reports an invert 0 % as a measured flat, and compares outliers by their raw value', () => {
    const flat = resolveEngineerSegmentSlope(falling({ endInvertElevationsM: { upperEndM: 21.0, lowerEndM: 21.0 } }), 0.01)
    expect(flat.slope).toEqual({ slopePercent: 0, source: 'invert-elevations', outlier: false, flat: true })
    expect(flat.disagrees).toBe(true) // 0 % vs the centreline's 2 %
    // 45° offset: both sources say ~100 %, both outliers, no disagreement.
    const offset = horizontal(1, 0, 0, 30, 0, 340, 310, { endInvertElevationsM: { upperEndM: 3.3, lowerEndM: 3.0 } })
    const result = resolveEngineerSegmentSlope(offset, 0.01)
    expect(result.source).toBe('invert')
    expect(result.slope.slopePercent).toBeNull()
    expect(result.slope.outlier).toBe(true)
    expect(result.differencePercent).toBeCloseTo(0, 6)
    expect(result.disagrees).toBe(false)
  })

  it('falls through to endpoint Z (also unresolved) when the run is too short for either source to resolve', () => {
    const tiny = horizontal(1, 0, 0, 5, 0, 100, 100.05, { endInvertElevationsM: { upperEndM: 1.0005, lowerEndM: 1.0 } })
    const result = resolveEngineerSegmentSlope(tiny, 0.01)
    expect(result.source).toBeNull()
    expect(result.slope.slopePercent).toBeNull()
    expect(result.invert!.source).toBeNull()
    expect(result.differencePercent).toBeNull()
  })

  it('has no slope at all without a centreline, even with inverts', () => {
    const result = resolveEngineerSegmentSlope(segment({ expressId: 1, start: null, end: null, endInvertElevationsM: agreeingInverts }), 0.01)
    expect(result.source).toBeNull()
    expect(result.invert).toBeNull()
    expect(result.slope).toEqual({ slopePercent: null, source: null, outlier: false, reason: 'no resolved centreline' })
  })
})

describe('classifyEngineerRunRoles', () => {
  it('a run joined by two upstream branches is a collector; the branches stay branches', () => {
    // Collector along X at y = 0, falling towards +x; two branches drop onto its interior.
    const collector = horizontal(10, 0, 0, 600, 0, 100, 88)
    const branchA = horizontal(11, 200, 300, 200, 0, 102, 96)
    const branchB = horizontal(12, 400, -300, 400, 0, 98, 92)
    const roles = classifyEngineerRunRoles([branchB, collector, branchA], 0.01)
    expect(roles.roles.get(10)).toBe('collector')
    expect(roles.roles.get(11)).toBe('branch')
    expect(roles.roles.get(12)).toBe('branch')
    expect(roles.collectorCount).toBe(1)
    expect(roles.toleranceM).toBe(ENGINEER_JUNCTION_TOLERANCE_M)
    expect(roles.junctions.map((junction) => [junction.fromExpressId, junction.intoExpressId, junction.upstream])).toEqual([
      [11, 10, true],
      [12, 10, true],
    ])
  })

  it('one upstream branch is not enough', () => {
    const collector = horizontal(10, 0, 0, 600, 0, 100, 88)
    const branchA = horizontal(11, 200, 300, 200, 0, 102, 96)
    expect(classifyEngineerRunRoles([collector, branchA], 0.01).roles.get(10)).toBe('branch')
  })

  it('a downstream continuation joining at the collector end does not count as upstream', () => {
    // Run 10 falls into run 20 (its lower end meets 20's start); 20 continues away at an angle.
    const run = horizontal(10, 0, 0, 300, 0, 100, 94)
    const next = horizontal(20, 300, 0, 300, 300, 94, 88)
    const roles = classifyEngineerRunRoles([run, next], 0.01)
    const into10 = roles.junctions.filter((junction) => junction.intoExpressId === 10)
    expect(into10).toHaveLength(1)
    expect(into10[0].upstream).toBe(false) // 20 joins 10 with its HIGHER end
    expect(roles.roles.get(10)).toBe('branch')
    expect(roles.roles.get(20)).toBe('branch')
  })

  it('a straight flat run split into three collinear pieces is not a collector', () => {
    const pieces = [
      horizontal(1, 0, 0, 200, 0, 100),
      horizontal(2, 200, 0, 400, 0, 100),
      horizontal(3, 400, 0, 600, 0, 100),
    ]
    const roles = classifyEngineerRunRoles(pieces, 0.01)
    expect(roles.roles.get(2)).toBe('branch')
    expect(roles.junctions.filter((junction) => junction.intoExpressId === 2).every((junction) => junction.continuation)).toBe(
      true,
    )
  })

  it('flat branches joining a flat collector count as upstream at both ends', () => {
    const collector = horizontal(10, 0, 0, 600, 0, 100)
    const branchA = horizontal(11, 200, 300, 200, 0, 100)
    const branchB = horizontal(12, 400, -300, 400, 0, 100)
    expect(classifyEngineerRunRoles([collector, branchA, branchB], 0.01).roles.get(10)).toBe('collector')
  })

  it('respects the tolerance: a 100 mm gap is bridged only at the fitting tolerance', () => {
    const collector = horizontal(10, 0, 0, 600, 0, 100, 88)
    const branchA = horizontal(11, 200, 300, 200, 10, 102, 96) // ends 100 mm short of the axis
    const branchB = horizontal(12, 400, -300, 400, -10, 98, 92)
    expect(classifyEngineerRunRoles([collector, branchA, branchB], 0.01).roles.get(10)).toBe('branch')
    expect(
      classifyEngineerRunRoles([collector, branchA, branchB], 0.01, ENGINEER_FITTING_BRIDGE_TOLERANCE_M).roles.get(10),
    ).toBe('collector')
    expect(ENGINEER_FITTING_BRIDGE_TOLERANCE_M).toBeCloseTo(ENGINEER_FITTING_BRIDGE_TOLERANCE_MM / 1000, 12)
    expect(ENGINEER_JUNCTION_TOLERANCE_M).toBeCloseTo(ENGINEER_JUNCTION_TOLERANCE_MM / 1000, 12)
  })

  it('ignores segments without geometry and is deterministic in input order', () => {
    const collector = horizontal(10, 0, 0, 600, 0, 100, 88)
    const branchA = horizontal(11, 200, 300, 200, 0, 102, 96)
    const branchB = horizontal(12, 400, -300, 400, 0, 98, 92)
    const ghost = segment({ expressId: 13, start: null, end: null })
    const a = classifyEngineerRunRoles([ghost, branchB, collector, branchA], 0.01)
    const b = classifyEngineerRunRoles([collector, branchA, branchB, ghost], 0.01)
    expect(a.roles.has(13)).toBe(false)
    expect([...a.roles.entries()]).toEqual([...b.roles.entries()])
    expect(a.junctions).toEqual(b.junctions)
  })
})

// ---------------------------------------------------------------------------
// Fitting connectors (R3)
// ---------------------------------------------------------------------------

/** Connector of fitting `fittingId`: body origin → port `portIndex`. */
function connector(
  fittingId: number,
  portIndex: number,
  origin: [number, number, number],
  port: [number, number, number],
  overrides: Partial<EngineerPipeSegment> = {},
): EngineerPipeSegment {
  return segment({
    expressId: fittingConnectorExpressId(fittingId, portIndex),
    elementKind: 'fitting',
    fittingExpressId: fittingId,
    start: { x: origin[0], y: origin[1], z: origin[2] },
    end: { x: port[0], y: port[1], z: port[2] },
    endpointSource: 'distribution-ports',
    lengthM: null,
    ...overrides,
  })
}

describe('fittingConnectorExpressId', () => {
  it('is negative, unique per (fitting, port) and decodable', () => {
    const seen = new Set<number>()
    for (const fittingId of [1, 2, 4093, 1_000_003]) {
      for (let port = 0; port < ENGINEER_FITTING_MAX_PORTS; port++) {
        const id = fittingConnectorExpressId(fittingId, port)
        expect(id).toBeLessThan(0)
        expect(Number.isInteger(id)).toBe(true)
        expect(seen.has(id)).toBe(false)
        seen.add(id)
        expect(decodeFittingConnectorExpressId(id)).toEqual({ fittingExpressId: fittingId, portIndex: port })
      }
    }
    expect(decodeFittingConnectorExpressId(17)).toBeNull()
    expect(decodeFittingConnectorExpressId(0)).toBeNull()
    expect(isFittingConnector(connector(9, 0, [0, 0, 0], [1, 0, 0]))).toBe(true)
    expect(isFittingConnector(horizontal(1, 0, 0, 1, 0, 0))).toBe(false)
  })
})

describe('selectEngineerStoreyHorizontals with fitting connectors', () => {
  const band = { bottomM: 3, topM: 6 }
  const options = { systemPrefixes: ['XX-GRV'] }
  const net: EngineerPipeNetwork = {
    ...network([horizontal(1, 0, 0, 200, 0, 350), horizontal(2, 0, 0, 200, 0, 275)]),
    fittingConnectors: [
      connector(50, 0, [200, 0, 350], [205, 0, 350]), // horizontal, in band
      connector(50, 1, [200, 0, 350], [200, 0, 340]), // vertical (elbow turning down): never a horizontal
      connector(51, 0, [0, 0, 275], [-5, 0, 275]), // in hang band
      connector(52, 0, [0, 0, 100], [-5, 0, 100]), // below the hang band
      connector(53, 0, [0, 0, 350], [-5, 0, 350], { systemName: 'XX-VNT 1' }), // other system
    ],
  }

  it('leaves connectors out by default (pipe-only pins keep their meaning)', () => {
    const selection = selectEngineerStoreyHorizontals(net, band, options)
    expect(selection.horizontals.map((entry) => entry.segment.expressId)).toEqual([1, 2])
    expect(selection.fittingConnectorCount).toBe(0)
  })

  it('admits connectors under the same system, verticality and band rules, counted apart from the pipes', () => {
    const selection = selectEngineerStoreyHorizontals(net, band, { ...options, includeFittingConnectors: true })
    expect(selection.horizontals.map((entry) => [entry.segment.expressId, entry.rule])).toEqual([
      [fittingConnectorExpressId(51, 0), 'in-hang'],
      [fittingConnectorExpressId(50, 0), 'in-band'],
      [1, 'in-band'],
      [2, 'in-hang'],
    ])
    expect(selection.fittingConnectorCount).toBe(2)
    expect(selection.inBandCount).toBe(1)
    expect(selection.inHangCount).toBe(1)
    expect(selection.bothCount).toBe(0)
    expect(selection.unresolvedCount).toBe(0)
  })
})

describe('classifyEngineerRunRoles through fitting bodies', () => {
  // Main run in two pieces (U upstream, D downstream) meeting at a tee at x = 300;
  // branch B enters the tee's side port. Bodies: tee T (id 70) origin (300, 0, 94),
  // ports 6 cm out along each arm. Nothing touches directly (gaps ≥ 6 cm > 5 cm tolerance).
  const upstreamRun = horizontal(10, 0, 0, 294, 0, 100, 94.1)
  const downstreamRun = horizontal(20, 306, 0, 600, 0, 93.9, 88)
  const branch = horizontal(30, 300, 300, 300, 6, 100, 94.1)
  const tee = [
    connector(70, 0, [300, 0, 94], [294, 0, 94]),
    connector(70, 1, [300, 0, 94], [306, 0, 94]),
    connector(70, 2, [300, 0, 94], [300, 6, 94]),
  ]
  const c = (port: number) => fittingConnectorExpressId(70, port)

  it('joins the pipes pipe → pipe through the body with the pipes\' own flow direction', () => {
    const roles = classifyEngineerRunRoles([...tee, branch, downstreamRun, upstreamRun], 0.01)
    const viaTee = roles.junctions.filter((junction) => junction.viaFittingExpressId === 70)
    expect(viaTee.map((junction) => [junction.fromExpressId, junction.intoExpressId, junction.continuation])).toEqual([
      [10, 20, true], // U continues into D through the tee
      [30, 20, false], // the branch joins D laterally
    ])
    // U → D is a continuation and the branch is one lateral feed: D collects nothing yet.
    expect(roles.roles.get(20)).toBe('branch')
    expect(roles.roles.get(10)).toBe('branch')
    for (const member of tee) expect(roles.roles.get(member.expressId)).toBe('branch')
  })

  it('a second lateral feed through another tee makes the downstream run a collector', () => {
    const branch2 = horizontal(40, 500, -300, 500, -6, 99, 93)
    const tee2 = [
      connector(80, 0, [500, 0, 92], [494, 0, 92]),
      connector(80, 1, [500, 0, 92], [506, 0, 92]),
      connector(80, 2, [500, 0, 92], [500, -6, 92]),
    ]
    // Split D so tee2 sits between two pieces of it.
    const dA = horizontal(20, 306, 0, 494, 0, 93.9, 92.1)
    const dB = horizontal(21, 506, 0, 800, 0, 91.9, 88)
    const roles = classifyEngineerRunRoles([...tee, ...tee2, branch, branch2, dA, dB, upstreamRun], 0.01)
    expect(roles.roles.get(21)).toBe('branch') // only branch2 feeds dB laterally (dA continues)
    expect(roles.roles.get(20)).toBe('branch') // only branch feeds dA laterally
    // Add a third branch straight onto dB's interior (a direct joint): dB now has 2 lateral feeds.
    const branch3 = horizontal(50, 700, 200, 700, 0, 95, 89.6)
    const withThird = classifyEngineerRunRoles([...tee, ...tee2, branch, branch2, branch3, dA, dB, upstreamRun], 0.01)
    expect(withThird.roles.get(21)).toBe('collector')
    expect(withThird.collectorCount).toBe(1)
  })

  it('flow junctions run feeder → connector → connector → outlet and never back up a pipe', () => {
    const roles = classifyEngineerRunRoles([...tee, branch, downstreamRun, upstreamRun], 0.01)
    const flow = new Map<number, number[]>()
    for (const junction of roles.junctions) {
      if (!junction.upstream) continue
      flow.set(junction.fromExpressId, [...(flow.get(junction.fromExpressId) ?? []), junction.intoExpressId].sort((a, b) => a - b))
    }
    // U and the branch drain into their connectors (and, via the body, into D).
    expect(flow.get(10)).toEqual([c(0), 20].sort((a, b) => a - b))
    expect(flow.get(30)).toEqual([c(2), 20].sort((a, b) => a - b))
    // Connectors of one body drain into each other; the outlet connector drains into D.
    expect(flow.get(c(0))).toEqual([c(1), c(2)].sort((a, b) => a - b))
    expect(flow.get(c(1))).toEqual([c(0), c(2), 20].sort((a, b) => a - b))
    // Nothing drains from a connector back into the feeders U or the branch.
    expect(flow.get(c(1))).not.toContain(10)
    expect(flow.get(c(2))).not.toContain(30)
    // D drains nowhere (its lower end is free).
    expect(flow.get(20)).toBeUndefined()
  })

  it('behaves exactly as before on a pipe-only input', () => {
    const collector = horizontal(10, 0, 0, 600, 0, 100, 88)
    const branchA = horizontal(11, 200, 300, 200, 0, 102, 96)
    const branchB = horizontal(12, 400, -300, 400, 0, 98, 92)
    const roles = classifyEngineerRunRoles([branchB, collector, branchA], 0.01)
    expect(roles.roles.get(10)).toBe('collector')
    expect(roles.junctions.every((junction) => junction.viaFittingExpressId === undefined)).toBe(true)
  })
})
