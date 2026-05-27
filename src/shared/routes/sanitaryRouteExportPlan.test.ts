import { describe, expect, it } from 'vitest'
import type { DemoConfig } from '@/shared/demoConfig'
import type { Fixture, Riser } from '@/domain/types'
import { buildSanitaryRoutingDemoPlan } from './buildSanitaryRoutes'
import {
  collectSanitaryExportSegments,
  segmentEndpointElevationsSourceUnits,
} from './sanitaryRouteExportPlan'

const demoConfig: DemoConfig = {
  name: 'demo',
  model: { fileName: 'ADAM_10.ifc', schema: 'IFC2X3', source: 'x', assetPath: 'x' },
  scope: { includedFloors: ['1'], excludedFloors: [] },
  routing: { mode: 'demo', allowManualRiserSelection: true },
}

function fixture(overrides: Partial<Fixture>): Fixture {
  return {
    expressId: 1,
    name: 'fixture',
    kind: 'TOILETPAN',
    storeyId: 1,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

function riser(id: string, x: number, z: number, storeyId = 1): Riser {
  return { id, stackId: id, stackLabel: id, storeyId, position: { x, y: 0, z } }
}

describe('sanitaryRouteExportPlan', () => {
  it('deduplicates shared main segments across fixtures on the same riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 101, position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 102, position: { x: 6, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const segments = collectSanitaryExportSegments(plan.routes, [{ id: 1, elevation: 300 }], [riser('R1', 10, 0)])
    const mainSegments = segments.filter((segment) => segment.segment.kind === 'main')
    expect(mainSegments).toHaveLength(1)
    expect(mainSegments[0].segment.pipeDiameterMm).toBe(110)
  })

  it('preserves 50mm branches and 63mm grouped mains for wet fixtures', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 201, kind: 'SINK', position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 202, kind: 'BATH', position: { x: 8, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const segments = collectSanitaryExportSegments(plan.routes, [{ id: 1, elevation: 300 }], [riser('R1', 10, 0)])
    expect(segments.some((segment) => segment.segment.kind === 'branch' && segment.segment.pipeDiameterMm === 50)).toBe(
      true,
    )
    expect(segments.some((segment) => segment.segment.kind === 'main' && segment.segment.pipeDiameterMm === 63)).toBe(
      true,
    )
  })

  it('computes downstream elevations with 2% slope toward the riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 301, position: { x: 0, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )
    const [segment] = collectSanitaryExportSegments(plan.routes, [{ id: 1, elevation: 300 }], [riser('R1', 10, 0)])
    const elevations = segmentEndpointElevationsSourceUnits(segment, 300, 1, 10)

    expect(elevations.startElevation).toBeCloseTo(320, 5)
    expect(elevations.endElevation).toBeLessThan(elevations.startElevation)
    expect(elevations.startElevation - elevations.endElevation).toBeCloseTo(10 * 0.02, 5)
  })
})
