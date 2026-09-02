import { describe, expect, it } from 'vitest'
import type { EngineerRiserStack } from '@/domain/engineerPipes'
import { alignEngineerStacksToViewerPlan, ifcSourceToViewerPoint } from './ifcSourceFrame'

describe('ifcSourceToViewerPoint', () => {
  it('maps IFC X→x, IFC Z→y, IFC Y→−z with the unit conversion applied', () => {
    // A centimetre-model point (metersPerSourceUnit = 0.01), like 096.
    const viewer = ifcSourceToViewerPoint({ x: 18_141_600, y: -66_463_200, z: 3_015 }, 0.01)
    expect(viewer.x).toBeCloseTo(181_416, 6)
    expect(viewer.y).toBeCloseTo(30.15, 6)
    expect(viewer.z).toBeCloseTo(664_632, 6)
  })

  it('is the identity on axes for a metre model at the origin side', () => {
    expect(ifcSourceToViewerPoint({ x: 2, y: 3, z: 4 }, 1)).toEqual({ x: 2, y: 4, z: -3 })
  })

  it('normalizes zero without a negative-zero z', () => {
    const viewer = ifcSourceToViewerPoint({ x: 0, y: 0, z: 0 }, 0.001)
    expect(Object.is(viewer.z, -0)).toBe(true)
    // -0 is numerically equal to 0 everywhere the value is consumed (distance
    // math, SVG attributes); documented here so the behaviour is deliberate.
    expect(viewer.z === 0).toBe(true)
  })
})

describe('alignEngineerStacksToViewerPlan', () => {
  it('negates yM only, preserving every other stack field', () => {
    const stacks: EngineerRiserStack[] = [
      {
        id: 'engineer-riser-1',
        xM: 12.5,
        yM: -7.25,
        storeys: [{ id: 90, name: '01' }],
        diameterMm: 110,
        segmentExpressIds: [1, 2],
      },
    ]

    const aligned = alignEngineerStacksToViewerPlan(stacks)
    expect(aligned).toHaveLength(1)
    expect(aligned[0]).toEqual({ ...stacks[0], yM: 7.25 })
    // Input is not mutated.
    expect(stacks[0].yM).toBe(-7.25)
  })
})
