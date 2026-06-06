import { describe, expect, it } from 'vitest'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'
import { buildSanitaryFlowStreams } from './sanitaryFlowAnimation'

const routes: SanitaryFixtureRoute[] = [
  {
    fixtureExpressId: 10,
    fixtureName: 'WC-1',
    fixtureKind: 'TOILETPAN',
    riserId: 'R-1',
    pipeDiameterMm: 110,
    startHeightAboveFloorM: 0.2,
    slope: 0.02,
    segments: [
      {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 10, y: 0, z: 0 },
        kind: 'main',
        pipeDiameterMm: 110,
        routeRole: 'toiletRoute',
        diameterMm: 110,
        targetRiserId: 'R-1',
        label: 'Ø110 toilet 2.0%',
      },
    ],
  },
  {
    fixtureExpressId: 20,
    fixtureName: 'WB-1',
    fixtureKind: 'WASHHANDBASIN',
    riserId: 'R-1',
    pipeDiameterMm: 50,
    startHeightAboveFloorM: 0.15,
    slope: 0.02,
    segments: [
      {
        from: { x: 0, y: 0, z: 5 },
        to: { x: 5, y: 0, z: 5 },
        kind: 'branch',
        pipeDiameterMm: 50,
        routeRole: 'fixtureBranch',
        diameterMm: 50,
        targetRiserId: 'R-1',
        routeGroupId: 'zone-1',
        label: 'Ø50 branch 2.0%',
      },
      {
        from: { x: 5, y: 0, z: 5 },
        to: { x: 10, y: 0, z: 0 },
        kind: 'main',
        pipeDiameterMm: 63,
        routeRole: 'collectionMain',
        diameterMm: 63,
        targetRiserId: 'R-1',
        routeGroupId: 'zone-1',
        label: 'Ø63 main 2.0%',
      },
    ],
  },
]

describe('sanitary flow animation presentation streams', () => {
  it('builds viewer-only streams that move from fixture branches toward risers', () => {
    const streams = buildSanitaryFlowStreams(routes)

    expect(streams).toHaveLength(3)
    expect(streams.map((stream) => stream.role)).toEqual([
      'toiletRoute',
      'fixtureBranch',
      'collectionMain',
    ])
    expect(streams[0]).toMatchObject({
      key: '10-toiletRoute-0',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 10, y: 0, z: 0 },
      diameterMm: 110,
      targetRiserId: 'R-1',
    })
    expect(streams[1].phaseDelayMs).toBeLessThan(streams[2].phaseDelayMs)
    expect(streams[2].aggregation).toBe('collector')
  })

  it('returns no streams for empty route results', () => {
    expect(buildSanitaryFlowStreams([])).toEqual([])
  })
})
