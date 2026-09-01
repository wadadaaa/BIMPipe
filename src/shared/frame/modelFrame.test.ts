import { describe, expect, it } from 'vitest'
import {
  FAR_FROM_ORIGIN_THRESHOLD_M,
  IDENTITY_MODEL_FRAME,
  ONE_KILOMETRE_BY_UNIT,
  ORIGIN_ARTIFACT_RADIUS_M,
  chooseModelOrigin,
  createArtifactAwareBoundsAccumulator,
  createModelFrame,
  isFarFromOrigin,
  isIdentityModelFrame,
  isOriginArtifactVertex,
  shouldDropOriginArtifacts,
  toLocalPoint,
  toSourcePoint,
} from './modelFrame'

describe('isFarFromOrigin', () => {
  it('uses 1 km per unit: 1,000,000 mm / 100,000 cm / 1,000 m', () => {
    expect(ONE_KILOMETRE_BY_UNIT).toEqual({ mm: 1_000_000, cm: 100_000, m: 1_000 })

    // Just inside 1 km in every unit -> near.
    expect(isFarFromOrigin(999_999, 0, 'mm')).toBe(false)
    expect(isFarFromOrigin(99_999, 0, 'cm')).toBe(false)
    expect(isFarFromOrigin(999, 0, 'm')).toBe(false)

    // Just beyond 1 km in every unit -> far.
    expect(isFarFromOrigin(1_000_001, 0, 'mm')).toBe(true)
    expect(isFarFromOrigin(100_001, 0, 'cm')).toBe(true)
    expect(isFarFromOrigin(1_001, 0, 'm')).toBe(true)
  })

  it('measures plan distance (hypot of both plan axes), sign-independent', () => {
    // 800 m on each axis -> ~1131 m plan distance -> far.
    expect(isFarFromOrigin(800, -800, 'm')).toBe(true)
    // 600 m on each axis -> ~849 m -> near.
    expect(isFarFromOrigin(-600, 600, 'm')).toBe(false)
  })

  it('classifies the 096 shared coordinates (cm) and Duplex (m) correctly', () => {
    // 096-P site placement, centimetres: ~181 km / ~664 km from (0,0).
    expect(isFarFromOrigin(18_144_051, 66_462_427, 'cm')).toBe(true)
    // Duplex geometry sits within ~20 m of the origin.
    expect(isFarFromOrigin(8.4, 17.4, 'm')).toBe(false)
  })
})

describe('origin-artifact vertex predicates', () => {
  it('flags only vertices within the artifact radius of (0,0,0)', () => {
    expect(ORIGIN_ARTIFACT_RADIUS_M).toBe(1)
    expect(isOriginArtifactVertex(0, 0, 0)).toBe(true)
    expect(isOriginArtifactVertex(0.3, -0.2, 0.1)).toBe(true)
    expect(isOriginArtifactVertex(1.2, 0, 0)).toBe(false)
    expect(isOriginArtifactVertex(181_420, 30, -664_634)).toBe(false)
  })

  it('only drops artifacts when the mesh is otherwise far from origin', () => {
    expect(shouldDropOriginArtifacts(FAR_FROM_ORIGIN_THRESHOLD_M + 1)).toBe(true)
    // Near-origin meshes (Duplex/ADAM) must never have vertices dropped.
    expect(shouldDropOriginArtifacts(FAR_FROM_ORIGIN_THRESHOLD_M - 1)).toBe(false)
    expect(shouldDropOriginArtifacts(0)).toBe(false)
  })
})

describe('createArtifactAwareBoundsAccumulator', () => {
  it('drops (0,0,0)-adjacent strays from the bounds of far-from-origin geometry', () => {
    const acc = createArtifactAwareBoundsAccumulator()
    acc.add(0, 0, 0) // exporter artifact
    acc.add(0.2, 0.1, -0.3) // exporter artifact
    acc.add(181_420, 28, -664_640)
    acc.add(181_445, 33, -664_615)

    expect(acc.result()).toEqual({
      minX: 181_420,
      minY: 28,
      minZ: -664_640,
      maxX: 181_445,
      maxY: 33,
      maxZ: -664_615,
    })
  })

  it('keeps every vertex for near-origin geometry so Duplex-scale models never change', () => {
    const acc = createArtifactAwareBoundsAccumulator()
    acc.add(0, 0, 0) // legitimate wall corner at the model origin
    acc.add(8.4, 3, -17.4)

    expect(acc.result()).toEqual({ minX: 0, minY: 0, minZ: -17.4, maxX: 8.4, maxY: 3, maxZ: 0 })
  })

  it('falls back to the unfiltered bounds when every vertex is artifact-like', () => {
    const acc = createArtifactAwareBoundsAccumulator()
    acc.add(0.1, 0.2, 0.3)

    expect(acc.result()).toEqual({ minX: 0.1, minY: 0.2, minZ: 0.3, maxX: 0.1, maxY: 0.2, maxZ: 0.3 })
  })

  it('returns null when no vertices were added', () => {
    expect(createArtifactAwareBoundsAccumulator().result()).toBeNull()
  })
})

describe('createModelFrame / identity', () => {
  it('quantizes the origin to whole metres and zeroes the vertical component', () => {
    const frame = createModelFrame({ x: 181_440.51, y: 30.2, z: -664_623.87 })
    expect(frame.origin).toEqual({ x: 181_441, y: 0, z: -664_624 })
  })

  it('normalizes -0 and recognizes the identity frame', () => {
    const frame = createModelFrame({ x: -0.4, y: 0, z: 0.3 })
    expect(Object.is(frame.origin.x, 0)).toBe(true)
    expect(isIdentityModelFrame(frame)).toBe(true)
    expect(isIdentityModelFrame(IDENTITY_MODEL_FRAME)).toBe(true)
    expect(isIdentityModelFrame(createModelFrame({ x: 181_441, y: 0, z: 0 }))).toBe(false)
  })
})

describe('frame conversions', () => {
  it('identity frame is a no-op in both directions', () => {
    const point = { x: 12.34, y: 5.6, z: -7.89 }
    expect(toLocalPoint(IDENTITY_MODEL_FRAME, point)).toEqual(point)
    expect(toSourcePoint(IDENTITY_MODEL_FRAME, point)).toEqual(point)
  })

  it('source -> local -> source is bit-exact at 096 scale', () => {
    // Origin quantized near the 096 building; sample coordinates spread over the
    // ~26x23 m footprint including awkward fractional values.
    const frame = createModelFrame({ x: 181_440.51, y: 0, z: -664_623.87 })
    const samples = [
      { x: 181_423.85, y: 30.21, z: -664_632.34 },
      { x: 181_403.09, y: 29.8, z: -664_643.77 },
      { x: 181_428.77, y: 155.29, z: -664_621.06 },
      { x: 181_440.000001, y: 0, z: -664_624.000001 },
    ]
    for (const source of samples) {
      const local = toLocalPoint(frame, source)
      expect(Math.abs(local.x)).toBeLessThan(1_000)
      expect(Math.abs(local.z)).toBeLessThan(1_000)
      const roundTripped = toSourcePoint(frame, local)
      expect(roundTripped.x).toBe(source.x)
      expect(roundTripped.y).toBe(source.y)
      expect(roundTripped.z).toBe(source.z)
    }
  })

  it('local -> source -> local round trip stays within one ulp of the origin magnitude', () => {
    const frame = createModelFrame({ x: 181_441, y: 0, z: -664_624 })
    const local = { x: 2.5000000001, y: 0.75, z: -13.1200000003 }
    const back = toLocalPoint(frame, toSourcePoint(frame, local))
    // Adding then subtracting a ~665 km origin can lose sub-nanometre bits.
    expect(back.x).toBeCloseTo(local.x, 9)
    expect(back.y).toBe(local.y)
    expect(back.z).toBeCloseTo(local.z, 9)
  })
})

describe('chooseModelOrigin', () => {
  const farSite = { x: 181_440.5, y: 0, z: -664_623.9 }
  const farBuilding = { x: 181_430, y: 0, z: -664_620 }
  const farCentroid = { x: 181_416.1, y: 30, z: -664_632.4 }

  it('prefers site placement over building placement over storey centroid', () => {
    expect(
      chooseModelOrigin({
        sitePlacement: farSite,
        buildingPlacement: farBuilding,
        storeyGeometryCentroid: farCentroid,
      }),
    ).toEqual({ origin: { x: 181_441, y: 0, z: -664_624 }, detectedBy: 'site-placement' })

    expect(
      chooseModelOrigin({ buildingPlacement: farBuilding, storeyGeometryCentroid: farCentroid }),
    ).toEqual({ origin: { x: 181_430, y: 0, z: -664_620 }, detectedBy: 'building-placement' })

    expect(chooseModelOrigin({ storeyGeometryCentroid: farCentroid })).toEqual({
      origin: { x: 181_416, y: 0, z: -664_632 },
      detectedBy: 'storey-geometry',
    })
  })

  it('skips near-origin candidates and falls through to the next one', () => {
    const nearSite = { x: 12, y: 0, z: -30 }
    expect(
      chooseModelOrigin({ sitePlacement: nearSite, storeyGeometryCentroid: farCentroid }),
    ).toEqual({ origin: { x: 181_416, y: 0, z: -664_632 }, detectedBy: 'storey-geometry' })
  })

  it('returns the identity origin for near-origin models', () => {
    expect(
      chooseModelOrigin({
        sitePlacement: { x: 0, y: 0, z: 0 },
        buildingPlacement: { x: 4, y: 0, z: 9 },
        storeyGeometryCentroid: { x: 8.4, y: 1.5, z: 10.9 },
      }),
    ).toEqual({ origin: { x: 0, y: 0, z: 0 }, detectedBy: 'none' })
    expect(chooseModelOrigin({})).toEqual({ origin: { x: 0, y: 0, z: 0 }, detectedBy: 'none' })
  })
})
