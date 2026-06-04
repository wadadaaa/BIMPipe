import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'

export type SanitaryPresentationMode = 'before' | 'after'

type SanitaryRouteSegment = SanitaryFixtureRoute['segments'][number]

export interface SanitaryPresentationState {
  hasPresentation: boolean
  visibleRoutes: SanitaryFixtureRoute[]
  visibleRisers: Riser[]
}

export interface SanitaryRouteSummary {
  totalSegments: number
  toiletSegments: number
  branchSegments: number
  collectionMainSegments: number
  toiletDiameterLabel: string
  branchDiameterLabel: string
  collectionMainDiameterLabel: string
  slopeIntentLabel: string
}

export function buildSanitaryRouteSummary(routes: SanitaryFixtureRoute[]): SanitaryRouteSummary {
  const segments = routes.flatMap((route) => route.segments)
  const toiletSegments = segments.filter((segment) => segment.routeRole === 'toiletRoute')
  const branchSegments = segments.filter((segment) => segment.routeRole === 'fixtureBranch')
  const collectionMainSegments = segments.filter((segment) => segment.routeRole === 'collectionMain')

  return {
    totalSegments: segments.length,
    toiletSegments: toiletSegments.length,
    branchSegments: branchSegments.length,
    collectionMainSegments: collectionMainSegments.length,
    toiletDiameterLabel: formatDiameterLabel(firstDiameterMm(toiletSegments) ?? 110),
    branchDiameterLabel: formatDiameterLabel(firstDiameterMm(branchSegments) ?? 50),
    collectionMainDiameterLabel: formatDiameterLabel(firstDiameterMm(collectionMainSegments) ?? 63),
    slopeIntentLabel: formatSlopeIntentLabel(routes.map((route) => route.slope)),
  }
}

function firstDiameterMm(segments: SanitaryRouteSegment[]): number | null {
  const segment = segments.find((candidate) => (candidate.pipeDiameterMm ?? candidate.diameterMm) != null)
  return segment?.pipeDiameterMm ?? segment?.diameterMm ?? null
}

function formatDiameterLabel(diameterMm: number): string {
  return `${diameterMm} mm`
}

function formatSlopeIntentLabel(slopes: number[]): string {
  const usableSlopes = slopes.length > 0 ? slopes : [0.02]
  const slopePercents = usableSlopes.map((slope) => slope * 100)
  const min = Math.min(...slopePercents)
  const max = Math.max(...slopePercents)
  const formattedMin = min.toFixed(1)
  const formattedMax = max.toFixed(1)
  return formattedMin === formattedMax
    ? `${formattedMin}% route intent`
    : `${formattedMin}–${formattedMax}% route intent`
}

export function getSanitaryPresentationState({
  mode,
  risers,
  routes,
}: {
  mode: SanitaryPresentationMode
  risers: Riser[]
  routes: SanitaryFixtureRoute[]
}): SanitaryPresentationState {
  const hasPresentation = routes.length > 0
  return {
    hasPresentation,
    visibleRoutes: hasPresentation && mode === 'before' ? [] : routes,
    // Keep risers visible in both modes: the comparison is between detected/selected
    // riser intent and generated pipe routes, not between manual inputs and nothing.
    visibleRisers: risers,
  }
}
