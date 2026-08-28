import { describe, expect, it } from 'vitest'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import { buildBranchRouteWorldSegments, getBranchRoutePresentation } from './branchRoutePresentation'

const segments: RouteSegment[] = [
  {
    id: 'branch-seg|2|riser-a|0',
    start: { x: 800, z: 800, elevation: 7 },
    end: { x: 1000, z: 800, elevation: 3 },
    axis: 'x',
    kind: 'trunk',
    servedFixtureExpressIds: [11, 13],
    riserId: 'riser-a',
    riserStackId: 'stack-a',
  },
  {
    id: 'branch-seg|2|riser-a|1',
    start: { x: 1000, z: 800, elevation: 3 },
    end: { x: 1000, z: 950, elevation: 0 },
    axis: 'z',
    kind: 'fixture-branch',
    servedFixtureExpressIds: [13],
    riserId: 'riser-a',
  },
]

const floors: FloorRoutes[] = [
  { storeyId: 2, planUnits: 'mm', segments },
  {
    storeyId: 3,
    planUnits: 'mm',
    segments: [
      {
        id: 'branch-seg|3|riser-b|0',
        start: { x: 100, z: 0, elevation: 2 },
        end: { x: 0, z: 0, elevation: 0 },
        axis: 'x',
        kind: 'fixture-branch',
        servedFixtureExpressIds: [21],
        riserId: 'riser-b',
      },
    ],
  },
]

describe('getBranchRoutePresentation', () => {
  it('flattens visible segments onto the plan plane with stable keys and kinds', () => {
    const state = getBranchRoutePresentation({ segments, visible: true })

    expect(state.hasRoutes).toBe(true)
    expect(state.visibleSegments).toEqual([
      {
        key: 'branch-seg|2|riser-a|0',
        kind: 'trunk',
        from: { x: 800, y: 0, z: 800 },
        to: { x: 1000, y: 0, z: 800 },
      },
      {
        key: 'branch-seg|2|riser-a|1',
        kind: 'fixture-branch',
        from: { x: 1000, y: 0, z: 800 },
        to: { x: 1000, y: 0, z: 950 },
      },
    ])
  })

  it('hides segments when the floor toggle is off but keeps hasRoutes for the control', () => {
    const state = getBranchRoutePresentation({ segments, visible: false })

    expect(state.hasRoutes).toBe(true)
    expect(state.visibleSegments).toEqual([])
  })

  it('reports no routes for an empty floor', () => {
    expect(getBranchRoutePresentation({ segments: [], visible: true })).toEqual({
      hasRoutes: false,
      visibleSegments: [],
    })
  })
})

describe('buildBranchRouteWorldSegments', () => {
  const storeyYAnchors = new Map([
    [2, 612],
    [3, 918],
  ])

  it('offsets segment elevations by the storey Y anchor shared with riser junctions', () => {
    const worldSegments = buildBranchRouteWorldSegments({
      floors,
      storeyYAnchors,
      visibilityByStorey: new Map(),
    })

    expect(worldSegments).toHaveLength(3)
    expect(worldSegments[0]).toEqual({
      key: 'branch-seg|2|riser-a|0',
      kind: 'trunk',
      from: { x: 800, y: 612 + 7, z: 800 },
      to: { x: 1000, y: 612 + 3, z: 800 },
    })
    // Riser end of the run sits exactly at the storey anchor (datum elevation 0).
    expect(worldSegments[1].to).toEqual({ x: 1000, y: 612, z: 950 })
    expect(worldSegments[2].from).toEqual({ x: 100, y: 918 + 2, z: 0 })
  })

  it('skips floors toggled hidden while keeping visible floors', () => {
    const worldSegments = buildBranchRouteWorldSegments({
      floors,
      storeyYAnchors,
      visibilityByStorey: new Map([[2, false]]),
    })

    expect(worldSegments.map((segment) => segment.key)).toEqual(['branch-seg|3|riser-b|0'])
  })

  it('skips floors without a known Y anchor instead of guessing a level', () => {
    const worldSegments = buildBranchRouteWorldSegments({
      floors,
      storeyYAnchors: new Map([[2, 612]]),
      visibilityByStorey: new Map(),
    })

    expect(worldSegments.map((segment) => segment.key)).toEqual([
      'branch-seg|2|riser-a|0',
      'branch-seg|2|riser-a|1',
    ])
  })
})
