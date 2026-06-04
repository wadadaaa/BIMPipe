import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'

export type SanitaryPresentationMode = 'before' | 'after'

export interface SanitaryRouteSummary {
  totalSegments: number
  toiletSegments: number
  branchSegments: number
  collectionMainSegments: number
}

export function buildSanitaryRouteSummary(routes: SanitaryFixtureRoute[]): SanitaryRouteSummary {
  const segments = routes.flatMap((route) => route.segments)
  return {
    totalSegments: segments.length,
    toiletSegments: segments.filter((segment) => segment.routeRole === 'toiletRoute').length,
    branchSegments: segments.filter((segment) => segment.routeRole === 'fixtureBranch').length,
    collectionMainSegments: segments.filter((segment) => segment.routeRole === 'collectionMain').length,
  }
}

export function getSanitaryPresentationState({
  mode,
  risers,
  routes,
}: {
  mode: SanitaryPresentationMode
  risers: Riser[]
  routes: SanitaryFixtureRoute[]
}) {
  const hasPresentation = routes.length > 0
  return {
    hasPresentation,
    visibleRoutes: hasPresentation && mode === 'before' ? [] : routes,
    // Keep risers visible in both modes: the comparison is between detected/selected
    // riser intent and generated pipe routes, not between manual inputs and nothing.
    visibleRisers: risers,
  }
}
