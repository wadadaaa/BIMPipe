import { describe, expect, it } from 'vitest'
import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'
import { buildSanitaryRouteSummary, getSanitaryPresentationState } from './sanitaryPresentation'

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

  it('counts route categories by explicit route role for investor labels', () => {
    expect(buildSanitaryRouteSummary(routes)).toEqual({
      totalSegments: 3,
      toiletSegments: 1,
      branchSegments: 1,
      collectionMainSegments: 1,
      toiletDiameterLabel: '110 mm',
      branchDiameterLabel: '50 mm',
      collectionMainDiameterLabel: '63 mm',
      slopeIntentLabel: '2.0% route intent',
    })
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
})
