import type { Fixture, FixtureKind, Riser } from '@/domain/types'
import type { DemoConfig } from '@/shared/demoConfig'
import { planDistance } from './planGeometry'

export const DEMO_SANITARY_SLOPE = 0.02

export interface RouteSegment {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  kind: 'main' | 'branch'
}

export interface SanitaryFixtureRoute {
  fixtureExpressId: number
  fixtureName: string
  fixtureKind: FixtureKind
  riserId: string
  pipeDiameterMm: 50 | 110
  startHeightAboveFloorM: number
  slope: number
  segments: RouteSegment[]
}

export interface SanitaryRoutingPlan {
  routes: SanitaryFixtureRoute[]
  limitations: string[]
}

const SUPPORTED_KINDS = new Set<FixtureKind>(['TOILETPAN', 'BATH', 'SINK', 'WASHHANDBASIN'])

export function buildSanitaryRoutingDemoPlan(
  fixtures: Fixture[],
  risers: Riser[],
  config: DemoConfig,
): SanitaryRoutingPlan {
  if (config.routing.mode !== 'demo') {
    return { routes: [], limitations: ['Demo sanitary routing is disabled for non-demo mode.'] }
  }

  if (risers.length === 0) {
    return { routes: [], limitations: ['Sanitary routing requires at least one selected riser.'] }
  }

  const located = fixtures.filter((fixture) => fixture.position && SUPPORTED_KINDS.has(fixture.kind))
  const groupedByRiser = new Map<string, Fixture[]>()

  for (const fixture of located) {
    const nearest = findNearestRiser(fixture, risers)
    const bucket = groupedByRiser.get(nearest.id)
    if (bucket) bucket.push(fixture)
    else groupedByRiser.set(nearest.id, [fixture])
  }

  const routes: SanitaryFixtureRoute[] = []

  for (const [riserId, members] of groupedByRiser.entries()) {
    const riser = risers.find((item) => item.id === riserId)
    if (!riser) continue

    const farthest = [...members].sort((a, b) => {
      const aPos = a.position!
      const bPos = b.position!
      return planDistance(bPos, riser.position) - planDistance(aPos, riser.position)
    })[0]

    for (const fixture of members) {
      const fixturePos = fixture.position!
      const onMainLine = fixture.expressId === farthest.expressId
      const mainConnection = buildMainConnectionPoint(fixturePos, riser.position)

      const segments: RouteSegment[] = []
      if (!onMainLine) {
        segments.push({ from: fixturePos, to: mainConnection, kind: 'branch' })
      }
      segments.push({ from: onMainLine ? fixturePos : mainConnection, to: riser.position, kind: 'main' })

      routes.push({
        fixtureExpressId: fixture.expressId,
        fixtureName: fixture.name,
        fixtureKind: fixture.kind,
        riserId,
        pipeDiameterMm: fixture.kind === 'TOILETPAN' ? 110 : 50,
        startHeightAboveFloorM: fixture.kind === 'TOILETPAN' ? 0.2 : 0.15,
        slope: DEMO_SANITARY_SLOPE,
        segments,
      })
    }
  }

  const unsupportedKinds = fixtures
    .filter((fixture) => fixture.position && !SUPPORTED_KINDS.has(fixture.kind))
    .map((fixture) => fixture.kind)

  const limitations: string[] = []
  if (unsupportedKinds.length > 0) {
    limitations.push(`Unsupported fixture kinds skipped: ${Array.from(new Set(unsupportedKinds)).join(', ')}.`)
  }
  limitations.push('45° branches are approximated by a single branch segment in plan view for the demo.')

  return { routes, limitations }
}

function findNearestRiser(fixture: Fixture, risers: Riser[]): Riser {
  const fixturePos = fixture.position!
  let nearest = risers[0]
  let min = planDistance(fixturePos, nearest.position)

  for (let index = 1; index < risers.length; index += 1) {
    const candidate = risers[index]
    const distance = planDistance(fixturePos, candidate.position)
    if (distance < min) {
      min = distance
      nearest = candidate
    }
  }

  return nearest
}

function buildMainConnectionPoint(
  fixture: { x: number; y: number; z: number },
  riser: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (fixture.x + riser.x) / 2,
    y: fixture.y,
    z: (fixture.z + riser.z) / 2,
  }
}
