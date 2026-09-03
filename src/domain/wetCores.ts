import {
  findFreeCellWithinBounds,
  isCellBlocked,
  cellCenter,
  probeContinuityCell,
  type ContinuityMap,
  type PlanPoint,
  type ShaftCandidate,
  type StoreyObstructionGrid,
} from './continuityMap'
import type { Fixture, PlanBounds, StoreyId } from './types'

/**
 * Wet cores and one-stack-per-core placement (V3).
 *
 * A wet core is a group of sanitary fixtures (every kind, toilets included)
 * that sit close enough together to share one vertical riser stack:
 * single-linkage clustering on the plan plane with the link distance
 * {@link WET_CORE_LINK_DISTANCE_M}. Two fixtures belong to the same core when a
 * chain of fixtures connects them with every hop ≤ the link distance; a 2.7 m
 * gap therefore splits two cores. The distance deliberately equals V4's
 * `SAME_CORE_RADIUS_M`, so the storey-to-storey core matching of the stack
 * extent and the per-storey clustering here describe the same physical core.
 *
 * Placement of the single stack of a core, in this order. The snap distance
 * (`maxSnap`, the shared MAX_SNAP 1.5 m pair) is measured from the core
 * FOOTPRINT (its bbox; 0 when the target lies inside it), not from the
 * centroid: a wet core is room-sized (4–5 m across on real floors) and its
 * shaft sits at the room's wall, which is farther than 1.5 m from the centre
 * of the fixtures but well within 1.5 m of the fixtures themselves.
 *
 *  (a) SHAFT — the nearest continuity-map shaft candidate (slab opening,
 *      shaft-named space, aligned void) within the snap distance of the core
 *      footprint, provided its centre cell is not blocked (else the nearest
 *      free cell inside the candidate's footprint is used, else the candidate
 *      is skipped).
 *  (b) FREE CELL — the nearest free obstruction-grid cell within the snap
 *      distance of the footprint (never a wall / column / solid-slab cell).
 *  (c) WALL-SIDE EDGE — with no structure loaded (no map, or a map without a
 *      grid for the storey), the core's bbox edge farthest from the storey's
 *      plan centre, offset outward by {@link WET_CORE_WALL_CLEARANCE_M}. This
 *      is an approximation: the far edge of a wet core is usually the wall
 *      side of the room, but no wall geometry is consulted here.
 *  (d) CENTROID, FLAGGED — when a map covers the storey but every candidate
 *      within the snap distance is obstructed, the stack stays at the centroid
 *      and carries an explicit `flagged` reason for the UI. Never silent.
 *
 * Kitchen areas are NOT clustered here: kitchen waste commonly runs in its own
 * stack, and kitchen areas are spaces rather than fixtures, so the caller keeps
 * one dedicated kitchen stack per kitchen area (see
 * `src/shared/routes/suggestRisers.ts`). A kitchen SINK fixture that sits
 * inside a core stays a core member.
 *
 * Pure and deterministic: same input → same cores, ids, and order regardless of
 * input order. Plan plane is (x, z) as in `Fixture.position`; lengths are in
 * the caller-declared `units` — never assumed.
 */

// ---------------------------------------------------------------------------
// Constants (mm/m pairs, per repo unit rules)
// ---------------------------------------------------------------------------

/** Single-linkage distance for fixtures of one wet core. */
export const WET_CORE_LINK_DISTANCE_MM = 2600
export const WET_CORE_LINK_DISTANCE_M = 2.6

/** Outward offset from the core bbox edge for the wall-side-edge rule. */
export const WET_CORE_WALL_CLEARANCE_MM = 150
export const WET_CORE_WALL_CLEARANCE_M = 0.15

export type WetCorePlanUnits = 'mm' | 'm'

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface WetCore {
  /** `wet-core:<storeyId>:<member express ids ascending, '+'-joined>` — stable for the same members. */
  id: string
  storeyId: StoreyId
  /** Member fixtures sorted by express id ascending. All have a position. */
  members: Fixture[]
  memberExpressIds: number[]
  /** Mean member plan position. */
  centroid: PlanPoint
  /** Mean member vertical coordinate (viewer Y), for stack anchoring. */
  centroidY: number
  /** Plan bbox of the member positions (degenerate for a single fixture). */
  bbox: PlanBounds
  /** Sorted distinct member kinds, '+'-joined (e.g. `TOILETPAN+WASHHANDBASIN`). */
  kindsFingerprint: string
  /** Member count per kind, keys sorted. */
  kindCounts: Record<string, number>
}

export interface ClusterWetCoresOptions {
  /** Unit of the fixture plan coordinates. Never assumed. */
  units: WetCorePlanUnits
  /** Link distance in `units`; defaults to the 2.6 m constant pair. */
  linkDistance?: number
}

export interface ClusterWetCoresResult {
  /** Cores ordered by storey (ascending id), then along the storey's dominant plan axis. */
  cores: WetCore[]
  /** Fixtures without a position cannot be clustered; listed here, never dropped silently. */
  skippedFixtureExpressIds: number[]
}

type PositionedFixture = Fixture & { position: NonNullable<Fixture['position']> }

export function resolveWetCoreLinkDistance(units: WetCorePlanUnits, override?: number): number {
  if (override !== undefined) return override
  return units === 'mm' ? WET_CORE_LINK_DISTANCE_MM : WET_CORE_LINK_DISTANCE_M
}

export function clusterWetCores(fixtures: Fixture[], options: ClusterWetCoresOptions): ClusterWetCoresResult {
  const linkDistance = resolveWetCoreLinkDistance(options.units, options.linkDistance)
  const positioned: PositionedFixture[] = []
  const skippedFixtureExpressIds: number[] = []
  for (const fixture of fixtures) {
    if (fixture.position === null) skippedFixtureExpressIds.push(fixture.expressId)
    else positioned.push(fixture as PositionedFixture)
  }
  skippedFixtureExpressIds.sort((a, b) => a - b)

  const byStorey = new Map<StoreyId, PositionedFixture[]>()
  for (const fixture of positioned) {
    const list = byStorey.get(fixture.storeyId)
    if (list === undefined) byStorey.set(fixture.storeyId, [fixture])
    else list.push(fixture)
  }

  const cores: WetCore[] = []
  for (const storeyId of [...byStorey.keys()].sort((a, b) => a - b)) {
    const storeyFixtures = [...byStorey.get(storeyId)!].sort(compareFixtures)
    const storeyCores = clusterStorey(storeyId, storeyFixtures, linkDistance)
    cores.push(...sortByDominantPlanAxis(storeyCores))
  }
  return { cores, skippedFixtureExpressIds }
}

function compareFixtures(a: Fixture, b: Fixture): number {
  return a.expressId - b.expressId
}

/** Single-linkage clustering via union-find on pairs within the link distance. */
function clusterStorey(
  storeyId: StoreyId,
  fixtures: PositionedFixture[],
  linkDistance: number,
): WetCore[] {
  const parent = fixtures.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }

  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      if (planDistance(fixtures[i].position, fixtures[j].position) <= linkDistance) union(i, j)
    }
  }

  const groups = new Map<number, PositionedFixture[]>()
  fixtures.forEach((fixture, index) => {
    const root = find(index)
    const group = groups.get(root)
    if (group === undefined) groups.set(root, [fixture])
    else group.push(fixture)
  })

  return [...groups.values()].map((members) => buildCore(storeyId, members))
}

function buildCore(storeyId: StoreyId, members: PositionedFixture[]): WetCore {
  const sorted = [...members].sort(compareFixtures)
  const memberExpressIds = sorted.map((fixture) => fixture.expressId)
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  const bbox: PlanBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const kindCounts: Record<string, number> = {}
  for (const fixture of sorted) {
    sumX += fixture.position.x
    sumY += fixture.position.y
    sumZ += fixture.position.z
    bbox.minX = Math.min(bbox.minX, fixture.position.x)
    bbox.maxX = Math.max(bbox.maxX, fixture.position.x)
    bbox.minZ = Math.min(bbox.minZ, fixture.position.z)
    bbox.maxZ = Math.max(bbox.maxZ, fixture.position.z)
    kindCounts[fixture.kind] = (kindCounts[fixture.kind] ?? 0) + 1
  }
  const sortedKindCounts: Record<string, number> = {}
  for (const kind of Object.keys(kindCounts).sort()) sortedKindCounts[kind] = kindCounts[kind]

  return {
    id: `wet-core:${storeyId}:${memberExpressIds.join('+')}`,
    storeyId,
    members: sorted,
    memberExpressIds,
    centroid: { x: sumX / sorted.length, z: sumZ / sorted.length },
    centroidY: sumY / sorted.length,
    bbox,
    kindsFingerprint: Object.keys(sortedKindCounts).join('+'),
    kindCounts: sortedKindCounts,
  }
}

/**
 * Same ordering rule as the toilet-anchored suggestion (`suggestRisers.ts`):
 * along the axis with the larger spread first, then the other axis, then id.
 */
function sortByDominantPlanAxis(cores: WetCore[]): WetCore[] {
  if (cores.length === 0) return cores
  const xs = cores.map((core) => core.centroid.x)
  const zs = cores.map((core) => core.centroid.z)
  const useZ = Math.max(...zs) - Math.min(...zs) > Math.max(...xs) - Math.min(...xs)
  return [...cores].sort((a, b) => {
    const primary = useZ ? a.centroid.z - b.centroid.z : a.centroid.x - b.centroid.x
    if (primary !== 0) return primary
    const secondary = useZ ? a.centroid.x - b.centroid.x : a.centroid.z - b.centroid.z
    if (secondary !== 0) return secondary
    return a.id.localeCompare(b.id)
  })
}

function planDistance(a: PlanPoint, b: PlanPoint): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export type WetCoreBboxEdge = 'minX' | 'maxX' | 'minZ' | 'maxZ'

export type WetCoreStackPlacement =
  | {
      rule: 'shaft'
      position: PlanPoint
      shaftId: string
      /** Plan distance from the core footprint (bbox) to the chosen position; 0 when inside it. */
      distance: number
      flagged: false
      reason: string
    }
  | {
      rule: 'free-cell'
      position: PlanPoint
      cell: { col: number; row: number }
      distance: number
      flagged: false
      reason: string
    }
  | {
      rule: 'wall-side-edge'
      position: PlanPoint
      edge: WetCoreBboxEdge
      clearance: number
      flagged: false
      reason: string
    }
  | {
      rule: 'centroid'
      position: PlanPoint
      /** True when a map covered the storey but every candidate in range was obstructed. */
      flagged: boolean
      reason: string
    }

export interface PlaceWetCoreStackOptions {
  /** Unit of the core coordinates, the map, the plan bounds and `maxSnap`. */
  units: WetCorePlanUnits
  /** W5 continuity map in the same units; null/undefined = no structure loaded. */
  continuityMap?: ContinuityMap | null
  /** Snap search radius around the centroid in `units`. Required when a map is given. */
  maxSnap: number
  /** Storey plan bounds for the wall-side-edge rule; null = unknown. */
  floorPlanBounds?: PlanBounds | null
  /** Outward clearance for the wall-side-edge rule; defaults to the 150 mm pair. */
  wallClearance?: number
}

export function resolveWetCoreWallClearance(units: WetCorePlanUnits, override?: number): number {
  if (override !== undefined) return override
  return units === 'mm' ? WET_CORE_WALL_CLEARANCE_MM : WET_CORE_WALL_CLEARANCE_M
}

export function placeWetCoreStack(core: WetCore, options: PlaceWetCoreStackOptions): WetCoreStackPlacement {
  const map = options.continuityMap ?? null
  const structure = map === null ? null : describeStructureCoverage(map, core.storeyId, options.units)

  if (structure !== null && structure.usable) {
    // (a) shaft candidates work with or without an obstruction grid for the storey.
    const shaft = snapCoreToShaft(core, map!, structure.grid, options.maxSnap)
    if (shaft !== null) return shaft
    if (structure.grid !== null) {
      // (b) free grid cell; (d) everything in range is obstructed → flagged centroid.
      const free = nearestFreeCell(structure.grid, core, options.maxSnap)
      if (free !== null) {
        return {
          rule: 'free-cell',
          position: free.position,
          cell: free.cell,
          distance: free.distance,
          flagged: false,
          reason: `no shaft candidate within range; snapped to the nearest free grid cell (${free.cell.col}, ${free.cell.row})`,
        }
      }
      return {
        rule: 'centroid',
        position: { ...core.centroid },
        flagged: true,
        reason:
          `every shaft candidate and grid cell within ${formatLength(options.maxSnap, options.units)} of the core ` +
          `footprint is obstructed (wall / column / slab); stack left at the core centroid`,
      }
    }
  }

  const structureNote =
    structure === null
      ? 'no continuity map loaded'
      : structure.usable
        ? `continuity map has shaft candidates but no obstruction grid for storey ${core.storeyId} and no candidate within ${formatLength(options.maxSnap, options.units)}`
        : structure.reason
  const bounds = options.floorPlanBounds ?? null
  if (bounds !== null && isFiniteBounds(bounds)) {
    const clearance = resolveWetCoreWallClearance(options.units, options.wallClearance)
    const edge = chooseWallSideEdge(core.bbox, bounds)
    const position = clampToBounds(edgePosition(core.bbox, edge, clearance), bounds)
    return {
      rule: 'wall-side-edge',
      position,
      edge,
      clearance,
      flagged: false,
      reason:
        `${structureNote}; stack placed ${formatLength(clearance, options.units)} outside the core's ${edge} edge ` +
        `(farthest from the storey plan centre) — approximation without wall geometry`,
    }
  }

  return {
    rule: 'centroid',
    position: { ...core.centroid },
    flagged: false,
    reason: `${structureNote} and no storey plan bounds; stack left at the core centroid`,
  }
}

type StructureCoverage =
  | { usable: true; grid: StoreyObstructionGrid | null }
  | { usable: false; reason: string }

/**
 * A map is usable for a storey when its units match and it has a non-empty
 * grid or a shaft candidate for that storey. `grid` is null when only shaft
 * candidates exist (no obstruction knowledge → never flag as obstructed).
 */
function describeStructureCoverage(
  map: ContinuityMap,
  storeyId: StoreyId,
  units: WetCorePlanUnits,
): StructureCoverage {
  if (map.units !== units) {
    return {
      usable: false,
      reason: `continuity map units (${map.units}) differ from plan units (${units}); map ignored`,
    }
  }
  const grid = map.grids.find((candidate) => candidate.storeyId === storeyId)
  const hasGrid = grid !== undefined && grid.columns > 0 && grid.rows > 0
  const hasShaft = map.shaftCandidates.some((candidate) => candidate.storeyIds.includes(storeyId))
  if (hasGrid) return { usable: true, grid }
  if (hasShaft) return { usable: true, grid: null }
  return { usable: false, reason: `continuity map has no grid or shaft candidate for storey ${storeyId}` }
}

function snapCoreToShaft(
  core: WetCore,
  map: ContinuityMap,
  grid: StoreyObstructionGrid | null,
  maxSnap: number,
): WetCoreStackPlacement | null {
  const storeyId = core.storeyId
  // (a) shaft candidates, nearest to the core footprint first (ties: nearer centroid, then id).
  const shafts = map.shaftCandidates
    .filter((candidate) => candidate.storeyIds.includes(storeyId))
    .map((candidate) => ({
      candidate,
      distance: distanceFromBounds(core.bbox, candidate.center),
      centroidDistance: planDistance(core.centroid, candidate.center),
    }))
    .filter((entry) => entry.distance <= maxSnap)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.centroidDistance - b.centroidDistance ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
  for (const { candidate, distance } of shafts) {
    const target = resolveShaftTarget(map, storeyId, grid, candidate, core.centroid)
    if (target === null) continue
    return {
      rule: 'shaft',
      position: target.position,
      shaftId: candidate.id,
      distance: target.moved ? distanceFromBounds(core.bbox, target.position) : distance,
      flagged: false,
      reason: target.moved
        ? `snapped to shaft candidate ${candidate.id} (its centre cell is blocked; nearest free cell inside the shaft used)`
        : `snapped to shaft candidate ${candidate.id}`,
    }
  }
  return null
}

/**
 * Snap target inside a shaft candidate: its centre when that cell is free or
 * unknown, else the nearest free cell inside the candidate footprint, else
 * null (the candidate is fully obstructed on this storey and is skipped).
 */
function resolveShaftTarget(
  map: ContinuityMap,
  storeyId: StoreyId,
  grid: StoreyObstructionGrid | null,
  candidate: ShaftCandidate,
  centroid: PlanPoint,
): { position: PlanPoint; moved: boolean } | null {
  const probe = probeContinuityCell(map, storeyId, candidate.center)
  if (probe.status !== 'blocked' || grid === null) return { position: { ...candidate.center }, moved: false }
  const free = findFreeCellWithinBounds(grid, candidate.bounds, centroid)
  if (free === null) return null
  return { position: free.position, moved: true }
}

/**
 * Nearest free cell whose centre lies within `maxSnap` of the core footprint
 * (bbox); among equally distant cells the one nearer the centroid wins, then
 * the lower row / column (deterministic).
 */
function nearestFreeCell(
  grid: StoreyObstructionGrid,
  core: Pick<WetCore, 'bbox' | 'centroid'>,
  maxSnap: number,
): { cell: { col: number; row: number }; position: PlanPoint; distance: number } | null {
  const { bbox, centroid } = core
  const colFrom = Math.max(0, Math.floor((bbox.minX - maxSnap - grid.origin.x) / grid.cellSize))
  const colTo = Math.min(grid.columns - 1, Math.floor((bbox.maxX + maxSnap - grid.origin.x) / grid.cellSize))
  const rowFrom = Math.max(0, Math.floor((bbox.minZ - maxSnap - grid.origin.z) / grid.cellSize))
  const rowTo = Math.min(grid.rows - 1, Math.floor((bbox.maxZ + maxSnap - grid.origin.z) / grid.cellSize))
  let best: { cell: { col: number; row: number }; position: PlanPoint; distance: number; centroidDistance: number } | null = null
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      if (isCellBlocked(grid, col, row)) continue
      const center = cellCenter(grid, col, row)
      const distance = distanceFromBounds(bbox, center)
      if (distance > maxSnap) continue
      const centroidDistance = planDistance(centroid, center)
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && centroidDistance < best.centroidDistance)
      ) {
        best = { cell: { col, row }, position: center, distance, centroidDistance }
      }
    }
  }
  return best === null ? null : { cell: best.cell, position: best.position, distance: best.distance }
}

/** Plan distance from a point to the nearest point of `bounds`; 0 when inside. */
function distanceFromBounds(bounds: PlanBounds, point: PlanPoint): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX)
  const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ)
  return Math.sqrt(dx * dx + dz * dz)
}

/** The bbox edge farthest from the storey plan centre; ties resolve in the order minX, maxX, minZ, maxZ. */
export function chooseWallSideEdge(bbox: PlanBounds, floorPlanBounds: PlanBounds): WetCoreBboxEdge {
  const centerX = (floorPlanBounds.minX + floorPlanBounds.maxX) / 2
  const centerZ = (floorPlanBounds.minZ + floorPlanBounds.maxZ) / 2
  const candidates: Array<{ edge: WetCoreBboxEdge; distance: number }> = [
    { edge: 'minX', distance: Math.abs(bbox.minX - centerX) },
    { edge: 'maxX', distance: Math.abs(bbox.maxX - centerX) },
    { edge: 'minZ', distance: Math.abs(bbox.minZ - centerZ) },
    { edge: 'maxZ', distance: Math.abs(bbox.maxZ - centerZ) },
  ]
  let best = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (candidate.distance > best.distance) best = candidate
  }
  return best.edge
}

function edgePosition(bbox: PlanBounds, edge: WetCoreBboxEdge, clearance: number): PlanPoint {
  const midX = (bbox.minX + bbox.maxX) / 2
  const midZ = (bbox.minZ + bbox.maxZ) / 2
  switch (edge) {
    case 'minX':
      return { x: bbox.minX - clearance, z: midZ }
    case 'maxX':
      return { x: bbox.maxX + clearance, z: midZ }
    case 'minZ':
      return { x: midX, z: bbox.minZ - clearance }
    case 'maxZ':
      return { x: midX, z: bbox.maxZ + clearance }
  }
}

function clampToBounds(point: PlanPoint, bounds: PlanBounds): PlanPoint {
  return {
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    z: Math.min(Math.max(point.z, bounds.minZ), bounds.maxZ),
  }
}

function isFiniteBounds(bounds: PlanBounds): boolean {
  return [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
}

function formatLength(value: number, units: WetCorePlanUnits): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ${units}`
}
