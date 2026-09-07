import { describe, expect, it } from 'vitest'
import type { DrawingFixture, DrawingPipeRun, DrawingRiser, FloorDrawingModel } from './floorDrawingModel'
import { RESTRICT_TOUCH_TOLERANCE_M, restrictFloorDrawingToFixtures } from './restrictFloorDrawing'

function fixture(id: string, xM: number, yM: number): DrawingFixture {
  return { id, kind: 'toilet', centre: { xM, yM }, rotationDeg: 0 }
}

function pipe(id: string, start: [number, number], end: [number, number], role: DrawingPipeRun['role'] = 'branch'): DrawingPipeRun {
  return { id, system: 'sanitary', diameterMm: 110, slopePercent: 2, start: { xM: start[0], yM: start[1] }, end: { xM: end[0], yM: end[1] }, role }
}

function riser(id: string, xM: number, yM: number): DrawingRiser {
  return { id, system: 'sanitary', centre: { xM, yM }, diameterMm: 110, tag: id }
}

/**
 * Two WCs (f1 at x=1, f2 at x=5) drain to stack S1 at x=3 through their own
 * legs and a shared collector; a third WC f3 drains alone to stack S2 at x=10;
 * S3 has no run at all (a bare stack). A sleeve sits on f3's leg.
 */
const MODEL: FloorDrawingModel = {
  title: 'Storey 01 — sanitary plan',
  storeyLabel: '01',
  boundsM: { minXM: 0, minYM: -2, maxXM: 12, maxYM: 2 },
  structure: [],
  fixtures: [fixture('f1', 1, 0), fixture('f2', 5, 0), fixture('f3', 10, 1)],
  risers: [riser('S1', 3, -1), riser('S2', 10, -1), riser('S3', 12, 0)],
  pipes: [
    pipe('p1', [1, 0], [1, -1]),
    pipe('p2', [5, 0], [5, -1]),
    pipe('c12', [1, -1], [5, -1], 'collector'),
    pipe('p3', [10, 1], [10, -1]),
    pipe('e1', [7, 1], [8, 1]),
  ],
  sleeves: [{ id: 'sl3', at: { xM: 10, yM: 0.5 }, directionDeg: 90, pipeDiameterMm: 110 }],
}

const SERVED = new Map<string, readonly string[]>([
  ['p1', ['f1']],
  ['p2', ['f2']],
  ['c12', ['f1', 'f2']],
  ['p3', ['f3']],
])

describe('restrictFloorDrawingToFixtures', () => {
  it('keeps the runs carrying a kept fixture, the runs without served info, and the stacks a kept run still reaches', () => {
    const { model, diagnostics } = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f1', 'f2']), servedFixtureIdsByPipeId: SERVED })
    expect(model.fixtures.map((entry) => entry.id)).toEqual(['f1', 'f2'])
    // p3 (serves only f3) leaves; e1 carries no served info (an engineer run / connector) and stays.
    expect(model.pipes.map((entry) => entry.id)).toEqual(['p1', 'p2', 'c12', 'e1'])
    // S2 was reached by p3 only → dropped; S3 was never reached → stays as it was.
    expect(model.risers.map((entry) => entry.id)).toEqual(['S1', 'S3'])
    expect(model.sleeves).toEqual([])
    expect(diagnostics).toEqual({
      fixtures: { before: 3, after: 2 },
      pipes: { before: 5, after: 4, withoutServedInfo: 1 },
      risers: { before: 3, after: 2 },
      sleeves: { before: 1, after: 0 },
    })
    // Untouched fields pass through.
    expect(model.title).toBe(MODEL.title)
    expect(model.boundsM).toEqual(MODEL.boundsM)
  })

  it('keeps a shared collector when only one of its fixtures is kept, and drops it with both', () => {
    const one = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f2', 'f3']), servedFixtureIdsByPipeId: SERVED })
    expect(one.model.pipes.map((entry) => entry.id)).toEqual(['p2', 'c12', 'p3', 'e1'])
    expect(one.model.risers.map((entry) => entry.id)).toEqual(['S1', 'S2', 'S3'])
    const none = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f3']), servedFixtureIdsByPipeId: SERVED })
    expect(none.model.pipes.map((entry) => entry.id)).toEqual(['p3', 'e1'])
    expect(none.model.risers.map((entry) => entry.id)).toEqual(['S2', 'S3'])
  })

  it('is the identity for a model without served info (the engineer side) apart from the fixture filter', () => {
    const { model, diagnostics } = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f1']), servedFixtureIdsByPipeId: new Map() })
    expect(model.fixtures.map((entry) => entry.id)).toEqual(['f1'])
    expect(model.pipes).toEqual(MODEL.pipes)
    expect(model.risers).toEqual(MODEL.risers)
    expect(model.sleeves).toEqual(MODEL.sleeves)
    expect(diagnostics.pipes.withoutServedInfo).toBe(5)
  })

  it('touch tolerance decides whether a stack counts as reached', () => {
    expect(RESTRICT_TOUCH_TOLERANCE_M).toBe(0.3)
    const offset: FloorDrawingModel = { ...MODEL, risers: [riser('S1', 3.25, -1), riser('S2', 10.5, -1)] }
    const keep = restrictFloorDrawingToFixtures({ model: offset, keepFixtureIds: new Set(['f1', 'f2']), servedFixtureIdsByPipeId: SERVED })
    // S2 at 0.5 m from p3 was never "reached" → treated as bare and kept; S1 stays reached by c12.
    expect(keep.model.risers.map((entry) => entry.id)).toEqual(['S1', 'S2'])
    const wide = restrictFloorDrawingToFixtures({ model: offset, keepFixtureIds: new Set(['f1', 'f2']), servedFixtureIdsByPipeId: SERVED, touchToleranceM: 0.6 })
    expect(wide.model.risers.map((entry) => entry.id)).toEqual(['S1'])
  })

  it('is deterministic and preserves order', () => {
    const a = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f2', 'f1']), servedFixtureIdsByPipeId: SERVED })
    const b = restrictFloorDrawingToFixtures({ model: MODEL, keepFixtureIds: new Set(['f1', 'f2']), servedFixtureIdsByPipeId: SERVED })
    expect(a).toEqual(b)
  })
})
