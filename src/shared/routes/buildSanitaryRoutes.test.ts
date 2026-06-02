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
        fixture({ expressId: 602, kind: 'BATH', position: { x: 3, y: 0, z: 2 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    const sink = plan.routes.find((route) => route.fixtureExpressId === 601)
    const bath = plan.routes.find((route) => route.fixtureExpressId === 602)
    expect(sink?.segments[0]).toMatchObject({ kind: 'main', routeRole: 'collectionMain', pipeDiameterMm: 63 })
    expect(bath?.segments[0]).toMatchObject({ kind: 'branch', routeRole: 'fixtureBranch', pipeDiameterMm: 50 })
  })

  it('uses farthest fixture as main line and branches closer fixtures', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 101, kind: 'SINK', position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 102, kind: 'BATH', position: { x: 3, y: 0, z: 2 } }),
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
    expect(close?.segments[0].routeRole).toBe('fixtureBranch')
    // The main run terminates at the riser; the branch joins the shared main instead of drawing a direct fixture-to-riser line.
    expect(far?.segments[0].to).toEqual({ x: 10, y: 0, z: 0 })
    expect(close?.segments[0].to).not.toEqual({ x: 10, y: 0, z: 0 })
    expect(plan.limitations).toContain('Grouped sanitary preview uses shared collection mains and 45° fixture branches where plan geometry allows.')
  })

  it('groups nearby toilets to one service-zone riser instead of direct nearest-riser lines', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 111, position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 112, position: { x: 3, y: 0, z: 1 } }),
      ],
      [riser('R1', 0, 0), riser('R2', 3, 1)],
      demoConfig,
    )

    expect(new Set(plan.routes.map((route) => route.riserId)).size).toBe(1)
    expect(plan.routes.some((route) => route.segments[0].routeRole === 'riserConnection')).toBe(true)
    expect(plan.routes.some((route) => route.segments[0].kind === 'branch')).toBe(true)
    expect(plan.debug.groups[0].decisions[0]).toContain('Grouped sanitary service zone')
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

  it('does not duplicate routes when unsupported fixtures occupy other storeys', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 901, storeyId: 2, position: { x: 1, y: 3, z: 0 } }),
        fixture({ expressId: 902, storeyId: 3, kind: 'URINAL', position: { x: 1, y: 6, z: 0 } }),
      ],
      [
        riser('R1-F2', 10, 0, 2, 'stack-A', 3),
        riser('R1-F3', 10, 0, 3, 'stack-A', 6),
        riser('R1-F4', 10, 0, 4, 'stack-A', 9),
      ],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].riserId).toBe('R1-F2')
    expect(plan.limitations).not.toContain(
      'Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.',
    )
  })

  it('emits a visible transition when a fixture coincides with its riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 901, position: { x: 10, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].segments[0]).toMatchObject({
      to: { x: 10, y: 0, z: 0 },
      routeRole: 'transition',
      pipeDiameterMm: 110,
      labelIntent: 'BIMPipe Ø110 WC transition',
    })
    expect(plan.routes[0].segments[0].from).not.toEqual(plan.routes[0].segments[0].to)
    expect(plan.limitations).not.toContain(
      'Sanitary route skipped for fixture 901 because fixture point coincides with riser R1.',
    )
  })

  it('keeps other fixtures routed when one fixture coincides with the riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 902, position: { x: 10, y: 0, z: 0 } }),
        fixture({ expressId: 903, position: { x: 2, y: 0, z: 0 } }),
      ],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes.map((route) => route.fixtureExpressId).sort()).toEqual([902, 903])
    expect(plan.routes.find((route) => route.fixtureExpressId === 902)?.segments[0]).toMatchObject({
      routeRole: 'transition',
      pipeDiameterMm: 110,
    })
    expect(plan.routes.find((route) => route.fixtureExpressId === 903)?.segments[0]).toMatchObject({
      routeRole: 'riserConnection',
      pipeDiameterMm: 110,
    })
    expect(plan.limitations).not.toContain(
      'Sanitary route skipped for fixture 902 because fixture point coincides with riser R1.',
    )
  })

  it('uses a single main segment without branch limitation for one fixture per riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 301, position: { x: 2, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].segments[0]).toMatchObject({
      from: { x: 2, y: 0, z: 0 },
      to: { x: 10, y: 0, z: 0 },
      kind: 'main',
      routeRole: 'toiletRoute',
      pipeDiameterMm: 110,
      system: 'BIMPipe Sanitary Routes',
      diameterMm: 110,
      slopePercent: 2,
      targetRiserId: 'R1',
      sourceFixtureId: 301,
      sourceFixtureType: 'TOILETPAN',
    })
    expect(plan.limitations).not.toContain('Grouped sanitary preview uses shared collection mains and 45° fixture branches where plan geometry allows.')
  })
})
