import { describe, expect, it } from 'vitest'
import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'
import { buildSanitaryRouteFactCards, buildSanitaryRouteSummary, getSanitaryPresentationState } from './sanitaryPresentation'

const risers = [{ id: 'r1' }, { id: 'r2' }] as Riser[]
const routes = [
  {
    fixtureExpressId: 1,
    fixtureName: 'WC-1',
    fixtureKind: 'TOILETPAN',
    riserId: 'r1',
    pipeDiameterMm: 110,
    startHeightAboveFloorM: 0.2,
    slope: 0.02,
    segments: [
      { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 1 }, kind: 'main', pipeDiameterMm: 110, routeRole: 'toiletRoute', diameterMm: 110 },
      { from: { x: 1, y: 0, z: 1 }, to: { x: 2, y: 0, z: 2 }, kind: 'main', pipeDiameterMm: 63, routeRole: 'collectionMain', diameterMm: 63 },
      { from: { x: 2, y: 0, z: 2 }, to: { x: 3, y: 0, z: 3 }, kind: 'branch', pipeDiameterMm: 50, routeRole: 'fixtureBranch', diameterMm: 50 },
    ],
  },
] as SanitaryFixtureRoute[]

describe('sanitary presentation helpers', () => {
  it('keeps risers visible in before mode while hiding generated routes for comparison', () => {
    const before = getSanitaryPresentationState({ mode: 'before', risers, routes })

    expect(before.visibleRisers).toBe(risers)
    expect(before.visibleRoutes).toEqual([])
    expect(before.hasPresentation).toBe(true)
  })

  it('shows risers and routes in after mode', () => {
    const after = getSanitaryPresentationState({ mode: 'after', risers, routes })

    expect(after.visibleRisers).toBe(risers)
    expect(after.visibleRoutes).toBe(routes)
  })

  it('counts route categories by explicit route role for demo labels', () => {
    expect(buildSanitaryRouteSummary(routes)).toEqual({
      routeCount: 1,
      totalSegments: 3,
      toiletSegments: 1,
      branchSegments: 1,
      collectionMainSegments: 1,
      toiletDiameterLabel: '110 mm',
      branchDiameterLabel: '50 mm',
      collectionMainDiameterLabel: '63 mm',
      slopeIntentLabel: '2.0% design slope',
      routeSegmentCountLabel: '3 route segments',
    })
  })

  it('does not invent a slope when no routes are present', () => {
    expect(buildSanitaryRouteSummary([]).slopeIntentLabel).toBe('N/A')
  })

  it('summarizes mixed route slopes as an intent range', () => {
    const mixedSlopeRoutes = [
      routes[0],
      { ...routes[0], fixtureExpressId: 2, slope: 0.015 },
    ] as SanitaryFixtureRoute[]

    expect(buildSanitaryRouteSummary(mixedSlopeRoutes).slopeIntentLabel).toBe('1.5–2.0% design slope')
  })

  it('formats route segment counts with clean singular and plural copy', () => {
    expect(buildSanitaryRouteSummary(routes).routeSegmentCountLabel).toBe('3 route segments')

    const oneSegmentRoute = [
      {
        ...routes[0],
        segments: [routes[0].segments[0]],
      },
    ] as SanitaryFixtureRoute[]

    expect(buildSanitaryRouteSummary(oneSegmentRoute).routeSegmentCountLabel).toBe('1 route segment')
  })

  it('keeps per-role diameter defaults when a route role is absent', () => {
    const branchOnlyRoutes = [
      {
        ...routes[0],
        segments: [
          { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 1 }, kind: 'branch', pipeDiameterMm: 50, routeRole: 'fixtureBranch', diameterMm: 50 },
        ],
      },
    ] as SanitaryFixtureRoute[]

    expect(buildSanitaryRouteSummary(branchOnlyRoutes)).toMatchObject({
      toiletSegments: 0,
      toiletDiameterLabel: '110 mm',
      branchSegments: 1,
      branchDiameterLabel: '50 mm',
      collectionMainSegments: 0,
      collectionMainDiameterLabel: '63 mm',
    })
  })

  it('hides zero-count route breakdown cards while keeping total routes', () => {
    const toiletOnlyRoutes = [
      {
        ...routes[0],
        segments: [routes[0].segments[0]],
      },
    ] as SanitaryFixtureRoute[]

    const facts = buildSanitaryRouteFactCards(buildSanitaryRouteSummary(toiletOnlyRoutes))

    expect(facts.routeFactCards).toEqual([
      { label: 'Sanitary routes', value: '1 route' },
      { label: '110 mm toilet routes', value: '1 route' },
    ])
    expect(facts.hasBreakdown).toBe(true)
  })

  it('reports when no route breakdown cards are available yet', () => {
    const unclassifiedRoutes = [
      {
        ...routes[0],
        segments: [
          { ...routes[0].segments[0], routeRole: 'unknown' as never },
        ],
      },
    ] as SanitaryFixtureRoute[]

    const facts = buildSanitaryRouteFactCards(buildSanitaryRouteSummary(unclassifiedRoutes))

    expect(facts.routeFactCards).toEqual([{ label: 'Sanitary routes', value: '1 route' }])
    expect(facts.hasBreakdown).toBe(false)
  })

  it('uses clean plural wording for multiple branch cards', () => {
    const branchRoutes = [
      {
        ...routes[0],
        segments: [
          { ...routes[0].segments[2] },
          { ...routes[0].segments[2], from: { x: 3, y: 0, z: 3 }, to: { x: 4, y: 0, z: 4 } },
        ],
      },
    ] as SanitaryFixtureRoute[]

    const facts = buildSanitaryRouteFactCards(buildSanitaryRouteSummary(branchRoutes))

    expect(facts.routeFactCards).toContainEqual({ label: '50 mm branches', value: '2 branches' })
    expect(facts.routeFactCards).not.toContainEqual({ label: '50 mm branches', value: '2 branchs' })
  })
})
