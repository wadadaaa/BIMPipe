import type { Fixture, FixtureKind, Riser } from '@/domain/types'
import type { DemoConfig } from '@/shared/demoConfig'
import { SLOPE } from './buildRoutes'
import { planDistance } from './planGeometry'

export const DEMO_SANITARY_SLOPE = SLOPE
export const DEMO_SANITARY_SLOPE_PERCENT = DEMO_SANITARY_SLOPE * 100
export const SANITARY_ROUTE_SYSTEM = 'BIMPipe Sanitary Routes'

// Minimum plan-view length (viewer units) for a sanitary route segment. Shorter geometry
// is degenerate and is replaced by an explicit transition fallback before export/preview.
export const MIN_SANITARY_SEGMENT_PLAN_LENGTH = 1e-6

// Demo-room grouping is intentionally conservative: fixtures within this plan distance
// are treated as one sanitary room/service zone and routed to one discharge riser so the
// preview reads as a grouped bathroom layout rather than one tiny route per fixture.
export const SANITARY_ROOM_GROUPING_DISTANCE_PLAN_UNITS = 8
export const COINCIDENT_CONNECTOR_LENGTH_PLAN_UNITS = 0.75

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
  routeGroupId?: string
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
  groupId: string
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
  groupId: string
}

interface ServiceZoneCluster {
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
  const { groups: groupedByServiceZone, fixturesWithoutSameStoreyRiser } = groupFixturesBySanitaryServiceZone(
    located,
    risers,
  )

  const sourceRoutes: SanitaryFixtureRoute[] = []
  const debugGroups: SanitaryRoutingDebugGroup[] = []

  for (const { riser, members, groupId } of groupedByServiceZone) {
    const { routes, debugGroup } = buildRoutesForRiserGroup(riser, members, groupId)
    sourceRoutes.push(...routes)
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
  if (routes.some((route) => route.segments.some((segment) => segment.routeRole === 'fixtureBranch'))) {
    limitations.push('Grouped sanitary preview uses shared collection mains and 45° fixture branches where plan geometry allows.')
  }
  if (routes.length > sourceRoutes.length) {
    limitations.push('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  }

  return { routes, limitations, debug: buildDebug(debugGroups, buildSkippedDebug(unsupportedKinds, fixturesWithoutSameStoreyRiser), limitations) }
}

function buildRoutesForRiserGroup(
  riser: Riser,
  members: Fixture[],
  groupId: string,
): {
  routes: SanitaryFixtureRoute[]
  debugGroup: SanitaryRoutingDebugGroup
} {
  const routes: SanitaryFixtureRoute[] = []
  const decisions: string[] = [`Grouped sanitary service zone ${groupId} routes ${members.length} fixture(s) to riser ${riser.id}.`]
  let segmentCount = 0
  let branchCount = 0

  const toilets = members.filter((fixture) => fixture.kind === 'TOILETPAN')
  const smallFixtures = members.filter((fixture) => fixture.kind !== 'TOILETPAN')

  if (toilets.length > 1) {
    const toiletHeaderFixture = chooseFarthestFixture(toilets, riser)!
    const headerStart =
      planDistance(toiletHeaderFixture.position!, riser.position) < MIN_SANITARY_SEGMENT_PLAN_LENGTH
        ? makeVisibleConnectorStart(toiletHeaderFixture, members, riser)
        : toiletHeaderFixture.position!

    const headerSegment = makeSegment({
      from: headerStart,
      to: riser.position,
      kind: 'main',
      routeRole: 'riserConnection',
      groupId,
      diameterMm: 110,
      fixture: toiletHeaderFixture,
      riser,
      labelIntent: 'BIMPipe Ø110 Riser Connection',
      debugReason: `Grouped WC bank uses one visible Ø110 riser connection from fixture ${toiletHeaderFixture.expressId} toward stack ${riser.id}.`,
    })
    routes.push(makeFixtureRoute(toiletHeaderFixture, riser.id, 110, [headerSegment]))
    segmentCount += 1
    decisions.push(`WC fixture ${toiletHeaderFixture.expressId} selected as farthest WC for the shared Ø110 header/riser connection.`)

    for (const toilet of toilets) {
      if (toilet.expressId === toiletHeaderFixture.expressId) continue

      const join = computeFortyFiveDegreeJoinPoint(toilet.position!, headerStart, riser.position)
      const branchLength = planDistance(toilet.position!, join.point)
      const segment = makeSegment({
        from: branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH
          ? makeVisibleConnectorStart(toilet, members, riser)
          : toilet.position!,
        to: branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH ? riser.position : join.point,
        kind: 'branch',
        routeRole: branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH || join.usedFallback ? 'transition' : 'toiletRoute',
        groupId,
        diameterMm: 110,
        fixture: toilet,
        riser,
        labelIntent: branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH ? 'BIMPipe Ø110 WC transition' : 'BIMPipe Ø110 Toilet',
        debugReason: branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH
          ? 'WC coincides with the grouped header/riser; preview emits a short explicit Ø110 transition so the demo does not silently lose the fixture route.'
          : join.usedFallback
            ? 'WC joins the grouped Ø110 header using a projected transition because a 45° join could not be kept inside the header span.'
            : `WC uses an Ø110 branch that joins the grouped header at an approximate 45° wye before flowing to riser ${riser.id}.`,
      })
      routes.push(makeFixtureRoute(toilet, riser.id, 110, [segment]))
      segmentCount += 1
      branchCount += 1
    }
  } else {
    for (const toilet of toilets) {
      const fixturePos = toilet.position!
      const isCoincident = planDistance(fixturePos, riser.position) < MIN_SANITARY_SEGMENT_PLAN_LENGTH
      const segment = makeSegment({
        from: isCoincident ? makeVisibleConnectorStart(toilet, members, riser) : fixturePos,
        to: riser.position,
        kind: 'main',
        routeRole: isCoincident ? 'transition' : 'toiletRoute',
        groupId,
        diameterMm: 110,
        fixture: toilet,
        riser,
        labelIntent: isCoincident ? 'BIMPipe Ø110 WC transition' : 'BIMPipe Ø110 Toilet',
        debugReason: isCoincident
          ? 'WC point coincides with the riser; preview emits a short explicit Ø110 transition segment instead of dropping the route.'
          : 'WC receives a dedicated Ø110 toilet route to the sanitary stack.',
      })
      routes.push(makeFixtureRoute(toilet, riser.id, 110, [segment]))
      segmentCount += 1
      if (isCoincident) decisions.push(`WC ${toilet.expressId} coincides with riser ${riser.id}; emitted visible Ø110 transition fallback.`)
    }
  }

  const collectionMain = chooseFarthestFixture(smallFixtures, riser)
  if (collectionMain) {
    const mainDistance = planDistance(collectionMain.position!, riser.position)
    if (mainDistance < MIN_SANITARY_SEGMENT_PLAN_LENGTH) {
      const segment = makeSegment({
        from: makeVisibleConnectorStart(collectionMain, members, riser),
        to: riser.position,
        kind: 'branch',
        routeRole: 'transition',
        groupId,
        diameterMm: 50,
        fixture: collectionMain,
        riser,
        labelIntent: 'BIMPipe Branch Ø50 transition',
        debugReason: 'Small fixture point coincides with the riser; preview emits a short explicit Ø50 transition segment instead of dropping the route.',
      })
      routes.push(makeFixtureRoute(collectionMain, riser.id, 50, [segment]))
      segmentCount += 1
      branchCount += 1
      decisions.push(`Small fixture ${collectionMain.expressId} coincides with riser ${riser.id}; emitted visible Ø50 transition fallback.`)
    } else if (smallFixtures.length === 1) {
      const segment = makeSegment({
        from: collectionMain.position!,
        to: riser.position,
        kind: 'branch',
        routeRole: 'fixtureBranch',
        groupId,
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
        groupId,
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
        const isOnCollectionMain = branchLength < MIN_SANITARY_SEGMENT_PLAN_LENGTH
        const segment = makeSegment({
          from: isOnCollectionMain ? makeVisibleConnectorStart(fixture, members, riser) : fixture.position!,
          to: isOnCollectionMain ? fixture.position! : join.point,
          kind: 'branch',
          routeRole: isOnCollectionMain ? 'transition' : routeRole,
          groupId,
          diameterMm: 50,
          fixture,
          riser,
          labelIntent: isOnCollectionMain || routeRole === 'transition' ? 'BIMPipe Branch Ø50 transition' : 'BIMPipe Branch Ø50',
          debugReason: isOnCollectionMain
            ? 'Fixture already lies on the Ø63 collection main; preview emits a short explicit Ø50 transition into the main instead of dropping the branch.'
            : join.usedFallback
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
    debugGroup: {
      groupId,
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

function groupFixturesBySanitaryServiceZone(
  fixtures: Fixture[],
  risers: Riser[],
): { groups: RiserFixtureGroup[]; fixturesWithoutSameStoreyRiser: Fixture[] } {
  const fixturesWithoutSameStoreyRiser: Fixture[] = []
  const clustersByStorey = new Map<number, ServiceZoneCluster[]>()

  for (const fixture of fixtures) {
    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === fixture.storeyId)
    if (sameStoreyRisers.length === 0) {
      fixturesWithoutSameStoreyRiser.push(fixture)
      continue
    }

    const clusters = clustersByStorey.get(fixture.storeyId) ?? []
    const matchingClusterIndexes = clusters
      .map((cluster, index) => ({ cluster, index }))
      .filter(({ cluster }) =>
        cluster.members.some((member) => fixturesBelongToSameSanitaryServiceZone(member, fixture)),
      )
      .map(({ index }) => index)

    if (matchingClusterIndexes.length === 0) {
      clusters.push({ members: [fixture] })
    } else {
      const targetCluster = clusters[matchingClusterIndexes[0]]
      targetCluster.members.push(fixture)
      for (const clusterIndex of matchingClusterIndexes.slice(1).reverse()) {
        targetCluster.members.push(...clusters[clusterIndex].members)
        clusters.splice(clusterIndex, 1)
      }
    }

    clustersByStorey.set(fixture.storeyId, clusters)
  }

  const groups: RiserFixtureGroup[] = []
  for (const [storeyId, clusters] of clustersByStorey) {
    const sortedClusters = [...clusters].sort(
      (left, right) => minFixtureExpressId(left.members) - minFixtureExpressId(right.members),
    )
    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === storeyId)
    sortedClusters.forEach((cluster, index) => {
      groups.push({
        riser: findNearestRiserToServiceZone(cluster.members, sameStoreyRisers),
        members: [...cluster.members].sort((left, right) => left.expressId - right.expressId),
        groupId: `${storeyId}-${index + 1}`,
      })
    })
  }

  return { groups, fixturesWithoutSameStoreyRiser }
}

function fixturesBelongToSameSanitaryServiceZone(left: Fixture, right: Fixture): boolean {
  return planDistance(left.position!, right.position!) <= SANITARY_ROOM_GROUPING_DISTANCE_PLAN_UNITS
}

function findNearestRiserToServiceZone(fixtures: Fixture[], risers: Riser[]): Riser {
  const centroid = fixtureClusterCentroid(fixtures)
  return [...risers].sort((left, right) => {
    const distanceDelta = planDistance(centroid, left.position) - planDistance(centroid, right.position)
    return distanceDelta === 0 ? left.id.localeCompare(right.id) : distanceDelta
  })[0]
}

function minFixtureExpressId(fixtures: Fixture[]): number {
  return Math.min(...fixtures.map((fixture) => fixture.expressId))
}

function fixtureClusterCentroid(fixtures: Fixture[]): { x: number; y: number; z: number } {
  const totals = fixtures.reduce(
    (acc, fixture) => ({
      x: acc.x + fixture.position!.x,
      y: acc.y + fixture.position!.y,
      z: acc.z + fixture.position!.z,
    }),
    { x: 0, y: 0, z: 0 },
  )
  return {
    x: totals.x / fixtures.length,
    y: totals.y / fixtures.length,
    z: totals.z / fixtures.length,
  }
}

function makeVisibleConnectorStart(
  fixture: Fixture,
  groupMembers: Fixture[],
  riser: Riser,
): { x: number; y: number; z: number } {
  const fixturePos = fixture.position!
  const centroid = fixtureClusterCentroid(groupMembers)
  let dx = centroid.x - riser.position.x
  let dz = centroid.z - riser.position.z
  const length = Math.hypot(dx, dz)

  if (length < MIN_SANITARY_SEGMENT_PLAN_LENGTH) {
    dx = 1
    dz = 0
  } else {
    dx /= length
    dz /= length
  }

  return {
    x: fixturePos.x + dx * COINCIDENT_CONNECTOR_LENGTH_PLAN_UNITS,
    y: fixturePos.y,
    z: fixturePos.z + dz * COINCIDENT_CONNECTOR_LENGTH_PLAN_UNITS,
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
  groupId: string
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
    routeGroupId: input.groupId,
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
): string[] {
  return [
    ...Array.from(new Set(unsupportedKinds)).map((kind) => `Unsupported kind skipped: ${kind}.`),
    ...fixturesWithoutSameStoreyRiser.map((fixture) => `Fixture ${fixture.expressId} skipped: no same-storey riser.`),
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
