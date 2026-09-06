import { describe, expect, it } from 'vitest'
import {
  boundsOfDrawingPoints,
  drawingPointInBounds,
  fixtureKindToDrawing,
  footprintToDrawingOutline,
  ifcSourceToDrawing,
  unionDrawingBounds,
  viewerBoundsToDrawing,
  viewerPlanToDrawing,
} from './drawingFrame'

describe('drawing frame conversions', () => {
  it('viewer plan (x, z) → drawing (x, −z), with no negative zero', () => {
    expect(viewerPlanToDrawing({ x: 1.5, z: -2 })).toEqual({ xM: 1.5, yM: 2 })
    expect(Object.is(viewerPlanToDrawing({ x: 0, z: 0 }).yM, -0)).toBe(false)
  })

  it('IFC source (x, y) in source units → drawing metres', () => {
    expect(ifcSourceToDrawing({ x: 150, y: -250, z: 300 }, 0.01)).toEqual({ xM: 1.5, yM: -2.5 })
  })

  it('viewer bounds → drawing bounds swap the flipped axis', () => {
    expect(viewerBoundsToDrawing({ minX: 0, maxX: 10, minZ: -8, maxZ: -2 })).toEqual({
      minXM: 0,
      maxXM: 10,
      minYM: 2,
      maxYM: 8,
    })
  })

  it('a viewer point inside viewer bounds stays inside the converted drawing bounds', () => {
    const bounds = { minX: 0, maxX: 10, minZ: -8, maxZ: -2 }
    const point = { x: 3, z: -5 }
    expect(drawingPointInBounds(viewerPlanToDrawing(point), viewerBoundsToDrawing(bounds))).toBe(true)
    expect(drawingPointInBounds(viewerPlanToDrawing({ x: 3, z: -9 }), viewerBoundsToDrawing(bounds))).toBe(false)
    expect(drawingPointInBounds(viewerPlanToDrawing({ x: 3, z: -9 }), viewerBoundsToDrawing(bounds), 1)).toBe(true)
  })

  it('bbox footprints become four counter-clockwise corners; polygons map point-wise', () => {
    expect(footprintToDrawingOutline({ shape: 'bbox', bounds: { minX: 0, maxX: 2, minZ: -3, maxZ: -1 } })).toEqual([
      { xM: 0, yM: 1 },
      { xM: 2, yM: 1 },
      { xM: 2, yM: 3 },
      { xM: 0, yM: 3 },
    ])
    expect(
      footprintToDrawingOutline({
        shape: 'polygon',
        points: [
          { x: 0, z: 0 },
          { x: 1, z: -1 },
        ],
      }),
    ).toEqual([
      { xM: 0, yM: 0 },
      { xM: 1, yM: 1 },
    ])
  })

  it('unions and derives bounds', () => {
    expect(unionDrawingBounds(null, { minXM: 0, minYM: 0, maxXM: 1, maxYM: 1 })).toEqual({ minXM: 0, minYM: 0, maxXM: 1, maxYM: 1 })
    expect(
      unionDrawingBounds({ minXM: 0, minYM: 0, maxXM: 1, maxYM: 1 }, { minXM: -1, minYM: 0.5, maxXM: 0.5, maxYM: 2 }),
    ).toEqual({ minXM: -1, minYM: 0, maxXM: 1, maxYM: 2 })
    expect(boundsOfDrawingPoints([])).toBeNull()
    expect(
      boundsOfDrawingPoints([
        { xM: 1, yM: 5 },
        { xM: -2, yM: 3 },
      ]),
    ).toEqual({ minXM: -2, minYM: 3, maxXM: 1, maxYM: 5 })
  })

  it('maps every canonical fixture kind to a drawing symbol kind', () => {
    expect(fixtureKindToDrawing('TOILETPAN')).toBe('toilet')
    expect(fixtureKindToDrawing('WASHHANDBASIN')).toBe('basin')
    expect(fixtureKindToDrawing('SINK')).toBe('sink')
    expect(fixtureKindToDrawing('URINAL')).toBe('urinal')
    expect(fixtureKindToDrawing('BATH')).toBe('bath')
    expect(fixtureKindToDrawing('BIDET')).toBe('bidet')
    expect(fixtureKindToDrawing('CISTERN')).toBe('other')
    expect(fixtureKindToDrawing('OTHER')).toBe('other')
  })
})
