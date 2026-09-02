import { describe, expect, it } from 'vitest'
import type { ContinuityMap, StoreyObstructionGrid } from '@/domain/continuityMap'
import {
  getContinuityOverlayPresentation,
  mergeBlockedCellsIntoRowRuns,
} from './continuityOverlayPresentation'

function makeGrid(overrides: Partial<StoreyObstructionGrid> = {}): StoreyObstructionGrid {
  return {
    storeyId: 100,
    storeyName: 'Storey 100',
    origin: { x: 10, z: 20 },
    cellSize: 0.25,
    columns: 4,
    rows: 2,
    // Row 0: cols 1..2 blocked (one run). Row 1: cols 0 and 3 blocked (two runs).
    blocked: new Uint8Array([0, 1, 1, 0, 1, 0, 0, 1]),
    ...overrides,
  }
}

function makeMap(overrides: Partial<ContinuityMap> = {}): ContinuityMap {
  return {
    units: 'm',
    cellSize: 0.25,
    grids: [makeGrid()],
    shaftCandidates: [
      {
        id: 'shaft-space:100:space:7',
        source: 'shaft-named-space',
        center: { x: 11, z: 21 },
        bounds: { minX: 10.5, maxX: 11.5, minZ: 20.5, maxZ: 21.5 },
        polygon: null,
        storeyIds: [100],
        name: 'פיר',
      },
      {
        id: 'aligned-void:200:opening:9',
        source: 'aligned-void',
        center: { x: 12, z: 22 },
        bounds: { minX: 11.9, maxX: 12.1, minZ: 21.9, maxZ: 22.1 },
        polygon: null,
        storeyIds: [200, 300, 400],
      },
    ],
    diagnostics: [],
    ...overrides,
  }
}

describe('mergeBlockedCellsIntoRowRuns', () => {
  it('merges consecutive blocked cells per row into single rects', () => {
    const rects = mergeBlockedCellsIntoRowRuns(makeGrid())
    expect(rects).toEqual([
      // Row 0, cols 1..2.
      { minX: 10.25, maxX: 10.75, minZ: 20, maxZ: 20.25 },
      // Row 1, col 0.
      { minX: 10, maxX: 10.25, minZ: 20.25, maxZ: 20.5 },
      // Row 1, col 3.
      { minX: 10.75, maxX: 11, minZ: 20.25, maxZ: 20.5 },
    ])
  })

  it('handles a fully blocked row ending at the grid edge', () => {
    const rects = mergeBlockedCellsIntoRowRuns(
      makeGrid({ rows: 1, blocked: new Uint8Array([1, 1, 1, 1]) }),
    )
    expect(rects).toEqual([{ minX: 10, maxX: 11, minZ: 20, maxZ: 20.25 }])
  })
})

describe('getContinuityOverlayPresentation', () => {
  const frameOrigin = { x: 10, y: 0, z: 20 }

  it('localizes blocked rects and per-storey shaft markers into the viewer frame', () => {
    const presentation = getContinuityOverlayPresentation({
      map: makeMap(),
      storeyId: 100,
      frameOrigin,
      visible: true,
    })

    expect(presentation.hasMap).toBe(true)
    expect(presentation.gridAvailable).toBe(true)
    expect(presentation.blockedCellCount).toBe(4)
    expect(presentation.blockedRects[0]).toEqual({ minX: 0.25, maxX: 0.75, minZ: 0, maxZ: 0.25 })

    // Only the candidate present on storey 100 is shown.
    expect(presentation.shaftMarkers).toHaveLength(1)
    const marker = presentation.shaftMarkers[0]
    expect(marker.x).toBeCloseTo(1)
    expect(marker.z).toBeCloseTo(1)
    expect(marker.bounds).toEqual({ minX: 0.5, maxX: 1.5, minZ: 0.5, maxZ: 1.5 })
    expect(marker.label).toBe('Shaft-named space')
    expect(marker.name).toBe('פיר')
    expect(marker.storeyCount).toBe(1)
  })

  it('converts mm map units to viewer metres', () => {
    const mmGrid = makeGrid({
      origin: { x: 10_000, z: 20_000 },
      cellSize: 250,
      rows: 1,
      columns: 1,
      blocked: new Uint8Array([1]),
    })
    const presentation = getContinuityOverlayPresentation({
      map: makeMap({ units: 'mm', cellSize: 250, grids: [mmGrid], shaftCandidates: [] }),
      storeyId: 100,
      frameOrigin,
      visible: true,
    })
    expect(presentation.blockedRects).toEqual([{ minX: 0, maxX: 0.25, minZ: 0, maxZ: 0.25 }])
  })

  it('returns nothing to draw when hidden, keeping availability flags', () => {
    const presentation = getContinuityOverlayPresentation({
      map: makeMap(),
      storeyId: 100,
      frameOrigin,
      visible: false,
    })
    expect(presentation.hasMap).toBe(true)
    expect(presentation.gridAvailable).toBe(true)
    expect(presentation.blockedRects).toHaveLength(0)
    expect(presentation.shaftMarkers).toHaveLength(0)
  })

  it('reports gridAvailable=false when the open storey has no grid', () => {
    const presentation = getContinuityOverlayPresentation({
      map: makeMap(),
      storeyId: 999,
      frameOrigin,
      visible: true,
    })
    expect(presentation.hasMap).toBe(true)
    expect(presentation.gridAvailable).toBe(false)
    expect(presentation.blockedRects).toHaveLength(0)
  })
})
