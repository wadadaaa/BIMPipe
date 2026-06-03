import type { Fixture, FixtureKind, Riser, StoreyId } from '@/domain/types'
import type { DemoConfig } from '@/shared/demoConfig'
import { SLOPE } from './buildRoutes'
import { planDistance } from './planGeometry'

export const DEMO_SANITARY_SLOPE = SLOPE
export const DEMO_SANITARY_SLOPE_PERCENT = DEMO_SANITARY_SLOPE * 100

// Minimum plan-view length (viewer units) for a sanitary route segment. Segments shorter than
// this are degenerate (fixture point coincides with the riser) and would produce a zero-volume
// IFC pipe, so they are dropped rather than emitted.
export const MIN_SANITARY_SEGMENT_PLAN_LENGTH = 1e-6

// ADAM_10 does not currently expose room boundary polygons to this planner. Viewer coordinates are
// model/source coordinates normalized into the floor viewer; for ADAM_10 this threshold is roughly
// room-scale in plan view, not millimetres/metres. A candidate fixture must be within this distance
// of every existing member, keeping the group's maximum pairwise diameter within the same cap. That
// bounded-diameter check prevents greedy single-linkage chains (A-B-C) from merging distant zones.
const SERVICE_ZONE_GROUP_DISTANCE = 18

export type SanitaryPipeDiameterMm = 50 | 63 | 110
export type SanitaryRouteRole = 'toiletRoute' | 'collectionMain' | 'fixtureBranch'

export interface RouteSegment {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  /** Legacy preview/export style: collection/toilet/riser runs are main, small fixture runs are branch. */
  kind: 'main' | 'branch'
  /** Legacy export diameter alias retained until IFC export is fully moved to diameterMm. */
  pipeDiameterMm: SanitaryPipeDiameterMm
  routeRole?: SanitaryRouteRole
  diameterMm?: SanitaryPipeDiameterMm
  slopePercent?: number
  sourceFixtureId?: number
  sourceFixtureType?: FixtureKind
  targetRiserId?: string
  routeGroupId?: string
  label?: string
  debugReason?: string
}

export interface SanitaryFixtureRoute {
  fixtureExpressId: number
  fixtureName: string
  fixtureKind: FixtureKind
  riserId: string
  targetRiserId?: string
  routeGroupId?: string
  pipeDiameterMm: SanitaryPipeDiameterMm
  startHeightAboveFloorM: number
  slope: number
  /** Per-fixture segments. Shared collection mains are owned by the selected main fixture. */
  segments: RouteSegment[]
}

export interface SanitaryRoutingDebugGroup {
  routeGroupId: string
  storeyId: StoreyId
  fixtureIds: number[]
  targetRiserId: string
  targetRiserReason: string
  selectedMainFixtureId?: number
  branchCount: number
  diameters: SanitaryPipeDiameterMm[]
  skippedFixtureIds: number[]
  fallbackReasons: string[]
  selectedMain?: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }
}

export interface SanitaryRoutingPlan {
  routes: SanitaryFixtureRoute[]
  limitations: string[]
  debugGroups: SanitaryRoutingDebugGroup[]
}

// BIM-58 demo scope supports fixture classes that can participate in sanitary bathroom routing.
// URINAL, BIDET, CISTERN, and OTHER are skipped with a limitation until explicitly scoped.
const SUPPORTED_KINDS = new Set<FixtureKind>(['TOILETPAN', 'BATH', 'SINK', 'WASHHANDBASIN'])

interface ServiceZoneGroup {
  routeGroupId: string
  storeyId: StoreyId
  members: Fixture[]
}

interface PlannedRouteDraft {
  fixture: Fixture
  routeGroupId: string
  targetRiser: Riser
  segments: RouteSegment[]
}

interface TargetRiserSelection {
  riser: Riser
  reason: string
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
    return { routes: [], limitations: ['Sanitary routing requires at least one selected riser.'], debugGroups: [] }
  }

  const located = fixtures.filter((fixture) => fixture.position && SUPPORTED_KINDS.has(fixture.kind))
  const fixturesWithoutSameStoreyRiser: Fixture[] = []
  const coincidentFixtures: { expressId: number; riserId: string; routeGroupId: string }[] = []
  const sourceRoutes: SanitaryFixtureRoute[] = []
  const debugGroups: SanitaryRoutingDebugGroup[] = []

  for (const group of buildServiceZoneGroups(located)) {
    const sameStoreyRisers = risers.filter((riser) => riser.storeyId === group.storeyId)
    if (sameStoreyRisers.length === 0) {
      fixturesWithoutSameStoreyRiser.push(...group.members)
      continue
    }

    const targetRiserSelection = selectTargetRiserForGroup(group, sameStoreyRisers)
    const targetRiser = targetRiserSelection.riser
    const drafts = planServiceZoneRoutes(group, targetRiser)
    const skippedFixtureIds: number[] = []
    const fallbackReasons: string[] = []

    for (const draft of drafts) {
      if (draft.segments.length === 0) {
        coincidentFixtures.push({
          expressId: draft.fixture.expressId,
          riserId: targetRiser.id,
          routeGroupId: group.routeGroupId,
        })
        skippedFixtureIds.push(draft.fixture.expressId)
        fallbackReasons.push(`Fixture ${draft.fixture.expressId} coincides with target riser ${targetRiser.id}.`)
        continue
      }

      sourceRoutes.push({
        fixtureExpressId: draft.fixture.expressId,
        fixtureName: draft.fixture.name,
        fixtureKind: draft.fixture.kind,
        riserId: targetRiser.id,
        targetRiserId: targetRiser.id,
        routeGroupId: group.routeGroupId,
        pipeDiameterMm: fixtureDiameterForKind(draft.fixture.kind),
        startHeightAboveFloorM: draft.fixture.kind === 'TOILETPAN' ? 0.2 : 0.15,
        slope: DEMO_SANITARY_SLOPE,
        segments: draft.segments,
      })
    }

    const groupSegments = drafts.flatMap((draft) => draft.segments)
    const selectedMain = groupSegments.find((segment) => segment.routeRole === 'collectionMain')
    const branchCount = group.members.filter((fixture) => fixture.kind !== 'TOILETPAN').length
    if (branchCount === 1 && !selectedMain) {
      fallbackReasons.push('Single small fixture in service zone; Ø63 collection main is not applicable.')
    }

    debugGroups.push({
      routeGroupId: group.routeGroupId,
      storeyId: group.storeyId,
      fixtureIds: group.members.map((fixture) => fixture.expressId),
      targetRiserId: targetRiser.id,
      targetRiserReason: targetRiserSelection.reason,
      selectedMainFixtureId: selectedMain?.sourceFixtureId,
      branchCount,
      diameters: Array.from(
        new Set<SanitaryPipeDiameterMm>(groupSegments.map((segment) => segment.diameterMm ?? segment.pipeDiameterMm)),
      ).sort((a, b) => a - b),
      skippedFixtureIds,
      fallbackReasons,
      selectedMain: selectedMain ? { from: selectedMain.from, to: selectedMain.to } : undefined,
    })
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
  if (routes.length > sourceRoutes.length) {
    limitations.push('Single-floor demo sanitary routes are duplicated across matching riser stack floors for IFC export.')
  }

  return { routes, limitations, debugGroups }
}

function buildServiceZoneGroups(fixtures: Fixture[]): ServiceZoneGroup[] {
  const byStorey = new Map<StoreyId, Fixture[]>()
  for (const fixture of fixtures) {
    const bucket = byStorey.get(fixture.storeyId)
    if (bucket) bucket.push(fixture)
    else byStorey.set(fixture.storeyId, [fixture])
  }

  const groups: ServiceZoneGroup[] = []
  for (const [storeyId, storeyFixtures] of [...byStorey.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...storeyFixtures].sort((a, b) => a.expressId - b.expressId)
    const storeyGroups: Fixture[][] = []

    for (const fixture of sorted) {
      const existing = storeyGroups.find((members) => canAddFixtureToServiceZone(members, fixture))
      if (existing) existing.push(fixture)
      else storeyGroups.push([fixture])
    }

    storeyGroups.forEach((members, index) => {
      groups.push({
        routeGroupId: `storey-${storeyId}-zone-${index + 1}`,
        storeyId,
        members,
      })
    })
  }

  return groups
}

function canAddFixtureToServiceZone(members: Fixture[], fixture: Fixture): boolean {
  return members.every((member) => planDistance(member.position!, fixture.position!) <= SERVICE_ZONE_GROUP_DISTANCE)
}

function selectTargetRiserForGroup(group: ServiceZoneGroup, risers: Riser[]): TargetRiserSelection {
  const toilets = group.members.filter((fixture) => fixture.kind === 'TOILETPAN')
  const usesToiletCentroid = toilets.length > 0
  const anchorFixtures = usesToiletCentroid ? toilets : group.members
  const anchor = centroid(anchorFixtures)
  let nearest = risers[0]
  let min = planDistance(anchor, nearest.position)

  for (let index = 1; index < risers.length; index += 1) {
    const candidate = risers[index]
    const distance = planDistance(anchor, candidate.position)
    if (distance < min || (distance === min && candidate.id.localeCompare(nearest.id) < 0)) {
      min = distance
      nearest = candidate
    }
  }

  const anchorSource = usesToiletCentroid
    ? `toilet centroid from ${toilets.length} toilet fixture${toilets.length === 1 ? '' : 's'}`
    : `all-fixture centroid from ${group.members.length} fixtures`

  return {
    riser: nearest,
    reason: `Selected nearest same-storey riser ${nearest.id} using ${anchorSource}; service zone has ${group.members.length} fixtures and ${toilets.length} toilet fixtures.`,
  }
}

function planServiceZoneRoutes(group: ServiceZoneGroup, targetRiser: Riser): PlannedRouteDraft[] {
  const sortedMembers = [...group.members].sort((a, b) => a.expressId - b.expressId)
  const toilets = sortedMembers.filter((fixture) => fixture.kind === 'TOILETPAN')
  const smallFixtures = sortedMembers.filter((fixture) => fixture.kind !== 'TOILETPAN')
  const drafts = new Map<number, PlannedRouteDraft>()

  for (const fixture of sortedMembers) {
    drafts.set(fixture.expressId, { fixture, routeGroupId: group.routeGroupId, targetRiser, segments: [] })
  }

  for (const toilet of toilets) {
    const segment = makeSegment({
      from: toilet.position!,
      to: targetRiser.position,
      routeRole: 'toiletRoute',
      diameterMm: 110,
      sourceFixture: toilet,
      targetRiser,
      routeGroupId: group.routeGroupId,
      debugReason: 'WC/toilet route uses Ø110 intent to the selected group riser.',
    })
    if (segment) drafts.get(toilet.expressId)?.segments.push(segment)
  }

  if (smallFixtures.length === 1) {
    const fixture = smallFixtures[0]
    const segment = makeSegment({
      from: fixture.position!,
      to: targetRiser.position,
      routeRole: 'fixtureBranch',
      diameterMm: 50,
      sourceFixture: fixture,
      targetRiser,
      routeGroupId: group.routeGroupId,
      debugReason: 'Single small fixture in service zone; routed as Ø50 branch to selected riser.',
    })
    if (segment) drafts.get(fixture.expressId)?.segments.push(segment)
    return [...drafts.values()]
  }

  if (smallFixtures.length > 1) {
    const mainFixture = farthestFixtureFromRiser(smallFixtures, targetRiser)
    const mainSegment = makeSegment({
      from: mainFixture.position!,
      to: targetRiser.position,
      routeRole: 'collectionMain',
      diameterMm: 63,
      sourceFixture: mainFixture,
      targetRiser,
      routeGroupId: group.routeGroupId,
      debugReason: 'Farthest small fixture defines the shared Ø63 collection main toward the selected riser.',
    })
    if (mainSegment) drafts.get(mainFixture.expressId)?.segments.push(mainSegment)

    if (mainSegment) {
      for (const fixture of smallFixtures) {
        if (fixture.expressId === mainFixture.expressId) continue
        const join = projectPointOntoSegment(fixture.position!, mainSegment.from, mainSegment.to)
        const branchSegment = makeSegment({
          from: fixture.position!,
          to: join,
          routeRole: 'fixtureBranch',
          diameterMm: 50,
          sourceFixture: fixture,
          targetRiser,
          routeGroupId: group.routeGroupId,
          debugReason: 'Small fixture joins the shared collection main with Ø50 branch intent.',
        })
        if (branchSegment) drafts.get(fixture.expressId)?.segments.push(branchSegment)
      }
    }
  }

  return [...drafts.values()]
}

function makeSegment({
  from,
  to,
  routeRole,
  diameterMm,
  sourceFixture,
  targetRiser,
  routeGroupId,
  debugReason,
}: {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  routeRole: SanitaryRouteRole
  diameterMm: SanitaryPipeDiameterMm
  sourceFixture: Fixture
  targetRiser: Riser
  routeGroupId: string
  debugReason: string
}): RouteSegment | null {
  if (planDistance(from, to) < MIN_SANITARY_SEGMENT_PLAN_LENGTH) return null

  return {
    from,
    to,
    kind: routeRole === 'fixtureBranch' ? 'branch' : 'main',
    pipeDiameterMm: diameterMm,
    routeRole,
    diameterMm,
    slopePercent: DEMO_SANITARY_SLOPE_PERCENT,
    sourceFixtureId: sourceFixture.expressId,
    sourceFixtureType: sourceFixture.kind,
    targetRiserId: targetRiser.id,
    routeGroupId,
    label: buildSegmentLabel(routeRole, diameterMm),
    debugReason,
  }
}

function buildSegmentLabel(routeRole: SanitaryRouteRole, diameterMm: SanitaryPipeDiameterMm): string {
  return `Ø${diameterMm} ${roleLabel(routeRole)} ${DEMO_SANITARY_SLOPE_PERCENT.toFixed(1)}%`
}

function roleLabel(routeRole: SanitaryRouteRole): string {
  switch (routeRole) {
    case 'toiletRoute':
      return 'toilet'
    case 'collectionMain':
      return 'main'
    case 'fixtureBranch':
      return 'branch'
  }
}

function centroid(fixtures: Fixture[]): { x: number; y: number; z: number } {
  if (fixtures.length === 0) throw new Error('centroid: empty fixture list')

  const total = fixtures.reduce(
    (acc, fixture) => ({
      x: acc.x + fixture.position!.x,
      y: acc.y + fixture.position!.y,
      z: acc.z + fixture.position!.z,
    }),
    { x: 0, y: 0, z: 0 },
  )
  return {
    x: total.x / fixtures.length,
    y: total.y / fixtures.length,
    z: total.z / fixtures.length,
  }
}

function farthestFixtureFromRiser(fixtures: Fixture[], riser: Riser): Fixture {
  return [...fixtures].sort((a, b) => {
    const distanceDelta = planDistance(b.position!, riser.position) - planDistance(a.position!, riser.position)
    return distanceDelta === 0 ? a.expressId - b.expressId : distanceDelta
  })[0]
}

function projectPointOntoSegment(
  point: { x: number; y: number; z: number },
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const vx = end.x - start.x
  const vz = end.z - start.z
  const wx = point.x - start.x
  const wz = point.z - start.z
  const lenSq = vx * vx + vz * vz
  if (lenSq < MIN_SANITARY_SEGMENT_PLAN_LENGTH) return end
  const rawT = (wx * vx + wz * vz) / lenSq
  // Keep branch joins away from the collection-main endpoints so labels/segments stay visible and
  // small fixture branches do not visually collapse into the riser or farthest fixture marker.
  const t = Math.min(0.85, Math.max(0.15, rawT))
  return {
    x: start.x + vx * t,
    y: point.y,
    z: start.z + vz * t,
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

  const routeGroupId = route.routeGroupId ? `${route.routeGroupId}-riser-${targetRiser.id}` : undefined

  return {
    ...route,
    riserId: targetRiser.id,
    targetRiserId: targetRiser.id,
    routeGroupId,
    segments: route.segments.map((segment) => ({
      ...segment,
      from: translatePoint(segment.from, delta),
      to: translatePoint(segment.to, delta),
      targetRiserId: targetRiser.id,
      routeGroupId,
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
    route.routeGroupId,
    ...route.segments.map(
      (segment) => `${segment.routeRole}:${segment.diameterMm}:${pointKey(segment.from)}->${pointKey(segment.to)}`,
    ),
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
