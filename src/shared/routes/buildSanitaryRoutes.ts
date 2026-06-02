import type { Fixture, FixtureKind, Riser } from '@/domain/types'
import type { DemoConfig } from '@/shared/demoConfig'
import { SLOPE } from './buildRoutes'
import { planDistance } from './planGeometry'

export const DEMO_SANITARY_SLOPE = SLOPE
export const DEMO_SANITARY_SLOPE_PERCENT = DEMO_SANITARY_SLOPE * 100
export const SANITARY_ROUTE_SYSTEM = 'BIMPipe Sanitary Routes'

// Minimum plan-view length (viewer units) for a sanitary route segment. Segments shorter than
// this are degenerate (fixture point coincides with the riser or main line) and would produce a
// zero-volume IFC pipe, so they are dropped rather than emitted.
export const MIN_SANITARY_SEGMENT_PLAN_LENGTH = 1e-6

export type SanitaryPipeDiameterMm = 50 | 63 | 110
export type SanitaryRouteRole =
  | 'riserConnection'
  | 'toiletRoute'
  | 'collectionMain'
  | 'fixtureBranch'
  | 'transition'

export interface RouteSegment {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  /** Legacy viewer/export grouping. Prefer routeRole for semantic route classification. */
  kind: 'main' | 'branch'
  routeRole?: SanitaryRouteRole
  system?: typeof SANITARY_ROUTE_SYSTEM
  pipeDiameterMm: SanitaryPipeDiameterMm
  diameterMm?: SanitaryPipeDiameterMm
  slopePercent?: number
  targetRiserId?: string
  sourceFixtureId?: number
  sourceFixtureType?: FixtureKind
  labelIntent?: string
  debugReason?: string
}

export interface SanitaryFixtureRoute {
  fixtureExpressId: number
  fixtureName: string
  fixtureKind: FixtureKind
  riserId: string
  pipeDiameterMm: SanitaryPipeDiameterMm
  startHeightAboveFloorM: number
  slope: number
  /** Per-fixture segments; shared collection mains are owned by the farthest small fixture per riser group. */
  segments: RouteSegment[]
}

export interface SanitaryRoutingDebugGroup {
  riserId: string
  fixtureIds: number[]
  toiletFixtureIds: number[]
  smallFixtureIds: number[]
  collectionMainFixtureId: number | null
  collectionMainDiameterMm: SanitaryPipeDiameterMm | null
  branchCount: number
  segmentCount: number
  decisions: string[]
}

export interface SanitaryRoutingDebug {
  system: typeof SANITARY_ROUTE_SYSTEM
  slopePercent: number
  groups: SanitaryRoutingDebugGroup[]
  skipped: string[]
  limitations: string[]
}

export interface SanitaryRoutingPlan {
  routes: SanitaryFixtureRoute[]
  limitations: string[]
  debug: SanitaryRoutingDebug
}

// Demo scope supports the sanitary fixture classes that can produce drainage routes. Urinals,
// bidets, cisterns, and OTHER remain skipped with an explicit limitation until scoped.
const SUPPORTED_KINDS = new Set<FixtureKind>([
  'TOILETPAN',
  'BATH',
  'SINK',
  'WASHHANDBASIN',
  'SHOWER',
  'FLOORDRAIN',
  'FLOORTRAP',
])

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
    const limitations = ['Sanitary routing requires at least one selected riser.']
    return { routes: [], limitations, debug: buildDebug([], [], limitations) }
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
  const coincidentFixtures: { expressId: number; riserId: string }[] = []
  const debugGroups: SanitaryRoutingDebugGroup[] = []

  for (const { riser, members } of groupedByRiser.values()) {
    const { routes, coincident, debugGroup } = buildRoutesForRiserGroup(riser, members)
    sourceRoutes.push(...routes)
    coincidentFixtures.push(...coincident)
    debugGroups.push(debugGroup)
  }

  const routes = shouldDuplicateSingleFloorRoutesAcrossRiserStacks(fixtures, risers)
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
  for (const { expressId, riserId } of coincidentFixtures) {
    limitations.push(
      `Sanitary route skipped for fixture ${expressId} because fixture point coincides with riser ${riserId}.`,
    )
  }
  if (routes.some((route) => route.segments.some((segment) => segment.routeRole === 'fixtureBranch'))) {
    limitations.push('Grouped sanitary preview uses shared collection mains and 45° fixture branches where plan geometry allows.')
  }
  if (routes.length > sourceRoutes.length) {
    limitations.push('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  }

  return { routes, limitations, debug: buildDebug(debugGroups, buildSkippedDebug(unsupportedKinds, fixturesWithoutSameStoreyRiser, coincidentFixtures), limitations) }
}

function buildRoutesForRiserGroup(
  riser: Riser,
  members: Fixture[],
): {
  routes: SanitaryFixtureRoute[]
  coincident: { expressId: number; riserId: string }[]
  debugGroup: SanitaryRoutingDebugGroup
} {
  const routes: SanitaryFixtureRoute[] = []
  const coincident: { expressId: number; riserId: string }[] = []
  const decisions: string[] = []
  let segmentCount = 0
  let branchCount = 0

  const toilets = members.filter((fixture) => fixture.kind === 'TOILETPAN')
  const smallFixtures = members.filter((fixture) => fixture.kind !== 'TOILETPAN')

  for (const toilet of toilets) {
    const fixturePos = toilet.position!
    if (planDistance(fixturePos, riser.position) < MIN_SANITARY_SEGMENT_PLAN_LENGTH) {
      coincident.push({ expressId: toilet.expressId, riserId: riser.id })
      decisions.push(`Skipped WC ${toilet.expressId}: coincides with riser ${riser.id}.`)
      continue
    }

    const segment = makeSegment({
      from: fixturePos,
      to: riser.position,
      kind: 'main',
      routeRole: 'toiletRoute',
      diameterMm: 110,
      fixture: toilet,
      riser,
      labelIntent: 'BIMPipe Ø110 Toilet',
      debugReason: 'WC receives a dedicated Ø110 toilet route to the sanitary stack.',
    })
    routes.push(makeFixtureRoute(toilet, riser.id, 110, [segment]))
    segmentCount += 1
  }

  const collectionMain = chooseFarthestFixture(smallFixtures, riser)
  if (collectionMain) {
    const mainDistance = planDistance(collectionMain.position!, riser.position)
    if (mainDistance < MIN_SANITARY_SEGMENT_PLAN_LENGTH) {
      coincident.push({ expressId: collectionMain.expressId, riserId: riser.id })
      decisions.push(`Skipped collection main fixture ${collectionMain.expressId}: coincides with riser ${riser.id}.`)
    } else if (smallFixtures.length === 1) {
      const segment = makeSegment({
        from: collectionMain.position!,
        to: riser.position,
        kind: 'branch',
        routeRole: 'fixtureBranch',
        diameterMm: 50,
        fixture: collectionMain,
        riser,
        labelIntent: 'BIMPipe Branch Ø50',
        debugReason: 'Single small fixture receives a simple Ø50 branch because no shared main is needed.',
      })
      routes.push(makeFixtureRoute(collectionMain, riser.id, 50, [segment]))
      segmentCount += 1
      branchCount += 1
      decisions.push(`Small fixture ${collectionMain.expressId} routed as a single Ø50 branch; no grouped main needed.`)
    } else {
      const mainSegment = makeSegment({
        from: collectionMain.position!,
        to: riser.position,
        kind: 'main',
        routeRole: 'collectionMain',
        diameterMm: 63,
        fixture: collectionMain,
        riser,
        labelIntent: 'BIMPipe Main Ø63',
        debugReason: `Farthest small fixture ${collectionMain.expressId} seeds the shared Ø63 collection main.`,
      })
      routes.push(makeFixtureRoute(collectionMain, riser.id, 50, [mainSegment]))
      segmentCount += 1
      decisions.push(`Fixture ${collectionMain.expressId} selected as farthest small fixture for Ø63 collection main.`)

      for (const fixture of smallFixtures) {
        if (fixture.expressId === collectionMain.expressId) continue

        const join = computeFortyFiveDegreeJoinPoint(fixture.position!, collectionMain.position!, riser.position)
        const branchLength = planDistance(fixture.position!, join.point)
        const routeRole: SanitaryRouteRole = join.usedFallback ? 'transition' : 'fixtureBranch'
        if (branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH) {
          const reason = `Skipped Ø50 branch for fixture ${fixture.expressId}: fixture already lies on the collection main.`
          decisions.push(reason)
          continue
        }

        const segment = makeSegment({
          from: fixture.position!,
          to: join.point,
          kind: 'branch',
          routeRole,
          diameterMm: 50,
          fixture,
          riser,
          labelIntent: routeRole === 'transition' ? 'BIMPipe Branch Ø50 transition' : 'BIMPipe Branch Ø50',
          debugReason: join.usedFallback
            ? `Fallback branch joins the collection main by projection because a 45° join could not be kept inside the main span.`
            : `Ø50 branch joins the Ø63 main at an approximate 45° wye before flowing to riser ${riser.id}.`,
        })
        routes.push(makeFixtureRoute(fixture, riser.id, 50, [segment]))
        segmentCount += 1
        branchCount += 1
      }
    }
  }

  return {
    routes,
    coincident,
    debugGroup: {
      riserId: riser.id,
      fixtureIds: members.map((fixture) => fixture.expressId),
      toiletFixtureIds: toilets.map((fixture) => fixture.expressId),
      smallFixtureIds: smallFixtures.map((fixture) => fixture.expressId),
      collectionMainFixtureId: smallFixtures.length > 1 ? collectionMain?.expressId ?? null : null,
      collectionMainDiameterMm: smallFixtures.length > 1 && collectionMain ? 63 : null,
      branchCount,
      segmentCount,
      decisions,
    },
  }
}

function makeFixtureRoute(
  fixture: Fixture,
  riserId: string,
  fixtureDiameterMm: SanitaryPipeDiameterMm,
  segments: RouteSegment[],
): SanitaryFixtureRoute {
  return {
    fixtureExpressId: fixture.expressId,
    fixtureName: fixture.name,
    fixtureKind: fixture.kind,
    riserId,
    pipeDiameterMm: fixtureDiameterMm,
    startHeightAboveFloorM: fixture.kind === 'TOILETPAN' ? 0.2 : 0.15,
    slope: DEMO_SANITARY_SLOPE,
    segments,
  }
}

function makeSegment(input: {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  kind: 'main' | 'branch'
  routeRole: SanitaryRouteRole
  diameterMm: SanitaryPipeDiameterMm
  fixture: Fixture
  riser: Riser
  labelIntent: string
  debugReason: string
}): RouteSegment {
  return {
    from: input.from,
    to: input.to,
    kind: input.kind,
    routeRole: input.routeRole,
    system: SANITARY_ROUTE_SYSTEM,
    pipeDiameterMm: input.diameterMm,
    diameterMm: input.diameterMm,
    slopePercent: DEMO_SANITARY_SLOPE_PERCENT,
    sourceFixtureId: input.fixture.expressId,
    sourceFixtureType: input.fixture.kind,
    targetRiserId: input.riser.id,
    labelIntent: input.labelIntent,
    debugReason: input.debugReason,
  }
}

function chooseFarthestFixture(fixtures: Fixture[], riser: Riser): Fixture | null {
  if (fixtures.length === 0) return null
  return [...fixtures].sort((a, b) => {
    const distanceDelta = planDistance(b.position!, riser.position) - planDistance(a.position!, riser.position)
    return distanceDelta === 0 ? a.expressId - b.expressId : distanceDelta
  })[0]
}

function computeFortyFiveDegreeJoinPoint(
  fixture: { x: number; y: number; z: number },
  mainStart: { x: number; y: number; z: number },
  riser: { x: number; y: number; z: number },
): { point: { x: number; y: number; z: number }; usedFallback: boolean } {
  const dx = riser.x - mainStart.x
  const dz = riser.z - mainStart.z
  const mainLength = Math.hypot(dx, dz)
  if (mainLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH) return { point: riser, usedFallback: true }

  const ux = dx / mainLength
  const uz = dz / mainLength
  const fx = fixture.x - mainStart.x
  const fz = fixture.z - mainStart.z
  const projected = fx * ux + fz * uz
  const perpX = fx - projected * ux
  const perpZ = fz - projected * uz
  const perpendicularDistance = Math.hypot(perpX, perpZ)
  const idealJoinDistance = projected + perpendicularDistance
  const minJoinDistance = Math.min(mainLength, Math.max(MIN_SANITARY_SEGMENT_PLAN_LENGTH, projected))
  const maxJoinDistance = Math.max(MIN_SANITARY_SEGMENT_PLAN_LENGTH, mainLength - MIN_SANITARY_SEGMENT_PLAN_LENGTH)
  const clampedJoinDistance = Math.min(Math.max(idealJoinDistance, minJoinDistance), maxJoinDistance)
  const usedFallback = Math.abs(clampedJoinDistance - idealJoinDistance) > 1e-6 || perpendicularDistance < MIN_SANITARY_SEGMENT_PLAN_LENGTH

  return {
    point: {
      x: mainStart.x + ux * clampedJoinDistance,
      y: fixture.y,
      z: mainStart.z + uz * clampedJoinDistance,
    },
    usedFallback,
  }
}

function buildSkippedDebug(
  unsupportedKinds: FixtureKind[],
  fixturesWithoutSameStoreyRiser: Fixture[],
  coincidentFixtures: { expressId: number; riserId: string }[],
): string[] {
  return [
    ...Array.from(new Set(unsupportedKinds)).map((kind) => `Unsupported kind skipped: ${kind}.`),
    ...fixturesWithoutSameStoreyRiser.map((fixture) => `Fixture ${fixture.expressId} skipped: no same-storey riser.`),
    ...coincidentFixtures.map(({ expressId, riserId }) => `Fixture ${expressId} skipped: coincides with riser ${riserId}.`),
  ]
}

function buildDebug(
  groups: SanitaryRoutingDebugGroup[],
  skipped: string[],
  limitations: string[],
): SanitaryRoutingDebug {
  return {
    system: SANITARY_ROUTE_SYSTEM,
    slopePercent: DEMO_SANITARY_SLOPE_PERCENT,
    groups,
    skipped,
    limitations,
  }
}

// Intentionally inspects ALL positioned fixtures (not just SUPPORTED_KINDS): an unsupported
// fixture on another storey is still evidence that the model already has multi-floor fixture
// data, so single-floor demo duplication must be suppressed.
function shouldDuplicateSingleFloorRoutesAcrossRiserStacks(fixtures: Fixture[], risers: Riser[]): boolean {
  const positionedFixtures = fixtures.filter((fixture) => fixture.position)
  const fixtureStoreyIds = new Set(positionedFixtures.map((fixture) => fixture.storeyId))
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
      targetRiserId: targetRiser.id,
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
    ...route.segments.map((segment) => `${segment.routeRole ?? segment.kind}:${segment.pipeDiameterMm}:${pointKey(segment.from)}->${pointKey(segment.to)}`),
  ].join('|')
}

function pointKey(point: { x: number; y: number; z: number }): string {
  return `${roundKey(point.x)},${roundKey(point.y)},${roundKey(point.z)}`
}

function roundKey(value: number): number {
  return Math.round(value * 1000)
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
