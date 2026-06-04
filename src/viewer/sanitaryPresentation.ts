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
  routeCount: number
  totalSegments: number
  toiletSegments: number
  branchSegments: number
  collectionMainSegments: number
  toiletDiameterLabel: string
  branchDiameterLabel: string
  collectionMainDiameterLabel: string
  slopeIntentLabel: string
  routeSegmentCountLabel: string
}

export function buildSanitaryRouteSummary(routes: SanitaryFixtureRoute[]): SanitaryRouteSummary {
  const segments = routes.flatMap((route) => route.segments)
  const toiletSegments = segments.filter((segment) => segment.routeRole === 'toiletRoute')
  const branchSegments = segments.filter((segment) => segment.routeRole === 'fixtureBranch')
  const collectionMainSegments = segments.filter((segment) => segment.routeRole === 'collectionMain')

  return {
    routeCount: routes.length,
    totalSegments: segments.length,
    toiletSegments: toiletSegments.length,
    branchSegments: branchSegments.length,
    collectionMainSegments: collectionMainSegments.length,
    toiletDiameterLabel: formatDiameterLabel(firstDiameterMm(toiletSegments) ?? 110),
    branchDiameterLabel: formatDiameterLabel(firstDiameterMm(branchSegments) ?? 50),
    collectionMainDiameterLabel: formatDiameterLabel(firstDiameterMm(collectionMainSegments) ?? 63),
    slopeIntentLabel: formatSlopeIntentLabel(routes.map((route) => route.slope)),
    routeSegmentCountLabel: formatRouteSegmentCountLabel(segments.length),
  }
}

function firstDiameterMm(segments: SanitaryRouteSegment[]): number | null {
  // pipeDiameterMm is the canonical segment diameter today; diameterMm is a legacy
  // export alias retained in buildSanitaryRoutes until IFC export fully migrates.
  const segment = segments.find((candidate) => candidate.pipeDiameterMm != null)
  return segment?.pipeDiameterMm ?? null
}

function formatDiameterLabel(diameterMm: number): string {
  return `${diameterMm} mm`
}

function formatSlopeIntentLabel(slopes: number[]): string {
  if (slopes.length === 0) return 'N/A'
  const slopePercents = slopes.map((slope) => slope * 100)
  const min = Math.min(...slopePercents)
  const max = Math.max(...slopePercents)
  const formattedMin = min.toFixed(1)
  const formattedMax = max.toFixed(1)
  return formattedMin === formattedMax
    ? `${formattedMin}% design slope`
    : `${formattedMin}–${formattedMax}% design slope`
}

function formatRouteSegmentCountLabel(count: number): string {
  return `${count} route ${count === 1 ? 'segment' : 'segments'}`
}

export interface SanitaryRouteFactCard {
  label: string
  value: string
}

export interface SanitaryRouteFactCards {
  routeFactCards: SanitaryRouteFactCard[]
  routeBreakdownCards: SanitaryRouteFactCard[]
  hasBreakdown: boolean
}

export function buildSanitaryRouteFactCards(summary: SanitaryRouteSummary): SanitaryRouteFactCards {
  const routeBreakdownCards = [
    summary.toiletSegments > 0
      ? {
          label: `${summary.toiletDiameterLabel} toilet routes`,
          value: formatRouteCount(summary.toiletSegments, 'route'),
        }
      : null,
    summary.collectionMainSegments > 0
      ? {
          label: `${summary.collectionMainDiameterLabel} main lines`,
          value: formatRouteCount(summary.collectionMainSegments, 'main'),
        }
      : null,
    summary.branchSegments > 0
      ? {
          label: `${summary.branchDiameterLabel} branches`,
          value: formatRouteCount(summary.branchSegments, 'branch', 'branches'),
        }
      : null,
  ].filter((card): card is SanitaryRouteFactCard => card !== null)

  const routeFactCards = [
    summary.routeCount > 0
      ? {
          label: 'Sanitary routes',
          value: formatRouteCount(summary.routeCount, 'route'),
        }
      : null,
    ...routeBreakdownCards,
  ].filter((card): card is SanitaryRouteFactCard => card !== null)

  return {
    routeFactCards,
    routeBreakdownCards,
    hasBreakdown: routeBreakdownCards.length > 0,
  }
}

function formatRouteCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
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
