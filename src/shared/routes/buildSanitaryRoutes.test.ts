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

  it('generates one grouped service-zone layout with explicit roles, diameters, slope, and debug output', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 101, kind: 'TOILETPAN', position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 102, kind: 'SINK', position: { x: 2, y: 0, z: 4 } }),
        fixture({ expressId: 103, kind: 'BATH', position: { x: 6, y: 0, z: 3 } }),
      ],
      [riser('R1', 10, 0), riser('R2', 100, 0)],
      demoConfig,
    )

    const allSegments = plan.routes.flatMap((route) => route.segments)
    const toiletRoute = allSegments.find((segment) => segment.routeRole === 'toiletRoute')
    const collectionMain = allSegments.find((segment) => segment.routeRole === 'collectionMain')
    const fixtureBranch = allSegments.find((segment) => segment.routeRole === 'fixtureBranch')

    expect(plan.debugGroups).toHaveLength(1)
    expect(plan.debugGroups[0]).toMatchObject({ targetRiserId: 'R1', branchCount: 2 })
    expect(plan.debugGroups[0].targetRiserReason).toContain('toilet centroid from 1 toilet fixture')
    expect(toiletRoute).toMatchObject({ diameterMm: 110, slopePercent: 2, targetRiserId: 'R1' })
    expect(collectionMain).toMatchObject({ diameterMm: 63, slopePercent: 2, targetRiserId: 'R1' })
    expect(fixtureBranch).toMatchObject({ diameterMm: 50, slopePercent: 2, targetRiserId: 'R1' })
    expect(fixtureBranch?.to).not.toEqual({ x: 10, y: 0, z: 0 })
    expect(new Set(plan.routes.map((route) => route.routeGroupId))).toEqual(new Set(['storey-1-zone-1']))
  })

  it('keeps nearby fixtures grouped to one target riser instead of creating a cross-riser trunk', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 201, kind: 'TOILETPAN', position: { x: 1, y: 0, z: 0 } }),
        fixture({ expressId: 202, kind: 'SINK', position: { x: 4, y: 0, z: 3 } }),
      ],
      [riser('R1', 0, 0), riser('R2', 7, 3)],
      demoConfig,
    )

    expect(new Set(plan.routes.map((route) => route.riserId))).toEqual(new Set(['R1']))
    expect(plan.routes.flatMap((route) => route.segments).every((segment) => segment.targetRiserId === 'R1')).toBe(true)
    expect(plan.debugGroups[0].targetRiserReason).toContain('toilet centroid from 1 toilet fixture')
  })

  it('does not merge far-apart service zones through an intermediate fixture chain', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 301, kind: 'SINK', position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 302, kind: 'BATH', position: { x: 16, y: 0, z: 0 } }),
        fixture({ expressId: 303, kind: 'WASHHANDBASIN', position: { x: 32, y: 0, z: 0 } }),
      ],
      [riser('R1', 0, 0), riser('R2', 40, 0)],
      demoConfig,
    )

    expect(plan.debugGroups).toHaveLength(2)
    expect(plan.debugGroups.map((group) => group.fixtureIds)).toEqual([[301, 302], [303]])
    expect(plan.routes.find((route) => route.fixtureExpressId === 301)?.routeGroupId).toBe('storey-1-zone-1')
    expect(plan.routes.find((route) => route.fixtureExpressId === 302)?.routeGroupId).toBe('storey-1-zone-1')
    expect(plan.routes.find((route) => route.fixtureExpressId === 303)?.routeGroupId).toBe('storey-1-zone-2')
    expect(new Set(plan.routes.map((route) => route.riserId))).toEqual(new Set(['R1', 'R2']))
  })

  it('documents all-fixture centroid riser selection when a service zone has no toilets', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [
        fixture({ expressId: 351, kind: 'SINK', position: { x: 20, y: 0, z: 0 } }),
        fixture({ expressId: 352, kind: 'BATH', position: { x: 24, y: 0, z: 0 } }),
      ],
      [riser('R1', 0, 0), riser('R2', 30, 0)],
      demoConfig,
    )

    expect(plan.debugGroups[0]).toMatchObject({ targetRiserId: 'R2' })
    expect(plan.debugGroups[0].targetRiserReason).toContain('all-fixture centroid from 2 fixtures')
    expect(plan.debugGroups[0].targetRiserReason).toContain('0 toilet fixtures')
  })

  it('assigns distant service zones to independent target risers', () => {
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

    const targetsByGroup = new Map<string, Set<string>>()
    for (const route of plan.routes) {
      expect(route.routeGroupId).toBeDefined()
      expect(route.targetRiserId).toBe(route.riserId)
      const targets = targetsByGroup.get(route.routeGroupId!) ?? new Set<string>()
      targets.add(route.targetRiserId!)
      targetsByGroup.set(route.routeGroupId!, targets)
      for (const segment of route.segments) {
        expect(segment.routeGroupId).toBe(route.routeGroupId)
        expect(segment.targetRiserId).toBe(route.targetRiserId)
      }
    }
    expect([...targetsByGroup.values()].every((targets) => targets.size === 1)).toBe(true)
    expect(new Set(plan.routes.map((route) => route.routeGroupId))).toHaveProperty('size', 3)
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

  it('does not emit a zero-length segment when a fixture coincides with its riser', () => {
    const plan = buildSanitaryRoutingDemoPlan(
      [fixture({ expressId: 901, position: { x: 10, y: 0, z: 0 } })],
      [riser('R1', 10, 0)],
      demoConfig,
    )

    expect(plan.routes).toHaveLength(0)
    expect(plan.limitations).toContain(
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

    expect(plan.routes.map((route) => route.fixtureExpressId)).toEqual([903])
    expect(plan.routes[0].segments).toHaveLength(1)
    expect(plan.limitations).toContain(
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
    expect(plan.routes[0].segments).toHaveLength(1)
    expect(plan.routes[0].segments[0]).toMatchObject({
      from: { x: 2, y: 0, z: 0 },
      to: { x: 10, y: 0, z: 0 },
      kind: 'main',
      pipeDiameterMm: 110,
      routeRole: 'toiletRoute',
      diameterMm: 110,
      slopePercent: 2,
    })
    expect(plan.limitations).not.toContain('Branch fixtures are drawn as a single straight branch run to the riser in plan view for the demo.')
  })
})
