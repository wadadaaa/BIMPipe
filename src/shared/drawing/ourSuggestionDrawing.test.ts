import { describe, expect, it } from 'vitest'
import { BRANCH_SLOPE_PERCENT } from '@/domain/branchDefaults'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type { Fixture, Riser, Storey } from '@/domain/types'
import { drawingContentOutsideBounds, drawingLabelsContaining, drawingModelHasNonFinite } from './drawingModelChecks'
import { buildOurFloorDrawing, OUR_STACK_DIAMETER_MM, stackLabelIndex } from './ourSuggestionDrawing'

const STOREYS: Storey[] = [
  { id: 100, name: 'A', elevation: 0, modelId: 'host' },
  { id: 200, name: 'B', elevation: 3, modelId: 'host' },
]

function riser(id: string, stackId: string, stackLabel: string, storeyId: number, x: number, z: number): Riser {
  return { id, stackId, stackLabel, storeyId, position: { x, y: 3, z }, source: 'placed' }
}

const RISERS: Riser[] = [
  riser('r-b-18', 'stack-18', 'R18', 200, 5, -1),
  riser('r-b-3', 'stack-3', 'R3', 200, 1, -1),
  riser('r-a-3', 'stack-3', 'R3', 100, 1, -1),
  riser('r-b-x', 'stack-x', 'Manual', 200, 8, -6),
]

function segment(id: string, kind: RouteSegment['kind'], start: [number, number], end: [number, number], diameterMm: number): RouteSegment {
  return {
    id,
    start: { x: start[0], z: start[1], elevation: 0.1 },
    end: { x: end[0], z: end[1], elevation: 0 },
    axis: start[0] === end[0] ? 'z' : 'x',
    kind,
    servedFixtureExpressIds: [901],
    diameterMm,
    riserId: 'r-b-3',
    riserStackId: 'stack-3',
  }
}

const ROUTES: FloorRoutes[] = [
  {
    storeyId: 200,
    planUnits: 'm',
    segments: [
      segment('branch-seg|200|r-b-3|1', 'trunk', [3, -1], [1, -1], 63),
      segment('branch-seg|200|r-b-3|0', 'fixture-branch', [3, -4], [3, -1], 50),
      segment('branch-seg|200|r-b-3|2', 'fixture-branch', [3, -1], [3, -1], 50), // zero length
    ],
  },
  {
    storeyId: 100,
    planUnits: 'mm',
    segments: [segment('branch-seg|100|r-a-3|0', 'fixture-branch', [3000, -4000], [1000, -4000], 110)],
  },
]

const FIXTURES: Fixture[] = [
  { expressId: 901, name: 'F1', kind: 'TOILETPAN', storeyId: 200, position: { x: 3, y: 3.4, z: -4 } },
  { expressId: 902, name: 'F2', kind: 'SINK', storeyId: 100, position: { x: 3, y: 0.4, z: -4 } },
]

function build(overrides: Partial<Parameters<typeof buildOurFloorDrawing>[0]> = {}) {
  return buildOurFloorDrawing({
    storeyId: 200,
    storeyLabel: 'Storey 02',
    risers: RISERS,
    routes: ROUTES,
    fixtures: FIXTURES,
    storeys: STOREYS,
    planBounds: { minX: -1, maxX: 9, minZ: -8, maxZ: 3 },
    ...overrides,
  })
}

describe('buildOurFloorDrawing (synthetic)', () => {
  it('draws one riser per stack on the storey, tagged "<floor>.<label index>ק" and ordered by label index', () => {
    const { model, diagnostics } = build()
    expect(model.title).toBe('Storey 02 — sanitary plan')
    // The label-less manual stack gets the first free ordinal (1: 3 and 18 are claimed by labels).
    expect(model.risers.map((r) => [r.id, r.tag, r.diameterMm, r.system])).toEqual([
      ['stack-3', '2.3ק', OUR_STACK_DIAMETER_MM, 'sanitary'],
      ['stack-18', '2.18ק', OUR_STACK_DIAMETER_MM, 'sanitary'],
      ['stack-x', '2.1ק', OUR_STACK_DIAMETER_MM, 'sanitary'],
    ])
    expect(new Set(model.risers.map((r) => r.tag)).size).toBe(3)
    expect(diagnostics.risers).toEqual({ onStorey: 3, tagsFromLabelIndex: 2, tagsOrdinal: 1 })
    expect(model.risers[0].centre).toEqual({ xM: 1, yM: 1 })
    expect(model.risers[0].spansStoreyLabels).toEqual(['A', 'B'])
    expect(model.risers[1].spansStoreyLabels).toEqual(['B'])
    expect(stackLabelIndex('R18')).toBe(18)
    expect(stackLabelIndex('Manual')).toBeNull()
  })

  it('draws the storey route segments, trunks as collectors, with the routing default slope', () => {
    const { model, diagnostics } = build()
    expect(model.pipes.map((pipe) => [pipe.id, pipe.role, pipe.diameterMm])).toEqual([
      ['our-pipe-branch-seg|200|r-b-3|0', 'branch', 50],
      ['our-pipe-branch-seg|200|r-b-3|1', 'collector', 63],
    ])
    expect(model.pipes[0].start).toEqual({ xM: 3, yM: 4 })
    expect(model.pipes[0].end).toEqual({ xM: 3, yM: 1 })
    expect(model.pipes.every((pipe) => pipe.slopePercent === BRANCH_SLOPE_PERCENT)).toBe(true)
    expect(diagnostics.pipes).toEqual({ drawn: 2, collectors: 1, branches: 1, diametersMm: { '50': 1, '63': 1 }, zeroLengthSkipped: 1 })
    expect(diagnostics.notes).toEqual(['1 zero-length route segment(s) were not drawn.'])
  })

  it('converts millimetre routes to metres', () => {
    const { model } = build({ storeyId: 100, storeyLabel: 'Storey 01' })
    expect(model.pipes).toHaveLength(1)
    expect(model.pipes[0].start).toEqual({ xM: 3, yM: 4 })
    expect(model.pipes[0].end).toEqual({ xM: 1, yM: 4 })
    expect(model.risers.map((r) => r.tag)).toEqual(['1.3ק'])
  })

  it('passes fixtures through for the storey only and frames by the plan bounds', () => {
    const { model, diagnostics } = build()
    expect(model.fixtures.map((fixture) => [fixture.kind, fixture.centre])).toEqual([['toilet', { xM: 3, yM: 4 }]])
    expect(diagnostics.fixtures).toEqual({ drawn: 1, skippedWithoutPosition: 0 })
    expect(model.boundsM).toEqual({ minXM: -1, maxXM: 9, minYM: -3, maxYM: 8 })
    expect(model.structure).toEqual([])
    expect(model.sleeves).toEqual([])
    expect(drawingModelHasNonFinite(model)).toBe(false)
    expect(drawingContentOutsideBounds(model)).toEqual({ pipeEndpoints: 0, risers: 0, fixtures: 0 })
    expect(drawingLabelsContaining(model, ['R18', 'Manual', 'stack'])).toEqual([])
  })

  it('is deterministic regardless of riser/segment input order', () => {
    const a = build()
    const b = build({ risers: [...RISERS].reverse(), routes: ROUTES.map((floor) => ({ ...floor, segments: [...floor.segments].reverse() })) })
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(b.model))
  })
})
