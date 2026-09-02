import { describe, expect, it } from 'vitest'
import type { Bounds3D } from './modelFrame'
import {
  PLAN_OUTLIER_DISTANCE_M,
  VERTICAL_OUTLIER_DISTANCE_M,
  computeOutlierRobustFloorBounds,
} from './robustFloorBounds'

function bounds(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Bounds3D {
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

/** A handful of building-sized meshes near the 096 shared coordinates. */
function buildingMeshes(): Bounds3D[] {
  return [
    bounds(181_403, 30.1, -664_644, 181_410, 33.2, -664_630),
    bounds(181_409, 30.2, -664_635, 181_420, 33.3, -664_624),
    bounds(181_418, 30.1, -664_632, 181_429, 33.4, -664_621),
  ]
}

describe('computeOutlierRobustFloorBounds', () => {
  it('reuses the 1 km far-origin threshold for the plan and 20 m for the vertical axis', () => {
    expect(PLAN_OUTLIER_DISTANCE_M).toBe(1_000)
    expect(VERTICAL_OUTLIER_DISTANCE_M).toBe(20)
  })

  it('returns null bounds for empty input', () => {
    expect(computeOutlierRobustFloorBounds([])).toEqual({
      bounds: null,
      planOutlierMeshCount: 0,
      verticalOutlierMeshCount: 0,
    })
  })

  it('is the identity (plain union) when no mesh is an outlier', () => {
    const meshes = buildingMeshes()
    const result = computeOutlierRobustFloorBounds(meshes)

    expect(result.planOutlierMeshCount).toBe(0)
    expect(result.verticalOutlierMeshCount).toBe(0)
    expect(result.bounds).toEqual(
      bounds(181_403, 30.1, -664_644, 181_429, 33.4, -664_621),
    )
  })

  it('is the identity for a single mesh', () => {
    const only = bounds(0, 0, -17.4, 8.4, 3, 0)
    expect(computeOutlierRobustFloorBounds([only])).toEqual({
      bounds: only,
      planOutlierMeshCount: 0,
      verticalOutlierMeshCount: 0,
    })
  })

  it('excludes a mesh whose plan centre is kilometres from the median centre', () => {
    // Geometry misplaced ~181 km west of the building (missing easting).
    const stray = bounds(-3, 30, -664_640, 3, 33, -664_634)
    const result = computeOutlierRobustFloorBounds([...buildingMeshes(), stray])

    expect(result.planOutlierMeshCount).toBe(1)
    expect(result.verticalOutlierMeshCount).toBe(0)
    expect(result.bounds).toEqual(
      bounds(181_403, 30.1, -664_644, 181_429, 33.4, -664_621),
    )
  })

  it('excludes the vertical extent of a full-height shaft but keeps its plan extent', () => {
    // A vent stack assigned to the storey it starts on: correct in plan,
    // 125 m tall (096-P storey 01 real-data shape).
    const stack = bounds(181_430, 30.1, -664_626, 181_431, 155.3, -664_625)
    const result = computeOutlierRobustFloorBounds([...buildingMeshes(), stack])

    expect(result.planOutlierMeshCount).toBe(0)
    expect(result.verticalOutlierMeshCount).toBe(1)
    // Plan grows to include the stack footprint; Y stays the storey slice.
    expect(result.bounds).toEqual(
      bounds(181_403, 30.1, -664_644, 181_431, 33.4, -664_621),
    )
  })

  it('excludes the vertical extent of a floor-anchored covering reaching ~34 m up', () => {
    // Shaft covering anchored at the floor: its bbox CENTRE is only ~17 m out,
    // but its reach triples the floor box height (096-P storey 01 real shape).
    const covering = bounds(181_415, 30.1, -664_630, 181_416, 64.1, -664_629)
    const result = computeOutlierRobustFloorBounds([...buildingMeshes(), covering])

    expect(result.verticalOutlierMeshCount).toBe(1)
    expect(result.bounds!.maxY).toBe(33.4)
  })

  it('excludes the vertical extent of a small mesh floating ~30 m above the slice', () => {
    const floating = bounds(181_415, 59.9, -664_630, 181_416, 60.1, -664_629)
    const result = computeOutlierRobustFloorBounds([...buildingMeshes(), floating])

    expect(result.verticalOutlierMeshCount).toBe(1)
    expect(result.bounds!.maxY).toBe(33.4)
  })

  it('keeps tall-but-plausible meshes (whole extent within 20 m of the median centre)', () => {
    // A riser spanning ~3 storeys: reaches ~9 m above the median centre.
    const shortRiser = bounds(181_410, 30.1, -664_630, 181_411, 41, -664_629)
    const result = computeOutlierRobustFloorBounds([...buildingMeshes(), shortRiser])

    expect(result.verticalOutlierMeshCount).toBe(0)
    expect(result.bounds!.maxY).toBe(41)
  })

  it('falls back to the unfiltered vertical union when every mesh reaches beyond the threshold', () => {
    // A storey containing only full-height shafts: excluding all Y information
    // would leave an empty box, so the vertical filter backs off.
    const shaftA = bounds(181_410, 30.1, -664_630, 181_411, 155.3, -664_629)
    const shaftB = bounds(181_420, 30.2, -664_626, 181_421, 155.3, -664_625)
    const result = computeOutlierRobustFloorBounds([shaftA, shaftB])

    expect(result.verticalOutlierMeshCount).toBe(0)
    expect(result.bounds).toEqual(
      bounds(181_410, 30.1, -664_630, 181_421, 155.3, -664_625),
    )
  })

  it('falls back to the unfiltered union when there is no dominant plan cluster', () => {
    // Two meshes 10 km apart on different axes: BOTH are >1 km from the
    // component-wise median point, so excluding by the rule would discard
    // everything. The fallback must not crash and must not return empty bounds.
    const a = bounds(-1, 0, 9_999, 1, 3, 10_001)
    const b = bounds(9_999, 0, -1, 10_001, 3, 1)
    const result = computeOutlierRobustFloorBounds([a, b])

    expect(result.planOutlierMeshCount).toBe(0)
    expect(result.verticalOutlierMeshCount).toBe(0)
    expect(result.bounds).toEqual(bounds(-1, 0, -1, 10_001, 3, 10_001))
  })
})
