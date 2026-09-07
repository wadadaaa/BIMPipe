import { describe, expect, it } from 'vitest'
import type { ContinuityStoreyInput } from '@/domain/continuityMap'
import {
  classifyEngineerRiserStacks,
  ENGINEER_HANG_DEPTH_M,
  type EngineerPipeNetwork,
  type EngineerPipeSegment,
} from '@/domain/engineerPipes'
import type { Fixture } from '@/domain/types'
import { drawingContentOutsideBounds, drawingLabelsContaining, drawingModelHasNonFinite } from './drawingModelChecks'
import { buildEngineerFloorDrawing } from './engineerFloorDrawing'

/**
 * Synthetic two-storey plumbing model in centimetre source units (scale 0.01):
 * storey A at 0, storey B at 300 cm (3 m). Everything is neutral fixture data.
 *
 * Stacks (vertical Ø110 runs, 0 → 600 cm = through both storeys):
 *   S1 sanitary at (100, 100), S2 sanitary at (500, 100), V1 vent at (100, 400).
 *   Stub: a 1 m vertical piece on storey B only (excluded from stacks by extent).
 * Horizontals for storey B (slab at 300 cm):
 *   h1 collector along X at y = 100, z 320 → 308 (in band), joined by
 *   h2 and h3 branches dropping onto its interior (in band).
 *   h4 hangs 25 cm under the slab (in-hang), h5 crosses the slab level (both).
 *   h6 is 2 m under the slab (storey A's own run — not on storey B).
 *   h7 is a 45° offset piece (slope outlier). h8 is a vent horizontal in band.
 */
function seg(overrides: Partial<EngineerPipeSegment> & { expressId: number }): EngineerPipeSegment {
  return {
    name: `Pipe ${overrides.expressId}`,
    systemName: 'XX-GRV 1',
    storeyId: 200,
    storeyName: 'B',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 300 },
    endpointSource: 'extrusion-axis',
    outerDiameterMm: 110,
    lengthM: 3,
    invertElevationM: null,
    tag: '8828274',
    ...overrides,
  }
}

const SCALE = 0.01

function syntheticNetwork(): EngineerPipeNetwork {
  return {
    metersPerSourceUnit: SCALE,
    storeys: [
      { id: 100, name: 'A', elevationSource: 0 },
      { id: 200, name: 'B', elevationSource: 300 },
    ],
    segments: [
      seg({ expressId: 1, start: { x: 100, y: 100, z: 0 }, end: { x: 100, y: 100, z: 600 }, storeyId: 100, storeyName: 'A' }),
      seg({ expressId: 2, start: { x: 500, y: 100, z: 0 }, end: { x: 500, y: 100, z: 600 }, storeyId: 100, storeyName: 'A' }),
      seg({
        expressId: 3,
        systemName: 'XX-VNT 1',
        start: { x: 100, y: 400, z: 0 },
        end: { x: 100, y: 400, z: 600 },
      }),
      seg({ expressId: 4, start: { x: 300, y: 300, z: 300 }, end: { x: 300, y: 300, z: 400 }, lengthM: 1 }),
      // h1 collector (falls +x), Ø110
      seg({ expressId: 11, start: { x: 100, y: 100, z: 320 }, end: { x: 700, y: 100, z: 308 } }),
      // h2, h3 branches Ø50 landing on h1's interior at its actual Z (316 at x=300, 312 at x=500)
      seg({ expressId: 12, outerDiameterMm: 50, start: { x: 300, y: 400, z: 322 }, end: { x: 300, y: 100, z: 316 } }),
      seg({ expressId: 13, outerDiameterMm: 50, start: { x: 500, y: -200, z: 318 }, end: { x: 500, y: 100, z: 312 } }),
      // h4 hangs under the slab; drawn rising so the adapter flips it
      seg({ expressId: 14, outerDiameterMm: 50, start: { x: 600, y: 300, z: 271 }, end: { x: 600, y: 600, z: 275 } }),
      // h5 crosses the slab level
      seg({ expressId: 15, start: { x: 700, y: 100, z: 308 }, end: { x: 700, y: 400, z: 296 } }),
      // h6 belongs to storey A (2 m under B's slab)
      seg({ expressId: 16, start: { x: 100, y: 500, z: 104 }, end: { x: 400, y: 500, z: 98 }, storeyId: 100, storeyName: 'A' }),
      // h7 45° offset: 30 cm plan, 30 cm fall → 100 % slope outlier
      seg({ expressId: 17, outerDiameterMm: 50, start: { x: 200, y: 200, z: 340 }, end: { x: 230, y: 200, z: 310 }, lengthM: 0.42 }),
      // h8 vent horizontal in band
      seg({ expressId: 18, systemName: 'XX-VNT 1', outerDiameterMm: 75, start: { x: 100, y: 400, z: 500 }, end: { x: 300, y: 400, z: 500 } }),
      // unresolved matching segment
      seg({ expressId: 19, start: null, end: null, endpointSource: null }),
    ],
  }
}

const CLASSES = { sanitarySystemPrefixes: ['XX-GRV'], ventSystemPrefixes: ['XX-VNT'] } as const

/** Viewer-frame fixtures on the host storey (metres; z = −IFC y). */
const FIXTURES: Fixture[] = [
  { expressId: 901, name: 'F1', kind: 'TOILETPAN', storeyId: 200, position: { x: 3, y: 3.4, z: -4 } },
  { expressId: 902, name: 'F2', kind: 'WASHHANDBASIN', storeyId: 200, position: { x: 5, y: 3.4, z: 2 } },
  { expressId: 903, name: 'F3', kind: 'SINK', storeyId: 200, position: null },
  { expressId: 904, name: 'F4', kind: 'SINK', storeyId: 100, position: { x: 1, y: 0.4, z: -5 } },
]

const STRUCTURE_INPUT: Pick<ContinuityStoreyInput, 'obstructions' | 'voids'> = {
  obstructions: [
    { id: 'wall-1', kind: 'wall', footprint: { shape: 'bbox', bounds: { minX: -1, maxX: 9, minZ: -8, maxZ: -7.8 } } },
    { id: 'column-1', kind: 'column', footprint: { shape: 'bbox', bounds: { minX: 4, maxX: 4.4, minZ: -0.4, maxZ: 0 } } },
    { id: 'slab-1', kind: 'slab', footprint: { shape: 'bbox', bounds: { minX: -1, maxX: 9, minZ: -8, maxZ: 3 } } },
  ],
  voids: [{ id: 'opening-1', kind: 'slab-opening', footprint: { shape: 'bbox', bounds: { minX: 0.8, maxX: 1.2, minZ: -1.2, maxZ: -0.8 } } }],
}

function build(overrides: Partial<Parameters<typeof buildEngineerFloorDrawing>[0]> = {}) {
  const network = syntheticNetwork()
  const classification = classifyEngineerRiserStacks(network, CLASSES)
  return buildEngineerFloorDrawing({
    network,
    classification,
    storeyId: 200,
    storeyLabel: 'Storey 02',
    planBounds: { minX: -1, maxX: 9, minZ: -8, maxZ: 3 },
    structure: { storeyInput: STRUCTURE_INPUT },
    fixtures: FIXTURES,
    sanitarySystemPrefixes: CLASSES.sanitarySystemPrefixes,
    ventSystemPrefixes: CLASSES.ventSystemPrefixes,
    ...overrides,
  })
}

describe('buildEngineerFloorDrawing (synthetic)', () => {
  it('draws the intersecting sanitary stacks and the vent stack with neutral sheet tags', () => {
    const { model, diagnostics } = build()
    expect(model.title).toBe('Storey 02 — sanitary plan')
    expect(model.storeyLabel).toBe('Storey 02')
    // Both sanitary stacks are joined by a storey horizontal (h1 starts on
    // stack 1, h3 ends on stack 2): served, none passes through.
    expect(diagnostics.risers).toEqual({ sanitary: 2, sanitaryPassThrough: 0, sanitaryJoinToleranceM: 0.5, vent: 1, tagsFromEngineer: 0 })
    expect(model.risers.map((riser) => [riser.system, riser.tag, riser.diameterMm])).toEqual([
      ['sanitary', '2.1ק', 110],
      ['sanitary', '2.2ק', 110],
      ['vent', '2.3ק', 110],
    ])
    expect(model.risers[0].centre).toEqual({ xM: 1, yM: 1 })
    expect(model.risers[0].spansStoreyLabels).toEqual(['A', 'B'])
    // The Revit element id in `Tag` and the type name in `Name` never reach the sheet.
    expect(drawingLabelsContaining(model, ['8828274', 'Pipe'])).toEqual([])
  })

  it('leaves out a sanitary stack that only passes through the storey (no horizontal joins it)', () => {
    const network = syntheticNetwork()
    // A third full-height sanitary stack at (9, 9) m: intersects storey B's band, no run of B touches it.
    network.segments.push(
      seg({ expressId: 5, start: { x: 900, y: 900, z: 0 }, end: { x: 900, y: 900, z: 600 }, storeyId: 100, storeyName: 'A' }),
    )
    const classification = classifyEngineerRiserStacks(network, CLASSES)
    expect(classification.sanitaryStacks).toHaveLength(3)
    const { model, diagnostics } = buildEngineerFloorDrawing({
      network,
      classification,
      storeyId: 200,
      storeyLabel: 'Storey 02',
      sanitarySystemPrefixes: CLASSES.sanitarySystemPrefixes,
      ventSystemPrefixes: CLASSES.ventSystemPrefixes,
    })
    expect(diagnostics.risers.sanitary).toBe(2)
    expect(diagnostics.risers.sanitaryPassThrough).toBe(1)
    expect(model.risers.filter((riser) => riser.system === 'sanitary').map((riser) => riser.centre)).toEqual([
      { xM: 1, yM: 1 },
      { xM: 5, yM: 1 },
    ])
    // Sheet tags still count 1..n over the DRAWN stacks, then the vent.
    expect(model.risers.map((riser) => riser.tag)).toEqual(['2.1ק', '2.2ק', '2.3ק'])
  })

  it('uses a bare engineer sheet number from the stack segments when present', () => {
    const network = syntheticNetwork()
    network.segments[0] = { ...network.segments[0], tag: '7' }
    const classification = classifyEngineerRiserStacks(network, CLASSES)
    const { model, diagnostics } = buildEngineerFloorDrawing({
      network,
      classification,
      storeyId: 200,
      storeyLabel: 'Storey 02',
      sanitarySystemPrefixes: CLASSES.sanitarySystemPrefixes,
      ventSystemPrefixes: CLASSES.ventSystemPrefixes,
    })
    expect(model.risers[0].tag).toBe('2.7ק')
    expect(diagnostics.risers.tagsFromEngineer).toBe(1)
  })

  it('places horizontals by the storey band and the hang band, reporting both rules', () => {
    const { model, diagnostics } = build()
    expect(diagnostics.storeyBandM).toEqual({ bottomM: 3, topM: null })
    expect(diagnostics.hangDepthM).toBe(ENGINEER_HANG_DEPTH_M)
    // h1, h2, h3, h5, h7 in band; h4 + h5 in hang; h5 both; h6 excluded; 19 unresolved.
    expect(diagnostics.pipes.sanitary).toEqual({ inBand: 5, inHang: 2, both: 1, total: 6, unresolved: 1, fittingConnectors: 0 })
    expect(diagnostics.pipes.vent).toEqual({ inBand: 1, inHang: 0, both: 0, total: 1, unresolved: 0, fittingConnectors: 0 })
    expect(diagnostics.pipes.drawn).toBe(7)
    expect(model.pipes.map((pipe) => pipe.id)).toEqual([
      'engineer-pipe-11',
      'engineer-pipe-12',
      'engineer-pipe-13',
      'engineer-pipe-14',
      'engineer-pipe-15',
      'engineer-pipe-17',
      'engineer-pipe-18',
    ])
    expect(model.pipes.find((pipe) => pipe.id === 'engineer-pipe-18')!.system).toBe('vent')
    expect(diagnostics.pipes.diametersMm).toEqual({ '50': 4, '75': 1, '110': 2 })
  })

  it('hangDepthM = 0 reproduces the literal band scope; includeVentPipes = false drops vent runs', () => {
    const literal = build({ hangDepthM: 0, includeVentPipes: false })
    expect(literal.diagnostics.pipes.sanitary).toEqual({ inBand: 5, inHang: 0, both: 0, total: 5, unresolved: 1, fittingConnectors: 0 })
    expect(literal.model.pipes.every((pipe) => pipe.system === 'sanitary')).toBe(true)
  })

  it('orients runs upstream → downstream and reports the fall as a positive slope', () => {
    const { model, diagnostics } = build()
    const h4 = model.pipes.find((pipe) => pipe.id === 'engineer-pipe-14')!
    expect(diagnostics.pipes.flipped).toBe(1)
    expect(h4.start).toEqual({ xM: 6, yM: 6 })
    expect(h4.end).toEqual({ xM: 6, yM: 3 })
    expect(h4.slopePercent).toBeCloseTo((0.04 / 3) * 100, 9)
    const h1 = model.pipes.find((pipe) => pipe.id === 'engineer-pipe-11')!
    expect(h1.slopePercent).toBeCloseTo(2, 9)
    for (const pipe of model.pipes) {
      if (pipe.slopePercent !== null) expect(pipe.slopePercent).toBeGreaterThanOrEqual(0)
    }
  })

  it('flags the 45° offset as an outlier (null slope, raw value in diagnostics) and measures flats as 0 %', () => {
    const { model, diagnostics } = build()
    const h7 = model.pipes.find((pipe) => pipe.id === 'engineer-pipe-17')!
    expect(h7.slopePercent).toBeNull()
    expect(diagnostics.slope.outliers).toHaveLength(1)
    expect(diagnostics.slope.outliers[0].pipeId).toBe('engineer-pipe-17')
    expect(diagnostics.slope.outliers[0].rawPercent).toBeCloseTo(100, 6)
    const h8 = model.pipes.find((pipe) => pipe.id === 'engineer-pipe-18')!
    expect(h8.slopePercent).toBe(0)
    expect(diagnostics.slope.flat).toBe(1)
    expect(diagnostics.slope.belowResolution).toBe(0)
    expect(diagnostics.slope.withSlope).toBe(6)
    expect(diagnostics.slope.extrusionRuns).toBe(7)
    expect(diagnostics.slope.extrusionCoverage).toBeCloseTo(6 / 7, 9)
  })

  it('records that every slope came from endpoint Z when no run carries both-end inverts', () => {
    const { diagnostics } = build()
    expect(diagnostics.slope.withEndInverts).toBe(0)
    expect(diagnostics.slope.withoutEndInverts).toBe(7)
    // 6 drawn values + the outlier verdict on h7, all from the centreline.
    expect(diagnostics.slope.bySource).toEqual({ invert: 0, 'endpoint-z': 7 })
    expect(Object.keys(diagnostics.slope.sourceByPipeId).sort()).toEqual(
      ['engineer-pipe-11', 'engineer-pipe-12', 'engineer-pipe-13', 'engineer-pipe-14', 'engineer-pipe-15', 'engineer-pipe-17', 'engineer-pipe-18'],
    )
    expect(diagnostics.slope.agreementHistogram).toEqual({ '<=0.1': 0, '<=0.5': 0, '<=1': 0, '>1': 0 })
    expect(diagnostics.slope.agreementTolerancePercent).toBe(0.5)
    expect(diagnostics.slope.disagreements).toEqual([])
  })

  it('draws slopes from both-end invert elevations where present, falls back to endpoint Z elsewhere, and counts disagreements', () => {
    const network = syntheticNetwork()
    network.segments = network.segments.map((segment) => {
      // h1: inverts on their own datum agreeing with the centreline (12 cm over 6 m = 2 %).
      if (segment.expressId === 11) return { ...segment, endInvertElevationsM: { upperEndM: 50.12, lowerEndM: 50.0 } }
      // h4 (drawn flipped): inverts say 3 cm over 3 m = 1 %, the centreline 4 cm = 1.33 % → agree within 0.5 pp.
      if (segment.expressId === 14) return { ...segment, endInvertElevationsM: { upperEndM: 50.03, lowerEndM: 50.0 } }
      // h5: inverts say 9 cm over 3 m = 3 %, the centreline 12 cm = 4 % → disagreement; invert drawn.
      if (segment.expressId === 15) return { ...segment, endInvertElevationsM: { upperEndM: 50.09, lowerEndM: 50.0 } }
      // h8 (vent, flat by geometry): a single Pset invert only — never a slope source.
      if (segment.expressId === 18) return { ...segment, invertElevationM: 4.96 }
      return segment
    })
    const classification = classifyEngineerRiserStacks(network, CLASSES)
    const { model, diagnostics } = build({ network, classification })
    const byId = new Map(model.pipes.map((pipe) => [pipe.id, pipe]))
    expect(byId.get('engineer-pipe-11')!.slopePercent).toBeCloseTo(2, 9)
    expect(byId.get('engineer-pipe-14')!.slopePercent).toBeCloseTo(1, 9)
    expect(byId.get('engineer-pipe-15')!.slopePercent).toBeCloseTo(3, 9)
    expect(byId.get('engineer-pipe-12')!.slopePercent).toBeCloseTo(2, 9)
    expect(byId.get('engineer-pipe-18')!.slopePercent).toBe(0)
    // Flipped runs keep a positive fall from either source.
    for (const pipe of model.pipes) if (pipe.slopePercent !== null) expect(pipe.slopePercent).toBeGreaterThanOrEqual(0)

    expect(diagnostics.slope.withEndInverts).toBe(3)
    expect(diagnostics.slope.withoutEndInverts).toBe(4)
    expect(diagnostics.slope.bySource).toEqual({ invert: 3, 'endpoint-z': 4 })
    expect(diagnostics.slope.sourceByPipeId).toEqual({
      'engineer-pipe-11': 'invert',
      'engineer-pipe-12': 'endpoint-z',
      'engineer-pipe-13': 'endpoint-z',
      'engineer-pipe-14': 'invert',
      'engineer-pipe-15': 'invert',
      'engineer-pipe-17': 'endpoint-z',
      'engineer-pipe-18': 'endpoint-z',
    })
    expect(diagnostics.slope.agreementHistogram).toEqual({ '<=0.1': 1, '<=0.5': 1, '<=1': 1, '>1': 0 })
    expect(diagnostics.slope.disagreements).toHaveLength(1)
    expect(diagnostics.slope.disagreements[0].pipeId).toBe('engineer-pipe-15')
    expect(diagnostics.slope.disagreements[0].invertPercent).toBeCloseTo(3, 9)
    expect(diagnostics.slope.disagreements[0].endpointZPercent).toBeCloseTo(4, 9)
    // Coverage / flat / outlier counts are source-independent here.
    expect(diagnostics.slope.withSlope).toBe(6)
    expect(diagnostics.slope.outliers.map((outlier) => outlier.pipeId)).toEqual(['engineer-pipe-17'])
  })

  it('marks the run joined by two upstream branches as the collector', () => {
    const { model, diagnostics } = build()
    expect(model.pipes.filter((pipe) => pipe.role === 'collector').map((pipe) => pipe.id)).toEqual(['engineer-pipe-11'])
    expect(diagnostics.collectors.count).toBe(1)
    expect(diagnostics.collectors.toleranceM).toBe(0.05)
    expect(diagnostics.collectors.bridged.count).toBeGreaterThanOrEqual(1)
  })

  it('draws fitting connectors as unlabelled fitting runs, counted apart from the pipes, and keeps roles through the body (R3)', () => {
    // Move branch h2 6 cm short of h1 and close the gap with a tee body at (300, 100, 316):
    // ports on h1's line either side and on the branch end.
    const network = syntheticNetwork()
    network.segments = network.segments.map((segment) =>
      segment.expressId === 12 ? { ...segment, end: { x: 300, y: 106, z: 316.1 } } : segment,
    )
    const tee = (port: number, end: { x: number; y: number; z: number }): EngineerPipeSegment =>
      seg({
        expressId: -(777 * 8 + port + 1),
        elementKind: 'fitting',
        fittingExpressId: 777,
        start: { x: 300, y: 100, z: 316 },
        end,
        endpointSource: 'distribution-ports',
        outerDiameterMm: port === 2 ? 50 : 110,
        lengthM: null,
      })
    network.fittingConnectors = [
      tee(0, { x: 294, y: 100, z: 316 }),
      tee(1, { x: 306, y: 100, z: 316 }),
      tee(2, { x: 300, y: 106, z: 316 }),
      // a vertical connector (elbow turning down) is never a horizontal
      seg({ expressId: -(778 * 8 + 1), elementKind: 'fitting', fittingExpressId: 778, start: { x: 700, y: 100, z: 308 }, end: { x: 700, y: 100, z: 290 } }),
      // a connector of another storey's band is left out
      seg({ expressId: -(779 * 8 + 1), elementKind: 'fitting', fittingExpressId: 779, start: { x: 100, y: 500, z: 104 }, end: { x: 106, y: 500, z: 104 } }),
    ]
    const classification = classifyEngineerRiserStacks(network, CLASSES)
    const { model, diagnostics } = build({ network, classification })
    const connectors = model.pipes.filter((pipe) => pipe.fitting === true)
    // Sorted by (negative) synthetic express id: the highest port first.
    expect(connectors.map((pipe) => pipe.id)).toEqual(['engineer-fitting-777-2', 'engineer-fitting-777-1', 'engineer-fitting-777-0'])
    for (const connector of connectors) {
      expect(connector.system).toBe('sanitary')
      expect(connector.slopePercent).toBeNull()
      expect(connector.role).toBe('branch')
    }
    expect(connectors[0].diameterMm).toBe(50)
    expect(diagnostics.pipes.sanitary).toEqual({ inBand: 5, inHang: 2, both: 1, total: 6, unresolved: 1, fittingConnectors: 3 })
    expect(diagnostics.pipes.drawn).toBe(6 + 1 + 3)
    // The branch still feeds h1 through the tee body, so h1 keeps its collector role.
    expect(model.pipes.filter((pipe) => pipe.role === 'collector').map((pipe) => pipe.id)).toEqual(['engineer-pipe-11'])
    // Slope coverage is computed on pipes only.
    expect(diagnostics.slope.extrusionRuns).toBe(build().diagnostics.slope.extrusionRuns)
    // Opting out reproduces the pipe-only drawing.
    const pipeOnly = build({ network, classification, includeFittingConnectors: false })
    expect(pipeOnly.model.pipes.some((pipe) => pipe.fitting)).toBe(false)
    expect(pipeOnly.diagnostics.pipes.sanitary.fittingConnectors).toBe(0)
  })

  it('passes structure and fixtures through in the drawing frame and frames the sheet by the plan bounds', () => {
    const { model, diagnostics } = build()
    expect(model.structure.map((element) => element.kind)).toEqual(['wall', 'column', 'slab-opening'])
    expect(model.structure[1].outline).toEqual([
      { xM: 4, yM: 0 },
      { xM: 4.4, yM: 0 },
      { xM: 4.4, yM: 0.4 },
      { xM: 4, yM: 0.4 },
    ])
    expect(model.fixtures.map((fixture) => [fixture.kind, fixture.centre])).toEqual([
      ['toilet', { xM: 3, yM: 4 }],
      ['basin', { xM: 5, yM: -2 }],
    ])
    expect(diagnostics.fixtures).toEqual({ drawn: 2, skippedWithoutPosition: 1 })
    expect(model.boundsM).toEqual({ minXM: -1, maxXM: 9, minYM: -3, maxYM: 8 })
    expect(model.sleeves).toEqual([])
    expect(drawingModelHasNonFinite(model)).toBe(false)
    expect(drawingContentOutsideBounds(model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
    expect(diagnostics.pipeEndpointsOutsideBounds).toBe(0)
    expect(diagnostics.notes).toEqual(['1 matching segment(s) have no resolved centreline anywhere in the model and cannot be placed on a storey.'])
  })

  it('unions structure that sticks out of the plan bounds into the frame', () => {
    const { model } = build({ planBounds: { minX: 0, maxX: 1, minZ: -1, maxZ: 0 } })
    expect(model.boundsM).toEqual({ minXM: -1, maxXM: 9, minYM: 0, maxYM: 8 })
  })

  it('falls back to content-derived bounds with a note when nothing frames the sheet', () => {
    const { model, diagnostics } = build({ planBounds: null, structure: undefined, fixtures: undefined })
    expect(diagnostics.notes[0]).toMatch(/derived from the drawn content/)
    expect(drawingContentOutsideBounds(model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
  })

  it('throws for a storey that is not in the network', () => {
    expect(() => build({ storeyId: 999 })).toThrow(/not in the engineer network/)
  })

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(build().model)).toBe(JSON.stringify(build().model))
  })
})
