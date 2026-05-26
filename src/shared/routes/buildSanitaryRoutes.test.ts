import { describe, expect, it } from 'vitest'
import type { DemoConfig } from '@/shared/demoConfig'
import type { Fixture, Riser } from '@/domain/types'
import { buildSanitaryRoutingDemoPlan, DEMO_SANITARY_SLOPE } from './buildSanitaryRoutes'

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

function riser(id: string, x: number, z: number): Riser {
  return { id, stackId: id, stackLabel: id, storeyId: 1, position: { x, y: 0, z } }
}

describe('buildSanitaryRoutingDemoPlan', () => {
  it('fails clearly without risers', () => {
    const plan = buildSanitaryRoutingDemoPlan([fixture({})], [], demoConfig)
    expect(plan.routes).toHaveLength(0)
    expect(plan.limitations[0]).toContain('requires at least one selected riser')
  })

  it('applies PRD defaults for toilets and wet fixtures', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 10, kind: 'TOILETPAN' }),
        fixture({ expressId: 11, kind: 'SINK', position: { x: 2, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const toilet = plan.routes.find((route) => route.fixtureExpressId === 10)
    const sink = plan.routes.find((route) => route.fixtureExpressId === 11)

    expect(toilet).toMatchObject({ pipeDiameterMm: 110, startHeightAboveFloorM: 0.2, slope: DEMO_SANITARY_SLOPE })
    expect(sink).toMatchObject({ pipeDiameterMm: 50, startHeightAboveFloorM: 0.15, slope: DEMO_SANITARY_SLOPE })
  })

  it('uses farthest fixture as main line and branches closer fixtures', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 101, position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 102, position: { x: 6, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const far = plan.routes.find((route) => route.fixtureExpressId === 101)
    const close = plan.routes.find((route) => route.fixtureExpressId === 102)

    expect(far?.segments).toHaveLength(1)
    expect(far?.segments[0].kind).toBe('main')
    expect(close?.segments).toHaveLength(2)
    expect(close?.segments[0].kind).toBe('branch')
  })
})
