import { describe, expect, it } from 'vitest'
import {
  boundsExtent,
  createOriginGuardedBoundsAccumulator,
  distanceFromOriginToBounds,
  dropIsolatedOriginVertices,
  isExactOriginVertex,
  isOriginIsolatedFromBounds,
  ORIGIN_ARTIFACT_ISOLATION_FACTOR,
  ORIGIN_ARTIFACT_MIN_EXTENT_M,
} from './originArtifacts'

const p = (x: number, y: number, z: number) => ({ x, y, z })

describe('isExactOriginVertex', () => {
  it('accepts exact and sub-nanometre zeros, including -0', () => {
    expect(isExactOriginVertex(0, 0, 0)).toBe(true)
    expect(isExactOriginVertex(-0, 0, -0)).toBe(true)
    expect(isExactOriginVertex(1e-12, -1e-10, 0)).toBe(true)
  })

  it('rejects anything a real coordinate could be', () => {
    expect(isExactOriginVertex(0.001, 0, 0)).toBe(false)
    expect(isExactOriginVertex(0, 1e-6, 0)).toBe(false)
    expect(isExactOriginVertex(0, 0, 0.2)).toBe(false)
  })
})

describe('bounds helpers', () => {
  it('measures the distance from the origin to a box (0 when inside)', () => {
    expect(distanceFromOriginToBounds({ minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 })).toBe(0)
    expect(distanceFromOriginToBounds({ minX: 3, minY: 0, minZ: 4, maxX: 5, maxY: 2, maxZ: 6 })).toBe(5)
    expect(distanceFromOriginToBounds({ minX: -8, minY: -1, minZ: -6, maxX: -3, maxY: 1, maxZ: -4 })).toBe(5)
  })

  it('takes the largest side as the extent', () => {
    expect(boundsExtent({ minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 7, maxZ: 3 })).toBe(7)
  })

  it('is isolated only beyond 10x the extent', () => {
    // 5 m box, origin 51 m away -> isolated; 49 m away -> not.
    expect(isOriginIsolatedFromBounds({ minX: 51, minY: 0, minZ: 0, maxX: 56, maxY: 5, maxZ: 5 })).toBe(true)
    expect(isOriginIsolatedFromBounds({ minX: 49, minY: 0, minZ: 0, maxX: 54, maxY: 5, maxZ: 5 })).toBe(false)
    expect(ORIGIN_ARTIFACT_ISOLATION_FACTOR).toBe(10)
  })

  it('floors the extent at 1 m so a tiny or degenerate mesh needs the origin >10 m away', () => {
    // Single-vertex rest 9 m away -> not isolated; 11 m away -> isolated.
    expect(isOriginIsolatedFromBounds({ minX: 9, minY: 0, minZ: 0, maxX: 9, maxY: 0, maxZ: 0 })).toBe(false)
    expect(isOriginIsolatedFromBounds({ minX: 11, minY: 0, minZ: 0, maxX: 11, maxY: 0, maxZ: 0 })).toBe(true)
    expect(ORIGIN_ARTIFACT_MIN_EXTENT_M).toBe(1)
  })
})

describe('dropIsolatedOriginVertices', () => {
  it('drops exact-origin strays from a far-from-origin mesh (096-style coordinates)', () => {
    const rest = [p(181_420, 28, -664_640), p(181_445, 33, -664_615)]
    expect(dropIsolatedOriginVertices([p(0, 0, 0), ...rest, p(0, 0, 0)])).toEqual(rest)
  })

  it('drops a stray from a small mesh that is only tens of metres away (Revit project-base-point exports)', () => {
    // 0.6 m fixture 12 m from the origin: 12 > 10 x 0.6 -> the zero vertex is an artifact.
    const rest = [p(12, 1, 3), p(12.6, 1.4, 3.6)]
    expect(dropIsolatedOriginVertices([...rest, p(0, 0, 0)])).toEqual(rest)
  })

  it('keeps a zero vertex that sits inside or near the mesh box (legitimate geometry at the origin)', () => {
    // A wall corner at the origin: the rest of the wall starts 0.2 m away.
    const wall = [p(0, 0, 0), p(0.2, 0, -0.2), p(8.4, 3, -17.4)]
    expect(dropIsolatedOriginVertices(wall)).toBe(wall)

    // 5 m box whose nearest corner is 20 m away: 20 <= 50 -> kept.
    const nearby = [p(0, 0, 0), p(20, 0, 0), p(25, 5, 5)]
    expect(dropIsolatedOriginVertices(nearby)).toBe(nearby)
  })

  it('returns the same array instance when there is no exact-origin vertex', () => {
    const vertices = [p(0.001, 0, 0), p(100, 0, 0)]
    expect(dropIsolatedOriginVertices(vertices)).toBe(vertices)
  })

  it('keeps everything when every vertex is at the origin', () => {
    const vertices = [p(0, 0, 0), p(0, 0, 0)]
    expect(dropIsolatedOriginVertices(vertices)).toBe(vertices)
  })

  it('handles an empty list', () => {
    expect(dropIsolatedOriginVertices([])).toEqual([])
  })
})

describe('createOriginGuardedBoundsAccumulator', () => {
  it('matches the vertex-list form: drops isolated strays and reports the count', () => {
    const acc = createOriginGuardedBoundsAccumulator()
    acc.add(0, 0, 0)
    acc.add(181_420, 28, -664_640)
    acc.add(0, 0, 0)
    acc.add(181_445, 33, -664_615)

    expect(acc.result()).toEqual({
      minX: 181_420, minY: 28, minZ: -664_640,
      maxX: 181_445, maxY: 33, maxZ: -664_615,
    })
    expect(acc.droppedOriginVertexCount()).toBe(2)
  })

  it('keeps a legitimate origin corner for near-origin geometry (Duplex-scale)', () => {
    const acc = createOriginGuardedBoundsAccumulator()
    acc.add(0, 0, 0)
    acc.add(0.2, 0, -0.2)
    acc.add(8.4, 3, -17.4)

    expect(acc.result()).toEqual({ minX: 0, minY: 0, minZ: -17.4, maxX: 8.4, maxY: 3, maxZ: 0 })
    expect(acc.droppedOriginVertexCount()).toBe(0)
  })

  it('keeps an all-origin mesh and returns null for no vertices', () => {
    const acc = createOriginGuardedBoundsAccumulator()
    acc.add(0, 0, 0)
    expect(acc.result()).toEqual({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })
    expect(createOriginGuardedBoundsAccumulator().result()).toBeNull()
  })

  it('skips and counts non-finite vertices', () => {
    const acc = createOriginGuardedBoundsAccumulator()
    acc.add(NaN, 5, 3)
    acc.add(2, Infinity, 4)
    acc.add(8.4, 3, -17.4)

    expect(acc.result()).toEqual({ minX: 8.4, minY: 3, minZ: -17.4, maxX: 8.4, maxY: 3, maxZ: -17.4 })
    expect(acc.nonFiniteVertexCount()).toBe(2)
  })

  it('returns null when every vertex is non-finite', () => {
    const acc = createOriginGuardedBoundsAccumulator()
    acc.add(NaN, NaN, NaN)
    expect(acc.result()).toBeNull()
    expect(acc.nonFiniteVertexCount()).toBe(1)
  })
})
