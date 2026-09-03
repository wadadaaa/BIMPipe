import { describe, expect, it } from 'vitest'
import {
  dropStrayOriginVertices,
  footprintFromWorldVertices,
  type WorldVertex,
} from './continuityFootprints'

const vertex = (x: number, y: number, z: number): WorldVertex => ({ x, y, z })

describe('dropStrayOriginVertices', () => {
  it('drops exact world-origin vertices that are isolated from the element geometry', () => {
    // A 60 m element ~2.2 km from the origin: the origin is >10x the extent away.
    const vertices = [vertex(0, 0, 0), vertex(1000, 5, 2000), vertex(0, 0, 0), vertex(1050, 5, 2060)]
    expect(dropStrayOriginVertices(vertices)).toEqual([vertex(1000, 5, 2000), vertex(1050, 5, 2060)])
  })

  it('keeps an exact origin vertex when the element itself reaches the origin area', () => {
    // A 100 m element whose nearest corner is 224 m away: not isolated (224 <= 1000).
    const vertices = [vertex(0, 0, 0), vertex(100, 5, 200), vertex(200, 5, 260)]
    expect(dropStrayOriginVertices(vertices)).toEqual(vertices)
  })

  it('keeps vertices that are only near, but not at, the origin', () => {
    const vertices = [vertex(0.001, 0, 0), vertex(0, 0.001, 0)]
    expect(dropStrayOriginVertices(vertices)).toEqual(vertices)
  })
})

describe('footprintFromWorldVertices', () => {
  it('computes plan bounds ignoring isolated stray origin vertices', () => {
    const footprint = footprintFromWorldVertices([
      vertex(0, 0, 0), // stray — must not drag the bbox to the origin
      vertex(181_000, 20, -664_000),
      vertex(181_400, 40, -663_400),
    ])

    expect(footprint).toEqual({
      bounds: { minX: 181_000, maxX: 181_400, minZ: -664_000, maxZ: -663_400 },
      center: { x: 181_200, z: -663_700 },
      minY: 20,
      maxY: 40,
    })
  })

  it('keeps an origin vertex that belongs to near-origin geometry', () => {
    const footprint = footprintFromWorldVertices([
      vertex(0, 0, 0),
      vertex(0.2, 0, -0.2),
      vertex(8.4, 3, -17.4),
    ])

    expect(footprint).toEqual({
      bounds: { minX: 0, maxX: 8.4, minZ: -17.4, maxZ: 0 },
      center: { x: 4.2, z: -8.7 },
      minY: 0,
      maxY: 3,
    })
  })

  it('keeps an all-origin vertex cloud as a degenerate footprint at the origin', () => {
    expect(footprintFromWorldVertices([vertex(0, 0, 0), vertex(0, 0, 0)])).toEqual({
      bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      center: { x: 0, z: 0 },
      minY: 0,
      maxY: 0,
    })
  })

  it('returns null for an empty vertex list', () => {
    expect(footprintFromWorldVertices([])).toBeNull()
  })
})
