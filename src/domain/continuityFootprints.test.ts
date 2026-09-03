import { describe, expect, it } from 'vitest'
import {
  dropStrayOriginVertices,
  footprintFromWorldVertices,
  type WorldVertex,
} from './continuityFootprints'

const vertex = (x: number, y: number, z: number): WorldVertex => ({ x, y, z })

describe('dropStrayOriginVertices', () => {
  it('drops vertices sitting exactly at the world origin', () => {
    const vertices = [vertex(0, 0, 0), vertex(100, 5, 200), vertex(0, 0, 0), vertex(150, 5, 260)]
    expect(dropStrayOriginVertices(vertices)).toEqual([vertex(100, 5, 200), vertex(150, 5, 260)])
  })

  it('keeps vertices that are only near, but not at, the origin', () => {
    const vertices = [vertex(0.001, 0, 0), vertex(0, 0.001, 0)]
    expect(dropStrayOriginVertices(vertices)).toEqual(vertices)
  })
})

describe('footprintFromWorldVertices', () => {
  it('computes plan bounds ignoring stray origin vertices', () => {
    const footprint = footprintFromWorldVertices([
      vertex(0, 0, 0), // stray — must not drag the bbox to the origin
      vertex(1000, 20, 2000),
      vertex(1400, 40, 2600),
    ])

    expect(footprint).toEqual({
      bounds: { minX: 1000, maxX: 1400, minZ: 2000, maxZ: 2600 },
      center: { x: 1200, z: 2300 },
      minY: 20,
      maxY: 40,
    })
  })

  it('returns null when only stray vertices exist', () => {
    expect(footprintFromWorldVertices([vertex(0, 0, 0), vertex(0, 0, 0)])).toBeNull()
  })

  it('returns null for an empty vertex list', () => {
    expect(footprintFromWorldVertices([])).toBeNull()
  })
})
