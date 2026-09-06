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

export interface ComputeBranchRoutesOptions {
  /**
   * Units of the incoming plan coordinates. When omitted, units are detected
   * from coordinate magnitude with the same heuristic as `detectPlanUnits`
   * in `src/shared/routes/planGeometry.ts`: any |x| or |z| above 1000 means
   * mm, otherwise metres. Pass explicitly when the model units are known.
   */
  planUnits?: PlanUnits
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
 * @throws when the same riser id is given conflicting plan positions on one storey.
 */
export function computeBranchRoutes(
  assignments: AssignedFixture[],
  options: ComputeBranchRoutesOptions = {},
): FloorRoutes[] {
  const planUnits = options.planUnits ?? detectAssignedPlanUnits(assignments)
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

    const segments: RouteSegment[] = []
    for (const riserId of [...byRiser.keys()].sort((a, b) => a.localeCompare(b))) {
      segments.push(...routeRiserGroup(storeyId, riserId, byRiser.get(riserId) ?? [], planUnits))
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
  fixtureExpressId: number
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
  entries: LegEntry[]
}

function routeRiserGroup(
  storeyId: StoreyId,
  riserId: RiserId,
  assignments: AssignedFixture[],
  planUnits: PlanUnits,
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
  for (const assignment of assignments) {
    const { fixtureExpressId } = assignment
    const fixturePlan = snapPlanPoint(assignment.fixturePlan, resolution)
    const dx = fixturePlan.x - riserPlan.x
    const dz = fixturePlan.z - riserPlan.z

    if (dx !== 0) {
      addLeg(buckets, {
        axis: 'x',
        lineCoord: fixturePlan.z,
        side: dx > 0 ? 1 : -1,
        junctionCoord: riserPlan.x,
        tailDistance: Math.abs(dz),
      }, { coord: fixturePlan.x, fixtureExpressId })
    }
    if (dz !== 0) {
      addLeg(buckets, {
        axis: 'z',
        lineCoord: riserPlan.x,
        side: dz > 0 ? 1 : -1,
        junctionCoord: riserPlan.z,
        tailDistance: 0,
      }, { coord: fixturePlan.z, fixtureExpressId })
    }
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => {
    if (a.axis !== b.axis) return a.axis === 'x' ? -1 : 1
    if (a.lineCoord !== b.lineCoord) return a.lineCoord - b.lineCoord
    return a.side - b.side
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

function addLeg(
  buckets: Map<string, LegBucket>,
  bucket: Omit<LegBucket, 'entries'>,
  entry: LegEntry,
): void {
  const key = `${bucket.axis}|${bucket.lineCoord}|${bucket.side}`
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
 * a constant fixture set. Segments are emitted upstream to downstream.
 */
function emitBucketSegments(bucket: LegBucket): UnkeyedSegment[] {
  const farthestFirst = bucket.side === 1
    ? (a: number, b: number) => b - a
    : (a: number, b: number) => a - b
  const entryCoords = [...new Set(bucket.entries.map((entry) => entry.coord))].sort(farthestFirst)
  const boundaries = [...entryCoords, bucket.junctionCoord]

  const served = new Set<number>()
  const segments: UnkeyedSegment[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    for (const entry of bucket.entries) {
      if (entry.coord === from) served.add(entry.fixtureExpressId)
    }
    const servedFixtureExpressIds = [...served].sort((a, b) => a - b)
    segments.push({
      start: bucketPoint(bucket, from),
      end: bucketPoint(bucket, to),
      axis: bucket.axis,
      kind: servedFixtureExpressIds.length > 1 ? 'trunk' : 'fixture-branch',
      servedFixtureExpressIds,
    })
  }
  return segments
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
