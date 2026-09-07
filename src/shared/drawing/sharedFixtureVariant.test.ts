import { describe, expect, it } from 'vitest'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type { DrawingFixture, DrawingPipeRun, DrawingRiser, FloorDrawingModel } from '@/domain/drawing/floorDrawingModel'
import { drawingFixtureId } from './drawingFixtures'
import { ourPipeDrawingId } from './ourSuggestionDrawing'
import { buildSharedFixtureVariant } from './sharedFixtureVariant'

function fixture(expressId: number, xM: number, yM: number): DrawingFixture {
  return { id: drawingFixtureId(expressId), kind: 'toilet', centre: { xM, yM }, rotationDeg: 0 }
}

function pipe(id: string, start: [number, number], end: [number, number], fitting = false): DrawingPipeRun {
  return { id, system: 'sanitary', diameterMm: 110, slopePercent: 2, start: { xM: start[0], yM: start[1] }, end: { xM: end[0], yM: end[1] }, role: 'branch', fitting }
}

function riser(id: string, xM: number, yM: number): DrawingRiser {
  return { id, system: 'sanitary', centre: { xM, yM }, diameterMm: 110, tag: id }
}

function segment(id: string, servedFixtureExpressIds: number[]): RouteSegment {
  return {
    id,
    start: { x: 0, z: 0, elevation: 0.1 },
    end: { x: 1, z: 0, elevation: 0 },
    axis: 'x',
    kind: 'fixture-branch',
    servedFixtureExpressIds,
    diameterMm: 110,
    riserId: 'r1',
  }
}

const FIXTURES = [fixture(101, 1, 0), fixture(102, 5, 0), fixture(103, 10, 0)]
const BASE = {
  title: 'Storey 04 — sanitary plan',
  storeyLabel: '04',
  boundsM: { minXM: 0, minYM: -2, maxXM: 12, maxYM: 2 },
  structure: [],
  sleeves: [],
}
const ENGINEER: FloorDrawingModel = {
  ...BASE,
  fixtures: FIXTURES,
  risers: [riser('engineer-riser-1', 3, -1)],
  pipes: [pipe('engineer-pipe-7', [1, 0], [3, -1]), pipe('engineer-pipe-8', [5, 0], [3, -1]), pipe('engineer-fitting-9-0', [3, -1], [3, -0.9], true)],
}
const OURS: FloorDrawingModel = {
  ...BASE,
  fixtures: FIXTURES,
  risers: [riser('stack-a', 3, -1), riser('stack-b', 10, -1)],
  pipes: [pipe(ourPipeDrawingId('seg-1'), [1, 0], [3, -1]), pipe(ourPipeDrawingId('seg-2'), [5, 0], [3, -1]), pipe(ourPipeDrawingId('seg-3'), [10, 0], [10, -1])],
}
const ROUTES: FloorRoutes[] = [
  { storeyId: 4, planUnits: 'm', segments: [segment('seg-1', [101]), segment('seg-2', [102]), segment('seg-3', [103])] },
  // Another storey's routes are irrelevant to this sheet but harmless in the map.
  { storeyId: 5, planUnits: 'm', segments: [segment('seg-9', [999])] },
]

describe('buildSharedFixtureVariant (R3 diagnostic A/B)', () => {
  it('restricts both sheets to the shared fixtures: ours loses the routes and stack of the unshared WC, the engineer keeps every run', () => {
    const variant = buildSharedFixtureVariant({ engineer: ENGINEER, ours: OURS, ourBranchRoutes: ROUTES, sharedFixtureExpressIds: [101, 102] })
    expect(variant.engineer.fixtures.map((entry) => entry.id)).toEqual(['fixture-101', 'fixture-102'])
    expect(variant.ours.fixtures.map((entry) => entry.id)).toEqual(['fixture-101', 'fixture-102'])
    expect(variant.engineer.pipes).toEqual(ENGINEER.pipes)
    expect(variant.engineer.risers).toEqual(ENGINEER.risers)
    expect(variant.ours.pipes.map((entry) => entry.id)).toEqual(['our-pipe-seg-1', 'our-pipe-seg-2'])
    expect(variant.ours.risers.map((entry) => entry.id)).toEqual(['stack-a'])
    expect(variant.diagnostics).toEqual({
      sharedFixtures: 2,
      engineer: { fixtures: { before: 3, after: 2 }, pipes: { before: 3, after: 3, withoutServedInfo: 3 }, risers: { before: 1, after: 1 }, sleeves: { before: 0, after: 0 } },
      ours: { fixtures: { before: 3, after: 2 }, pipes: { before: 3, after: 2, withoutServedInfo: 0 }, risers: { before: 2, after: 1 }, sleeves: { before: 0, after: 0 } },
    })
  })

  it('is the identity on both sides when every fixture is shared (F1)', () => {
    const variant = buildSharedFixtureVariant({ engineer: ENGINEER, ours: OURS, ourBranchRoutes: ROUTES, sharedFixtureExpressIds: [101, 102, 103] })
    expect(variant.engineer).toEqual(ENGINEER)
    expect(variant.ours).toEqual(OURS)
  })
})
