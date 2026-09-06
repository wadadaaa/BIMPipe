import type { FixtureKind, RiserId, StoreyId } from '@/domain/types'
import {
  BRANCH_SLOPE_RATIO,
  DEFAULT_BRANCH_SLOPE_DROP_MM,
  DEFAULT_BRANCH_SLOPE_RUN_MM,
  resolveBranchSegmentDiameterMm,
} from './branchDefaults'

// The slope constants live in the shared defaults table (`branchDefaults.ts`);
// re-exported here so existing importers keep working.
export { DEFAULT_BRANCH_SLOPE_DROP_MM, DEFAULT_BRANCH_SLOPE_RUN_MM }

/**
 * Units the plan coordinates are expressed in. Plan geometry lives on the
 * X/Z plane (Y is vertical), matching the viewer and riser conventions.
 */
export type PlanUnits = 'mm' | 'm'

export type RouteSegmentId = string

/**
 * 'fixture-branch': carries flow from exactly one fixture.
 * 'trunk': merged run carrying flow from two or more fixtures toward the riser.
 */
export type RouteSegmentKind = 'fixture-branch' | 'trunk'

/**
 * Office row-collector role of a segment (G3). Absent on every segment of the
 * residential/plain routing so that output stays byte-identical:
 * - 'row-stub': short perpendicular run from one row fixture to the collector line.
 * - 'row-collector': run along the collector line, parallel to the fixture row.
 * - 'collector-run': the single L-run from the collector end to the riser
 *   (may also carry non-row fixtures that share the corridor).
 */
export type RouteSegmentRole = 'row-stub' | 'row-collector' | 'collector-run'

/**
 * One end of an axis-aligned horizontal route segment.
 * All values are in the plan units recorded on the owning FloorRoutes.
 */
export interface RouteSegmentEndpoint {
  /** Plan X coordinate. */
  x: number
  /** Plan Z coordinate. */
  z: number
  /**
   * Sloped pipe level at this endpoint, relative to the branch connection
   * point at the riser on this storey (riser end = 0; upstream ends are
   * positive, i.e. higher). Same units as the plan coordinates.
   */
  elevation: number
}

/**
 * A single axis-aligned horizontal run at slab level. Flow direction is
 * start -> end, i.e. `start` is upstream (higher) and `end` is downstream
 * (lower, toward the riser).
 */
export interface RouteSegment {
  /** Stable ID: `branch-seg|${storeyId}|${riserId}|${index}` (deterministic per input). */
  id: RouteSegmentId
  /** Upstream endpoint (farther from the riser, higher elevation). */
  start: RouteSegmentEndpoint
  /** Downstream endpoint (nearer the riser, lower elevation). */
  end: RouteSegmentEndpoint
  /** Which plan axis this segment runs along. */
  axis: 'x' | 'z'
  /** 'trunk' when the segment carries flow from more than one fixture. */
  kind: RouteSegmentKind
  /** Fixtures whose flow passes through this segment, sorted ascending. */
  servedFixtureExpressIds: number[]
  /**
   * Nominal diameter in millimetres from the served fixture kinds
   * (`resolveBranchSegmentDiameterMm` in `branchDefaults.ts`): per-kind for a
   * single fixture, Ø63 collector for ≥ 2 shared small fixtures, Ø110 when a WC is served.
   */
  diameterMm: number
  /** Riser this segment drains toward. */
  riserId: RiserId
  /** Vertical stack of the target riser, when known. */
  riserStackId?: string
  /** Set only for office row-collector routing; see {@link RouteSegmentRole}. */
  role?: RouteSegmentRole
  /** Id of the fixture row this segment belongs to (`role` 'row-stub' / 'row-collector' only). */
  rowId?: string
}

/**
 * All computed branch route segments for one storey, in the plan units the
 * input coordinates were interpreted in.
 */
export interface FloorRoutes {
  storeyId: StoreyId
  /** Units of every coordinate and elevation in `segments`. */
  planUnits: PlanUnits
  segments: RouteSegment[]
}

/** A point on the plan plane (X/Z; Y is vertical). */
export interface PlanPoint {
  x: number
  z: number
}

/**
 * A fixture that has already been assigned to a riser on a given storey.
 * Assignment is an upstream concern; this module only routes the geometry.
 */
export interface AssignedFixture {
  fixtureExpressId: number
  fixtureKind: FixtureKind
  /** Fixture connection point on the storey slab, plan X/Z. */
  fixturePlan: PlanPoint
  riserId: RiserId
  /** Vertical stack of the target riser, when known. */
  riserStackId?: string
  /** Riser position on the same storey, plan X/Z. */
  riserPlan: PlanPoint
  storeyId: StoreyId
}

/**
 * A fixture row that drains through a collector (office typology). Structural
 * subset of `FixtureRow` from `./wetCores` so rows can be passed straight
 * through. Coordinates must be in the same plan units as the assignments.
 */
export interface RowCollectorInput {
  id: string
  storeyId: StoreyId
  /** Axis the row (and its collector) runs along. */
  axis: 'x' | 'z'
  /** Perpendicular coordinate of the collector line (z for x-rows, x for z-rows). */
  collectorLineCoord: number
  /** Fixtures in the row. */
  memberExpressIds: number[]
}

export interface ComputeBranchRoutesOptions {
  /**
   * Units of the incoming plan coordinates. When omitted, units are detected
   * from coordinate magnitude with the same heuristic as `detectPlanUnits`
   * in `src/shared/routes/planGeometry.ts`: any |x| or |z| above 1000 means
   * mm, otherwise metres. Pass explicitly when the model units are known.
   */
  planUnits?: PlanUnits
  /**
   * Office row collectors (G3). Members of a row that are assigned to the same
   * riser (≥ 2 of them) route as: perpendicular stub → collector line along
   * the row → ONE L-run from the collector end nearest the riser to the riser.
   * Omitted/empty → every fixture routes individually (residential behaviour).
   */
  rowCollectors?: readonly RowCollectorInput[]
}

/**
 * Computes horizontal branch routing from every assigned fixture to its riser,
 * grouped per floor. Pure and deterministic: same input produces identical
 * segments, IDs, and ordering regardless of input order.
 *
 * Geometry rules:
 * - Corner rule (deterministic): each fixture connects with an axis-aligned
 *   L-run, X leg first — from the fixture along X at the fixture's Z to the
 *   riser's X, then along Z to the riser. The single bend corner is therefore
 *   always at (riser.x, fixture.z). Zero-length legs are skipped: an
 *   axis-aligned fixture yields one straight segment, and a fixture exactly
 *   at the riser position yields no segments.
 * - Slope: elevations drop toward the riser at the default 2% of run length
 *   (DEFAULT_BRANCH_SLOPE_DROP_MM per DEFAULT_BRANCH_SLOPE_RUN_MM). The datum
 *   is the branch connection point at the riser (elevation 0); upstream
 *   points sit at +slope x (remaining L1 run to the riser along the routed
 *   tree), so the fixture end is the highest point of its path.
 * - Merge rule: within one (storey, riser) group, legs are bucketed by
 *   (axis, line coordinate, flow side). All legs in a bucket are collinear,
 *   flow the same way, and end at the same junction, so they are merged and
 *   then split at every upstream entry point. Each emitted segment therefore
 *   carries a constant set of served fixtures, and shared approach corridors
 *   become trunk segments serving every fixture upstream of them.
 *
 * Approximations (V0):
 * - No obstacle avoidance: there is no wall/void data yet, so runs may cross
 *   walls, shafts, or room boundaries.
 * - Plan coordinates are snapped to 1 mm (`PLAN_SNAP_RESOLUTION`) before
 *   routing and compared exactly after that: legs merge only when they lie on
 *   the same millimetre line. The snap absorbs floating-point noise from
 *   geometry extraction (fixtures in a row typically differ by ~1e-14 m),
 *   which would otherwise split a shared corridor into parallel legs and emit
 *   zero-length segments that the IFC export rejects.
 * - Junction invert refinement is not modelled: elevations are the ideal
 *   2%-of-remaining-run levels, not min-invert-at-junction hydraulics.
 *
 * Row collectors (office, `options.rowCollectors`):
 * - Each row member gets a perpendicular stub from its centre to the collector
 *   line (`role: 'row-stub'`); the collector runs along the row on that line
 *   from the far member to the collector END — the row extreme nearest the
 *   riser along the row axis (tie → lower coordinate) — split at every member
 *   entry (`role: 'row-collector'`); then ONE L-run from the collector end to
 *   the riser carries every member (`role: 'collector-run'`) and merges with
 *   any other leg on the same corridor. The run's first leg continues along
 *   the row axis when the riser lies beyond the row extent (so it never
 *   doubles back over the collector), else it turns perpendicular first.
 *   Diameters follow `resolveBranchSegmentDiameterMm` on the served
 *   kinds (Ø110 as soon as a WC is served, Ø63 for ≥ 2 shared small fixtures).
 * - A row whose members are split across risers is applied per riser group;
 *   a group with < 2 members of the row routes those fixtures individually.
 * - Approximation: a stub can in theory overlap a plain leg on the same line
 *   (only when a member's along-coordinate equals the riser coordinate).
 *
 * @throws when the same riser id is given conflicting plan positions on one storey.
 */
export function computeBranchRoutes(
  assignments: AssignedFixture[],
  options: ComputeBranchRoutesOptions = {},
): FloorRoutes[] {
  const planUnits = options.planUnits ?? detectAssignedPlanUnits(assignments)
  const rowCollectors = options.rowCollectors ?? []
  const sortedAssignments = [...assignments].sort((a, b) => a.fixtureExpressId - b.fixtureExpressId)

  const byStorey = new Map<StoreyId, AssignedFixture[]>()
  for (const assignment of sortedAssignments) {
    const list = byStorey.get(assignment.storeyId) ?? []
    list.push(assignment)
    byStorey.set(assignment.storeyId, list)
  }

  const floors: FloorRoutes[] = []
  for (const storeyId of [...byStorey.keys()].sort((a, b) => a - b)) {
    const storeyAssignments = byStorey.get(storeyId) ?? []
    const byRiser = new Map<RiserId, AssignedFixture[]>()
    for (const assignment of storeyAssignments) {
      const list = byRiser.get(assignment.riserId) ?? []
      list.push(assignment)
      byRiser.set(assignment.riserId, list)
    }

    const storeyRows = rowCollectors.filter((row) => row.storeyId === storeyId)
    const segments: RouteSegment[] = []
    for (const riserId of [...byRiser.keys()].sort((a, b) => a.localeCompare(b))) {
      segments.push(...routeRiserGroup(storeyId, riserId, byRiser.get(riserId) ?? [], planUnits, storeyRows))
    }

    floors.push({ storeyId, planUnits, segments })
  }

  return floors
}

/**
 * Resolution the plan coordinates are snapped to before routing, per plan
 * unit: 1 mm. Anything closer than this is the same line / the same point.
 */
export const PLAN_SNAP_RESOLUTION: Record<PlanUnits, number> = { m: 0.001, mm: 1 }

function snapPlanPoint(point: PlanPoint, resolution: number): PlanPoint {
  return { x: snapCoordinate(point.x, resolution), z: snapCoordinate(point.z, resolution) }
}

function snapCoordinate(value: number, resolution: number): number {
  // `+ 0` folds -0 into 0 so snapped coordinates compare and stringify identically.
  return Math.round(value / resolution) * resolution + 0
}

interface LegEntry {
  /** Upstream entry coordinate along the run axis (exact input coordinate). */
  coord: number
  /** Fixtures entering the run at `coord` (one for a plain leg, the whole row for a collector run). */
  fixtureExpressIds: number[]
  /** Row-collector role carried by this entry, if any. */
  role?: RouteSegmentRole
}

interface LegBucket {
  axis: 'x' | 'z'
  /** Fixed coordinate of the line the legs run on (z for X-legs, x for Z-legs). */
  lineCoord: number
  /** +1 when upstream coordinates are greater than the junction coordinate. */
  side: 1 | -1
  /** Downstream junction coordinate on the run axis (riser.x for X-legs, riser.z for Z-legs). */
  junctionCoord: number
  /** Remaining L1 run from the junction to the riser (|fixture.z - riser.z| for X-legs, 0 for Z-legs). */
  tailDistance: number
  /** Row this bucket belongs to (stubs and collectors only). */
  rowId?: string
  entries: LegEntry[]
}

function routeRiserGroup(
  storeyId: StoreyId,
  riserId: RiserId,
  assignments: AssignedFixture[],
  planUnits: PlanUnits,
  rows: readonly RowCollectorInput[],
): RouteSegment[] {
  const resolution = PLAN_SNAP_RESOLUTION[planUnits]
  const riserPlan = snapPlanPoint(assignments[0].riserPlan, resolution)
  for (const assignment of assignments) {
    const candidate = snapPlanPoint(assignment.riserPlan, resolution)
    if (candidate.x !== riserPlan.x || candidate.z !== riserPlan.z) {
      throw new Error(`Conflicting plan positions for riser ${riserId} on storey ${storeyId}`)
    }
  }
  const riserStackId = assignments.find((assignment) => assignment.riserStackId !== undefined)?.riserStackId
  const kindByFixture = new Map(assignments.map((assignment) => [assignment.fixtureExpressId, assignment.fixtureKind]))

  const buckets = new Map<string, LegBucket>()
  const rowMembers = new Set<number>()
  for (const row of rows) {
    const members = assignments.filter((assignment) => row.memberExpressIds.includes(assignment.fixtureExpressId))
    if (members.length < 2) continue
    for (const member of members) rowMembers.add(member.fixtureExpressId)
    addRowLegs(buckets, row, members, riserPlan, resolution)
  }

  for (const assignment of assignments) {
    const { fixtureExpressId } = assignment
    if (rowMembers.has(fixtureExpressId)) continue
    const fixturePlan = snapPlanPoint(assignment.fixturePlan, resolution)
    addLRunLegs(buckets, fixturePlan, riserPlan, { fixtureExpressIds: [fixtureExpressId] })
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => {
    if (a.axis !== b.axis) return a.axis === 'x' ? -1 : 1
    if (a.lineCoord !== b.lineCoord) return a.lineCoord - b.lineCoord
    if (a.side !== b.side) return a.side - b.side
    return a.junctionCoord - b.junctionCoord
  })

  const segments: RouteSegment[] = []
  for (const bucket of sortedBuckets) {
    for (const segment of emitBucketSegments(bucket)) {
      segments.push({
        ...segment,
        id: `branch-seg|${storeyId}|${riserId}|${segments.length}`,
        diameterMm: resolveBranchSegmentDiameterMm(
          segment.servedFixtureExpressIds.flatMap((expressId) => {
            const kind = kindByFixture.get(expressId)
            return kind === undefined ? [] : [kind]
          }),
        ),
        riserId,
        riserStackId,
      })
    }
  }
  return segments
}

/**
 * Corner rule: an axis-aligned L-run from `from` to the riser, `firstAxis`
 * leg first (X for the plain rule). `entry.fixtureExpressIds` and
 * `entry.role` are carried onto both legs.
 */
function addLRunLegs(
  buckets: Map<string, LegBucket>,
  from: PlanPoint,
  riserPlan: PlanPoint,
  entry: Omit<LegEntry, 'coord'>,
  firstAxis: 'x' | 'z' = 'x',
): void {
  const dx = from.x - riserPlan.x
  const dz = from.z - riserPlan.z
  const xLeg = (tailDistance: number) =>
    addLeg(buckets, {
      axis: 'x',
      lineCoord: firstAxis === 'x' ? from.z : riserPlan.z,
      side: dx > 0 ? 1 : -1,
      junctionCoord: riserPlan.x,
      tailDistance,
    }, { fixtureExpressIds: entry.fixtureExpressIds, role: entry.role, coord: from.x })
  const zLeg = (tailDistance: number) =>
    addLeg(buckets, {
      axis: 'z',
      lineCoord: firstAxis === 'x' ? riserPlan.x : from.x,
      side: dz > 0 ? 1 : -1,
      junctionCoord: riserPlan.z,
      tailDistance,
    }, { fixtureExpressIds: entry.fixtureExpressIds, role: entry.role, coord: from.z })
  if (firstAxis === 'x') {
    if (dx !== 0) xLeg(Math.abs(dz))
    if (dz !== 0) zLeg(0)
  } else {
    if (dz !== 0) zLeg(Math.abs(dx))
    if (dx !== 0) xLeg(0)
  }
}

/** Stub → collector → single run legs for the members of one row in one riser group. */
function addRowLegs(
  buckets: Map<string, LegBucket>,
  row: RowCollectorInput,
  members: AssignedFixture[],
  riserPlan: PlanPoint,
  resolution: number,
): void {
  const along = (point: PlanPoint) => (row.axis === 'x' ? point.x : point.z)
  const perp = (point: PlanPoint) => (row.axis === 'x' ? point.z : point.x)
  const perpAxis: 'x' | 'z' = row.axis === 'x' ? 'z' : 'x'
  const collectorCoord = snapCoordinate(row.collectorLineCoord, resolution)
  const memberPlans = members.map((member) => ({
    fixtureExpressId: member.fixtureExpressId,
    plan: snapPlanPoint(member.fixturePlan, resolution),
  }))
  const alongCoords = memberPlans.map((member) => along(member.plan))
  const alongMin = Math.min(...alongCoords)
  const alongMax = Math.max(...alongCoords)
  const riserAlong = along(riserPlan)
  // Collector end: the row extreme nearest the riser along the row axis; tie → min.
  const endAlong = Math.abs(riserAlong - alongMax) < Math.abs(riserAlong - alongMin) ? alongMax : alongMin
  const endPoint: PlanPoint = row.axis === 'x' ? { x: endAlong, z: collectorCoord } : { x: collectorCoord, z: endAlong }
  const runLength = Math.abs(endPoint.x - riserPlan.x) + Math.abs(endPoint.z - riserPlan.z)
  const allMembers = memberPlans.map((member) => member.fixtureExpressId).sort((a, b) => a - b)

  for (const member of memberPlans) {
    const memberAlong = along(member.plan)
    const memberPerp = perp(member.plan)
    if (memberPerp !== collectorCoord) {
      addLeg(buckets, {
        axis: perpAxis,
        lineCoord: memberAlong,
        side: memberPerp > collectorCoord ? 1 : -1,
        junctionCoord: collectorCoord,
        tailDistance: Math.abs(memberAlong - endAlong) + runLength,
        rowId: row.id,
      }, { coord: memberPerp, fixtureExpressIds: [member.fixtureExpressId], role: 'row-stub' })
    }
    if (memberAlong !== endAlong) {
      addLeg(buckets, {
        axis: row.axis,
        lineCoord: collectorCoord,
        side: endAlong === alongMin ? 1 : -1,
        junctionCoord: endAlong,
        tailDistance: runLength,
        rowId: row.id,
      }, { coord: memberAlong, fixtureExpressIds: [member.fixtureExpressId], role: 'row-collector' })
    }
  }
  // The run leaves the collector end along the row axis when the riser lies
  // beyond the row extent (it continues the collector's direction, never
  // doubling back over it); otherwise it turns perpendicular first.
  const riserBeyondRow = riserAlong < alongMin || riserAlong > alongMax
  addLRunLegs(buckets, endPoint, riserPlan, { fixtureExpressIds: allMembers, role: 'collector-run' }, riserBeyondRow ? row.axis : perpAxis)
}

function addLeg(
  buckets: Map<string, LegBucket>,
  bucket: Omit<LegBucket, 'entries'>,
  entry: LegEntry,
): void {
  // Junction coordinate is part of the key so a row stub never merges with a
  // plain leg on the same line that drains to a different junction. For plain
  // legs the junction is fixed per axis, so their grouping is unchanged.
  const key = `${bucket.axis}|${bucket.lineCoord}|${bucket.side}|${bucket.junctionCoord}`
  const existing = buckets.get(key)
  if (existing) {
    existing.entries.push(entry)
    return
  }
  buckets.set(key, { ...bucket, entries: [entry] })
}

type UnkeyedSegment = Omit<RouteSegment, 'id' | 'diameterMm' | 'riserId' | 'riserStackId'>

/**
 * Merges a bucket of collinear same-direction legs and splits the merged run
 * at every distinct upstream entry coordinate, so each emitted segment serves
 * a constant fixture set. Segments are emitted upstream to downstream. Entries
 * sitting exactly at the junction (a row member at the collector end) add no
 * length and are served downstream instead.
 */
function emitBucketSegments(bucket: LegBucket): UnkeyedSegment[] {
  const farthestFirst = bucket.side === 1
    ? (a: number, b: number) => b - a
    : (a: number, b: number) => a - b
  const entryCoords = [...new Set(bucket.entries.map((entry) => entry.coord))]
    .filter((coord) => coord !== bucket.junctionCoord)
    .sort(farthestFirst)
  const boundaries = [...entryCoords, bucket.junctionCoord]
  const role = resolveBucketRole(bucket)

  const served = new Set<number>()
  const segments: UnkeyedSegment[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    for (const entry of bucket.entries) {
      if (entry.coord === from) for (const expressId of entry.fixtureExpressIds) served.add(expressId)
    }
    const servedFixtureExpressIds = [...served].sort((a, b) => a - b)
    segments.push({
      start: bucketPoint(bucket, from),
      end: bucketPoint(bucket, to),
      axis: bucket.axis,
      kind: servedFixtureExpressIds.length > 1 ? 'trunk' : 'fixture-branch',
      servedFixtureExpressIds,
      ...(role === undefined ? {} : { role }),
      ...(bucket.rowId === undefined ? {} : { rowId: bucket.rowId }),
    })
  }
  return segments
}

/**
 * Role of a merged bucket: stubs and collectors are never merged with other
 * legs (their key includes the row junction), so their entries agree; a plain
 * corridor becomes a 'collector-run' as soon as a row's run enters it.
 */
function resolveBucketRole(bucket: LegBucket): RouteSegmentRole | undefined {
  let role: RouteSegmentRole | undefined
  for (const entry of bucket.entries) {
    if (entry.role === undefined) continue
    if (role === undefined || entry.role === 'collector-run') role = entry.role
  }
  return role
}

function bucketPoint(bucket: LegBucket, coord: number): RouteSegmentEndpoint {
  const remainingRun = Math.abs(coord - bucket.junctionCoord) + bucket.tailDistance
  const elevation = BRANCH_SLOPE_RATIO * remainingRun
  return bucket.axis === 'x'
    ? { x: coord, z: bucket.lineCoord, elevation }
    : { x: bucket.lineCoord, z: coord, elevation }
}

/** Mirrors `detectPlanUnits` in `src/shared/routes/planGeometry.ts` for assigned fixtures. */
function detectAssignedPlanUnits(assignments: AssignedFixture[]): PlanUnits {
  for (const { fixturePlan, riserPlan } of assignments) {
    if (Math.abs(fixturePlan.x) > 1000 || Math.abs(fixturePlan.z) > 1000) return 'mm'
    if (Math.abs(riserPlan.x) > 1000 || Math.abs(riserPlan.z) > 1000) return 'mm'
  }
  return 'm'
}
