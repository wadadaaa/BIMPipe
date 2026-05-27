import type { Fixture, FixtureKind, Riser } from '@/domain/types'
import type { DemoConfig } from '@/shared/demoConfig'
import { SLOPE } from './buildRoutes'
import { planDistance } from './planGeometry'

export const DEMO_SANITARY_SLOPE = SLOPE

export type SanitaryPipeDiameterMm = 50 | 63 | 110

export interface RouteSegment {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  kind: 'main' | 'branch'
  pipeDiameterMm: SanitaryPipeDiameterMm
}

export interface SanitaryFixtureRoute {
  fixtureExpressId: number
  fixtureName: string
  fixtureKind: FixtureKind
  riserId: string
  pipeDiameterMm: SanitaryPipeDiameterMm
  startHeightAboveFloorM: number
  slope: number
  /** Per-fixture segments only; shared main runs are owned by the farthest fixture per riser group. */
  segments: RouteSegment[]
}

export interface SanitaryRoutingPlan {
  routes: SanitaryFixtureRoute[]
  limitations: string[]
}

// BIM-48 demo scope intentionally supports only the fixture classes from the plumbing PRD.
// URINAL, BIDET, CISTERN, and OTHER are skipped with a limitation until explicitly scoped.
const SUPPORTED_KINDS = new Set<FixtureKind>(['TOILETPAN', 'BATH', 'SINK', 'WASHHANDBASIN'])

interface RiserFixtureGroup {
  riser: Riser
  members: Fixture[]
}

export function buildSanitaryRoutingDemoPlan(
  fixtures: Fixture[],
  risers: Riser[],
  config: DemoConfig,
): SanitaryRoutingPlan {
  if (config.routing.mode !== 'demo') {
    throw new Error('buildSanitaryRoutingDemoPlan requires demo routing mode.')
  }

  if (risers.length === 0) {
    return { routes: [], limitations: ['Sanitary routing requires at least one selected riser.'] }
  }

  const located = fixtures.filter((fixture) => fixture.position && SUPPORTED_KINDS.has(fixture.kind))
  const fixturesWithoutSameStoreyRiser: Fixture[] = []
  const groupedByRiser = new Map<string, RiserFixtureGroup>()

  for (const fixture of located) {
    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === fixture.storeyId)
    if (sameStoreyRisers.length === 0) {
      fixturesWithoutSameStoreyRiser.push(fixture)
      continue
    }

    const nearest = findNearestRiser(fixture, sameStoreyRisers)
    const bucket = groupedByRiser.get(nearest.id)
    if (bucket) bucket.members.push(fixture)
    else groupedByRiser.set(nearest.id, { riser: nearest, members: [fixture] })
  }

  const sourceRoutes: SanitaryFixtureRoute[] = []

  for (const { riser, members } of groupedByRiser.values()) {
    const farthest = [...members].sort((a, b) => {
      const aPos = a.position!
      const bPos = b.position!
      return planDistance(bPos, riser.position) - planDistance(aPos, riser.position)
    })[0]

    const hasBranches = members.length > 1

    for (const fixture of members) {
      const fixturePos = fixture.position!
      const onMainLine = fixture.expressId === farthest.expressId
      const branchJunction = approximateBranchJunction(fixturePos, riser.position)
      const fixtureDiameter = fixtureDiameterForKind(fixture.kind)
      const mainDiameter = mainLineDiameterForKind(fixture.kind, hasBranches)

      const segments: RouteSegment[] = []
      if (!onMainLine) {
        segments.push({
          from: fixturePos,
          to: branchJunction,
          kind: 'branch',
          pipeDiameterMm: fixtureDiameter,
        })
      } else {
        segments.push({
          from: fixturePos,
          to: riser.position,
          kind: 'main',
          pipeDiameterMm: mainDiameter,
        })
      }

      sourceRoutes.push({
        fixtureExpressId: fixture.expressId,
        fixtureName: fixture.name,
        fixtureKind: fixture.kind,
        riserId: riser.id,
        pipeDiameterMm: fixtureDiameter,
        startHeightAboveFloorM: fixture.kind === 'TOILETPAN' ? 0.2 : 0.15,
        slope: DEMO_SANITARY_SLOPE,
        segments,
      })
    }
  }

  const routes = shouldDuplicateSingleFloorRoutesAcrossRiserStacks(located, risers)
    ? duplicateRoutesAcrossRiserStacks(sourceRoutes, risers)
    : sourceRoutes

  const unsupportedKinds = fixtures
    .filter((fixture) => fixture.position && !SUPPORTED_KINDS.has(fixture.kind))
    .map((fixture) => fixture.kind)

  const limitations: string[] = []
  if (unsupportedKinds.length > 0) {
    limitations.push(`Unsupported fixture kinds skipped: ${Array.from(new Set(unsupportedKinds)).join(', ')}.`)
  }
  if (fixturesWithoutSameStoreyRiser.length > 0) {
    limitations.push(
      `Fixtures skipped because no same-storey riser is available: ${fixturesWithoutSameStoreyRiser
        .map((fixture) => fixture.expressId)
        .join(', ')}.`,
    )
  }
  if (routes.some((route) => route.segments.some((segment) => segment.kind === 'branch'))) {
    limitations.push('45° branches are approximated by a single branch segment in plan view for the demo.')
  }
  if (routes.length > sourceRoutes.length) {
    limitations.push('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  }

  return { routes, limitations }
}

function shouldDuplicateSingleFloorRoutesAcrossRiserStacks(fixtures: Fixture[], risers: Riser[]): boolean {
  const fixtureStoreyIds = new Set(fixtures.map((fixture) => fixture.storeyId))
  const riserStoreyIds = new Set(risers.map((riser) => riser.storeyId))
  return fixtureStoreyIds.size === 1 && riserStoreyIds.size > 1
}

function duplicateRoutesAcrossRiserStacks(
  routes: SanitaryFixtureRoute[],
  risers: Riser[],
): SanitaryFixtureRoute[] {
  if (routes.length === 0) return routes

  const riserById = new Map(risers.map((riser) => [riser.id, riser]))
  const risersByStackId = new Map<string, Riser[]>()
  for (const riser of risers) {
    const bucket = risersByStackId.get(riser.stackId)
    if (bucket) bucket.push(riser)
    else risersByStackId.set(riser.stackId, [riser])
  }

  const duplicated = [...routes]
  const routeKeys = new Set(duplicated.map(routeKey))

  for (const route of routes) {
    const sourceRiser = riserById.get(route.riserId)
    if (!sourceRiser) continue

    const stackRisers = risersByStackId.get(sourceRiser.stackId) ?? []
    for (const targetRiser of stackRisers) {
      if (targetRiser.id === sourceRiser.id) continue

      const translated = translateRouteToRiser(route, sourceRiser, targetRiser)
      const key = routeKey(translated)
      if (routeKeys.has(key)) continue

      routeKeys.add(key)
      duplicated.push(translated)
    }
  }

  return duplicated
}

function translateRouteToRiser(
  route: SanitaryFixtureRoute,
  sourceRiser: Riser,
  targetRiser: Riser,
): SanitaryFixtureRoute {
  const delta = {
    x: targetRiser.position.x - sourceRiser.position.x,
    y: targetRiser.position.y - sourceRiser.position.y,
    z: targetRiser.position.z - sourceRiser.position.z,
  }

  return {
    ...route,
    riserId: targetRiser.id,
    segments: route.segments.map((segment) => ({
      ...segment,
      from: translatePoint(segment.from, delta),
      to: translatePoint(segment.to, delta),
    })),
  }
}

function translatePoint(
  point: { x: number; y: number; z: number },
  delta: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
    z: point.z + delta.z,
  }
}

function routeKey(route: SanitaryFixtureRoute): string {
  return [
    route.fixtureExpressId,
    route.fixtureKind,
    route.riserId,
    ...route.segments.map((segment) => `${segment.kind}:${segment.pipeDiameterMm}:${pointKey(segment.from)}->${pointKey(segment.to)}`),
  ].join('|')
}

function pointKey(point: { x: number; y: number; z: number }): string {
  return `${roundKey(point.x)},${roundKey(point.y)},${roundKey(point.z)}`
}

function roundKey(value: number): number {
  return Math.round(value * 1000)
}

function fixtureDiameterForKind(kind: FixtureKind): SanitaryPipeDiameterMm {
  return kind === 'TOILETPAN' ? 110 : 50
}

function mainLineDiameterForKind(kind: FixtureKind, hasBranches: boolean): SanitaryPipeDiameterMm {
  if (kind === 'TOILETPAN') return 110
  return hasBranches ? 63 : 50
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

function approximateBranchJunction(
  fixture: { x: number; y: number; z: number },
  riser: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: (fixture.x + riser.x) / 2,
    y: fixture.y,
    z: (fixture.z + riser.z) / 2,
  }
}
