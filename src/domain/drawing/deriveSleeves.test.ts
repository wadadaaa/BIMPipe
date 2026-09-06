import { describe, expect, it } from 'vitest'
import { deriveSleeves, pointInPolygon, segmentPolygonCrossings } from './deriveSleeves'
import type { DrawingPipeRun, DrawingStructureElement } from './floorDrawingModel'

function wall(minX: number, minY: number, maxX: number, maxY: number): DrawingStructureElement {
  return {
    kind: 'wall',
    outline: [
      { xM: minX, yM: minY },
      { xM: maxX, yM: minY },
      { xM: maxX, yM: maxY },
      { xM: minX, yM: maxY },
    ],
  }
}

function run(id: string, x0: number, y0: number, x1: number, y1: number, diameterMm = 110): DrawingPipeRun {
  return {
    id,
    system: 'sanitary',
    diameterMm,
    slopePercent: 2,
    start: { xM: x0, yM: y0 },
    end: { xM: x1, yM: y1 },
    role: 'branch',
  }
}

describe('deriveSleeves', () => {
  it('places one sleeve at the centre of a wall a run passes straight through', () => {
    const sleeves = deriveSleeves([run('p', 0, 1, 4, 1)], [wall(2, 0, 2.2, 3)])
    expect(sleeves).toHaveLength(1)
    expect(sleeves[0]).toMatchObject({
      id: 'sleeve|p|0|0',
      directionDeg: 0,
      pipeDiameterMm: 110,
    })
    expect(sleeves[0].at.xM).toBeCloseTo(2.1, 9)
    expect(sleeves[0].at.yM).toBeCloseTo(1, 9)
    expect(sleeves[0].lengthM).toBeCloseTo(0.2, 9)
  })

  it('ignores runs that end inside a wall or never touch it', () => {
    const walls = [wall(2, 0, 2.2, 3)]
    expect(deriveSleeves([run('ends-inside', 0, 1, 2.1, 1)], walls)).toEqual([])
    expect(deriveSleeves([run('starts-inside', 2.1, 1, 4, 1)], walls)).toEqual([])
    expect(deriveSleeves([run('misses', 0, 4, 4, 4)], walls)).toEqual([])
    expect(deriveSleeves([run('touches-face', 0, 1, 2, 1)], walls)).toEqual([])
  })

  it('reports one sleeve per wall crossed, in pipe-id then wall order', () => {
    const sleeves = deriveSleeves(
      [run('b', 0, 1, 6, 1), run('a', 0, 2, 6, 2)],
      [wall(4, 0, 4.2, 3), wall(1, 0, 1.3, 3)],
    )
    expect(sleeves.map((s) => s.id)).toEqual(['sleeve|a|0|0', 'sleeve|a|1|0', 'sleeve|b|0|0', 'sleeve|b|1|0'])
    expect(sleeves[1].lengthM).toBeCloseTo(0.3, 9)
  })

  it('orients the sleeve along the run and lengthens it for oblique crossings', () => {
    const [reversed] = deriveSleeves([run('r', 4, 1, 0, 1)], [wall(2, 0, 2.2, 3)])
    expect(reversed.directionDeg).toBe(180)

    const [oblique] = deriveSleeves([run('o', 0, 0, 4, 4)], [wall(2, -1, 2.2, 5)])
    expect(oblique.directionDeg).toBeCloseTo(45, 9)
    expect(oblique.lengthM).toBeCloseTo(0.2 * Math.SQRT2, 9)
  })

  it('only considers walls, not columns or openings', () => {
    const column: DrawingStructureElement = { ...wall(2, 0, 2.2, 3), kind: 'column' }
    expect(deriveSleeves([run('p', 0, 1, 4, 1)], [column])).toEqual([])
  })

  it('returns nothing for degenerate runs and polygons', () => {
    expect(deriveSleeves([run('zero', 1, 1, 1, 1)], [wall(0, 0, 2, 2)])).toEqual([])
    expect(deriveSleeves([run('p', 0, 1, 4, 1)], [{ kind: 'wall', outline: [{ xM: 0, yM: 0 }] }])).toEqual([])
  })
})

describe('segmentPolygonCrossings / pointInPolygon', () => {
  const square = wall(1, 1, 2, 2).outline

  it('classifies points inside and outside', () => {
    expect(pointInPolygon({ xM: 1.5, yM: 1.5 }, square)).toBe(true)
    expect(pointInPolygon({ xM: 0.5, yM: 1.5 }, square)).toBe(false)
  })

  it('finds entry and exit parameters for a traversing segment', () => {
    const crossings = segmentPolygonCrossings({ xM: 0, yM: 1.5 }, { xM: 4, yM: 1.5 }, square)
    expect(crossings).toHaveLength(1)
    expect(crossings[0].tIn).toBeCloseTo(0.25, 9)
    expect(crossings[0].tOut).toBeCloseTo(0.5, 9)
  })

  it('finds two traversals through a U-shaped polygon', () => {
    const u = [
      { xM: 0, yM: 0 },
      { xM: 3, yM: 0 },
      { xM: 3, yM: 3 },
      { xM: 2, yM: 3 },
      { xM: 2, yM: 1 },
      { xM: 1, yM: 1 },
      { xM: 1, yM: 3 },
      { xM: 0, yM: 3 },
    ]
    const crossings = segmentPolygonCrossings({ xM: -1, yM: 2 }, { xM: 4, yM: 2 }, u)
    expect(crossings).toHaveLength(2)
    expect(crossings[0].tIn).toBeCloseTo(0.2, 9)
    expect(crossings[0].tOut).toBeCloseTo(0.4, 9)
    expect(crossings[1].tIn).toBeCloseTo(0.6, 9)
    expect(crossings[1].tOut).toBeCloseTo(0.8, 9)
  })
})
