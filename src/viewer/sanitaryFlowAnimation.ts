import type { SanitaryFixtureRoute, SanitaryPipeDiameterMm, SanitaryRouteRole } from '@/shared/routes/buildSanitaryRoutes'

export type SanitaryFlowAggregation = 'fixture' | 'collector'

export interface SanitaryFlowParticle {
  key: string
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  role: SanitaryRouteRole
  diameterMm: SanitaryPipeDiameterMm
  targetRiserId: string
  aggregation: SanitaryFlowAggregation
  phaseDelayMs: number
  durationMs: number
}

const ROLE_PHASE_DELAY_MS: Record<SanitaryRouteRole, number> = {
  fixtureBranch: 0,
  collectionMain: 260,
  toiletRoute: 120,
}

const ROLE_DURATION_MS: Record<SanitaryRouteRole, number> = {
  fixtureBranch: 1900,
  collectionMain: 2400,
  toiletRoute: 2200,
}

export function buildSanitaryFlowParticles(routes: SanitaryFixtureRoute[]): SanitaryFlowParticle[] {
  return routes.flatMap((route, routeIndex) =>
    route.segments.map((segment, segmentIndex) => {
      const role = segment.routeRole ?? (segment.kind === 'branch' ? 'fixtureBranch' : 'collectionMain')
      const diameterMm = segment.diameterMm ?? segment.pipeDiameterMm
      return {
        key: `${route.fixtureExpressId}-${role}-${segmentIndex}`,
        from: segment.from,
        to: segment.to,
        role,
        diameterMm,
        targetRiserId: segment.targetRiserId ?? route.targetRiserId ?? route.riserId,
        aggregation: role === 'collectionMain' ? 'collector' : 'fixture',
        phaseDelayMs: routeIndex * 90 + segmentIndex * 120 + ROLE_PHASE_DELAY_MS[role],
        durationMs: ROLE_DURATION_MS[role],
      }
    }),
  )
}
