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

function riser(id: string, x: number, z: number, storeyId = 1, stackId = id, y = 0): Riser {
  return { id, stackId, stackLabel: stackId, storeyId, position: { x, y, z } }
}

describe('buildSanitaryRoutingDemoPlan', () => {
  it('fails clearly without risers', () => {
    const plan = buildSanitaryRoutingDemoPlan([fixture({})], [], demoConfig)
    expect(plan.routes).toHaveLength(0)
    expect(plan.limitations[0]).toContain('requires at least one selected riser')
  })

  it('throws when called outside demo routing mode', () => {
    expect(() =>
      buildSanitaryRoutingDemoPlan([fixture({})], [riser('R1', 10, 0)], {
        ...demoConfig,
        routing: { ...demoConfig.routing, mode: 'production' },
      } as unknown as DemoConfig),
    ).toThrow('requires demo routing mode')
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

  it('uses 63mm collection main lines when grouped wet fixtures branch', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 601, kind: 'SINK', position: { x: 2, y: 0, z: 0 } }),
        fixture({ expressId: 602, kind: 'BATH', position: { x: 8, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const sink = plan.routes.find((route) => route.fixtureExpressId === 601)
    const bath = plan.routes.find((route) => route.fixtureExpressId === 602)
    expect(sink?.segments[0]).toMatchObject({ kind: 'main', pipeDiameterMm: 63 })
    expect(bath?.segments[0]).toMatchObject({ kind: 'branch', pipeDiameterMm: 50 })
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
    expect(close?.segments).toHaveLength(1)
    expect(close?.segments[0].kind).toBe('branch')
    expect(plan.limitations).toContain('45° branches are approximated by a single branch segment in plan view for the demo.')
  })

  it('assigns fixtures to their nearest same-storey riser when multiple risers exist', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 201, position: { x: 1, y: 0, z: 0 } }),
        fixture({ expressId: 202, position: { x: 101, y: 0, z: 0 } }),
      ],
      [riser('R1', 0, 0), riser('R2', 100, 0)],
      demoConfig,
    )

    expect(plan.routes.find((route) => route.fixtureExpressId === 201)?.riserId).toBe('R1')
    expect(plan.routes.find((route) => route.fixtureExpressId === 202)?.riserId).toBe('R2')
  })

  it('duplicates single-floor demo routes across matching riser stack floors', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 701, storeyId: 2, position: { x: 1, y: 3, z: 0 } })],
      [
        riser('R1-F2', 10, 0, 2, 'stack-A', 3),
        riser('R1-F3', 10, 0, 3, 'stack-A', 6),
        riser('R1-F4', 10, 0, 4, 'stack-A', 9),
      ],
      demoConfig,
    )

    expect(plan.routes.map((route) => route.riserId).sort()).toEqual(['R1-F2', 'R1-F3', 'R1-F4'])
    expect(plan.routes.find((route) => route.riserId === 'R1-F3')?.segments[0]).toMatchObject({
      from: { x: 1, y: 6, z: 0 },
      to: { x: 10, y: 6, z: 0 },
      kind: 'main',
      pipeDiameterMm: 110,
    })
    expect(plan.limitations).toContain('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  })

  it('does not duplicate routes when fixtures already cover multiple storeys', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 801, storeyId: 2, position: { x: 1, y: 3, z: 0 } }),
        fixture({ expressId: 802, storeyId: 3, position: { x: 1, y: 6, z: 0 } }),
      ],
      [
        riser('R1-F2', 10, 0, 2, 'stack-A', 3),
        riser('R1-F3', 10, 0, 3, 'stack-A', 6),
      ],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(2)
    expect(plan.routes.map((route) => route.riserId).sort()).toEqual(['R1-F2', 'R1-F3'])
    expect(plan.limitations).not.toContain('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  })

  it('does not route fixtures to risers from other storeys', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 401, storeyId: 1, position: { x: 1, y: 0, z: 0 } })],
      [riser('R2', 1, 0, 2)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(0)
    expect(plan.limitations[0]).toContain('no same-storey riser')
    expect(plan.limitations[0]).toContain('401')
  })

  it('documents unsupported fixture kinds as skipped', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 501, kind: 'URINAL', position: { x: 1, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(0)
    expect(plan.limitations[0]).toContain('Unsupported fixture kinds skipped: URINAL')
  })

  it('uses a single main segment without branch limitation for one fixture per riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 301, position: { x: 2, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].segments).toEqual([
      { from: { x: 2, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 }, kind: 'main', pipeDiameterMm: 110 },
    ])
    expect(plan.limitations).not.toContain('45° branches are approximated by a single branch segment in plan view for the demo.')
  })
})
