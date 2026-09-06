import {
  findFreeCellWithinBounds,
  isCellBlocked,
  cellCenter,
  probeContinuityCell,
  probeStructureAlongAxis,
  selectOfficeCoreShafts,
  type ContinuityMap,
  type OfficeCoreShaftSelection,
  type PlanPoint,
  type ShaftCandidate,
  type StoreyObstructionGrid,
} from './continuityMap'
import {
  DEFAULT_BUILDING_TYPOLOGY,
  TYPOLOGY_PLACEMENT_RULES,
  type BuildingTypology,
  type RowCollectorRules,
} from './typology'
import type { Fixture, FixtureKind, PlanBounds, StoreyId } from './types'

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
 * OFFICE typology (G3, `typology: 'office'`, see `src/domain/typology.ts`):
 * the chain is replaced by ONE rule — the nearest CORE shaft
 * (`selectOfficeCoreShafts`: shaft-like slab openings within
 * `OFFICE_CORE_RADIUS_M` of dense structure or a stair/lift void) within
 * `MAX_SNAP_OFFICE_M` of the core footprint. No free-cell and no wall-side
 * fallback: with no core shaft in range (or no continuity map at all) the
 * stack stays at the centroid, FLAGGED, with the reason. Residential is the
 * default and untouched.
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
  /**
   * Building typology (G3). Omitted / 'residential' = the documented chain
   * above; 'office' = core shafts only (flagged when none is in `maxSnap`).
   */
  typology?: BuildingTypology
  /**
   * Office only: the storey's core-shaft selection, precomputed by the caller
   * so several cores of one storey share it. Computed here when omitted.
   */
  officeCoreShafts?: OfficeCoreShaftSelection | null
}

export function resolveWetCoreWallClearance(units: WetCorePlanUnits, override?: number): number {
  if (override !== undefined) return override
  return units === 'mm' ? WET_CORE_WALL_CLEARANCE_MM : WET_CORE_WALL_CLEARANCE_M
}

export function placeWetCoreStack(core: WetCore, options: PlaceWetCoreStackOptions): WetCoreStackPlacement {
  const map = options.continuityMap ?? null
  const structure = map === null ? null : describeStructureCoverage(map, core.storeyId, options.units)

  if ((options.typology ?? DEFAULT_BUILDING_TYPOLOGY) === 'office') {
    return placeOfficeCoreStack(core, options, map, structure)
  }

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

// ---------------------------------------------------------------------------
// Office placement (G3): core shafts only
// ---------------------------------------------------------------------------

/**
 * Office rule: nearest selected core shaft within `maxSnap` of the core
 * footprint (centre cell, or the nearest free cell inside the shaft when its
 * centre is blocked). Anything else is a FLAGGED centroid with the reason —
 * never a wall-side guess, never a free cell in open floor.
 */
function placeOfficeCoreStack(
  core: WetCore,
  options: PlaceWetCoreStackOptions,
  map: ContinuityMap | null,
  structure: StructureCoverage | null,
): WetCoreStackPlacement {
  const snapText = formatLength(options.maxSnap, options.units)
  if (map === null || structure === null) {
    return {
      rule: 'centroid',
      position: { ...core.centroid },
      flagged: true,
      reason: 'office typology places stacks on core shafts only, but no continuity map is loaded; stack left at the core centroid',
    }
  }
  if (!structure.usable) {
    return {
      rule: 'centroid',
      position: { ...core.centroid },
      flagged: true,
      reason: `office typology places stacks on core shafts only, but ${structure.reason}; stack left at the core centroid`,
    }
  }
  const coreShaftRules = TYPOLOGY_PLACEMENT_RULES.office.coreShafts!
  const selection =
    options.officeCoreShafts ?? selectOfficeCoreShafts(map, core.storeyId, coreShaftRules)
  const selectedIds = new Set(selection.selected.map((candidate) => candidate.id))
  const coreShaftMap: ContinuityMap = {
    ...map,
    shaftCandidates: map.shaftCandidates.filter((candidate) => selectedIds.has(candidate.id)),
  }
  const shaft = snapCoreToShaft(core, coreShaftMap, structure.grid, options.maxSnap)
  if (shaft !== null && shaft.rule === 'shaft') {
    const verdict = selection.candidates.find((entry) => entry.candidate.id === shaft.shaftId)
    return {
      ...shaft,
      reason: `office: ${shaft.reason}${verdict === undefined ? '' : ` — ${verdict.reason}`}`,
    }
  }
  const rejected = selection.candidates.filter((entry) => !entry.selected)
  const notShaftLike = rejected.filter((entry) => !entry.shaftLike).length
  const outsideCore = rejected.length - notShaftLike
  const inRangeButBlocked = selection.selected.filter(
    (candidate) => distanceFromBounds(core.bbox, candidate.center) <= options.maxSnap,
  ).length
  return {
    rule: 'centroid',
    position: { ...core.centroid },
    flagged: true,
    reason:
      `office: no core shaft within ${snapText} of the core footprint ` +
      `(${selection.selected.length} core shaft(s) on the storey${inRangeButBlocked > 0 ? `, ${inRangeButBlocked} in range but fully obstructed` : ''}; ` +
      `${selection.candidates.length} shaft candidate(s) checked: ${notShaftLike} not shaft-like, ${outsideCore} outside the core` +
      `${selection.denseClusters.length === 0 && selection.largeVoids.length === 0 ? '; no dense-structure cluster or stair/lift void found' : ''}); ` +
      'stack left at the core centroid — needs a core shaft or a manual placement',
  }
}

// ---------------------------------------------------------------------------
// Toilet rows (G3, office): ≥ 3 same-kind fixtures roughly collinear
// ---------------------------------------------------------------------------

export type FixtureRowSideReason = 'wall-cell' | 'plan-centre' | 'core-centroid' | 'default'

/**
 * A row of same-kind fixtures inside one wet core that drains through a
 * collector running parallel to the row on its wall side. Plan axes as in
 * `Fixture.position` (x across, z down-plan); lengths in `units`.
 */
export interface FixtureRow {
  /** `row:<coreId>:<kind>:<axis>:<index>` — stable for the same members. */
  id: string
  coreId: string
  storeyId: StoreyId
  kind: FixtureKind
  /** Axis the row runs along. */
  axis: 'x' | 'z'
  /** Members ordered along the row (ascending along-coordinate, then express id). */
  memberExpressIds: number[]
  /** Perpendicular coordinate of the row line (mean of the member centres). */
  lineCoord: number
  /** Perpendicular coordinate of the collector line: `lineCoord + side × offset`. */
  collectorLineCoord: number
  /** Direction from the row toward the collector along the perpendicular axis. */
  side: 1 | -1
  sideReason: FixtureRowSideReason
  /** Extent of the members along the row axis. */
  alongMin: number
  alongMax: number
  /** Largest gap between neighbouring members along the row. */
  maxSpacing: number
  units: WetCorePlanUnits
  reason: string
}

export interface DetectFixtureRowsOptions {
  units: WetCorePlanUnits
  /** Row rules in METRES (converted to `units`); defaults to the office table. */
  rules?: RowCollectorRules
  /** Continuity map for the wall-side decision (wall/column cells); optional. */
  continuityMap?: ContinuityMap | null
  /** Storey plan bounds for the plan-centre fallback; optional. */
  floorPlanBounds?: PlanBounds | null
}

/**
 * Detects rows inside a wet core: for every fixture kind with ≥ `minFixtures`
 * members, fixtures whose centres scatter ≤ `collinearityTolerance` around a
 * line parallel to a plan axis and whose neighbours along that line are ≤
 * `maxSpacing` apart. Each fixture joins at most one row (larger rows first,
 * x-rows before z-rows, then lower along-coordinate). The collector sits on
 * the wall side: the side (perpendicular to the row) with the nearest
 * wall/column cell of the continuity grid within `wallSearch` of the row line;
 * else the side away from the storey plan centre; else away from the core
 * centroid; else +. Pure and deterministic.
 */
export function detectFixtureRows(core: WetCore, options: DetectFixtureRowsOptions): FixtureRow[] {
  const rules = options.rules ?? TYPOLOGY_PLACEMENT_RULES.office.rowCollectors!
  const scale = options.units === 'mm' ? 1000 : 1
  const tolerance = rules.collinearityToleranceM * scale
  const maxSpacing = rules.maxSpacingM * scale
  const offset = rules.collectorOffsetM * scale
  const wallSearch = rules.wallSearchM * scale

  const byKind = new Map<FixtureKind, PositionedFixture[]>()
  for (const member of core.members) {
    const list = byKind.get(member.kind)
    if (list === undefined) byKind.set(member.kind, [member as PositionedFixture])
    else list.push(member as PositionedFixture)
  }

  interface RowCandidate {
    kind: FixtureKind
    axis: 'x' | 'z'
    members: PositionedFixture[]
    lineCoord: number
    alongMin: number
    alongMax: number
    maxSpacing: number
  }
  const candidates: RowCandidate[] = []
  for (const kind of [...byKind.keys()].sort()) {
    const members = byKind.get(kind)!
    if (members.length < rules.minFixtures) continue
    for (const axis of ['x', 'z'] as const) {
      const perp = (fixture: PositionedFixture) => (axis === 'x' ? fixture.position.z : fixture.position.x)
      const along = (fixture: PositionedFixture) => (axis === 'x' ? fixture.position.x : fixture.position.z)
      const byPerp = [...members].sort((a, b) => perp(a) - perp(b) || a.expressId - b.expressId)
      // Cluster on the perpendicular coordinate (running mean within tolerance).
      const clusters: PositionedFixture[][] = []
      for (const fixture of byPerp) {
        const current = clusters[clusters.length - 1]
        if (current !== undefined) {
          const mean = current.reduce((sum, f) => sum + perp(f), 0) / current.length
          if (Math.abs(perp(fixture) - mean) <= tolerance) {
            current.push(fixture)
            continue
          }
        }
        clusters.push([fixture])
      }
      for (const cluster of clusters) {
        const ordered = [...cluster].sort((a, b) => along(a) - along(b) || a.expressId - b.expressId)
        let run: PositionedFixture[] = []
        const flush = () => {
          if (run.length >= rules.minFixtures) {
            let spacing = 0
            for (let i = 1; i < run.length; i++) spacing = Math.max(spacing, along(run[i]) - along(run[i - 1]))
            candidates.push({
              kind,
              axis,
              members: run,
              lineCoord: run.reduce((sum, f) => sum + perp(f), 0) / run.length,
              alongMin: along(run[0]),
              alongMax: along(run[run.length - 1]),
              maxSpacing: spacing,
            })
          }
          run = []
        }
        for (const fixture of ordered) {
          if (run.length > 0 && along(fixture) - along(run[run.length - 1]) > maxSpacing) flush()
          run.push(fixture)
        }
        flush()
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      (a.axis === b.axis ? 0 : a.axis === 'x' ? -1 : 1) ||
      a.alongMin - b.alongMin ||
      a.lineCoord - b.lineCoord ||
      a.kind.localeCompare(b.kind),
  )

  const used = new Set<number>()
  const rows: FixtureRow[] = []
  const grid = resolveGrid(options.continuityMap ?? null, core.storeyId, options.units)
  for (const candidate of candidates) {
    if (candidate.members.some((member) => used.has(member.expressId))) continue
    for (const member of candidate.members) used.add(member.expressId)
    const side = chooseRowCollectorSide(core, candidate, grid, wallSearch, options.floorPlanBounds ?? null)
    const index = rows.filter((row) => row.kind === candidate.kind && row.axis === candidate.axis).length
    rows.push({
      id: `row:${core.id}:${candidate.kind}:${candidate.axis}:${index}`,
      coreId: core.id,
      storeyId: core.storeyId,
      kind: candidate.kind,
      axis: candidate.axis,
      memberExpressIds: candidate.members.map((member) => member.expressId),
      lineCoord: candidate.lineCoord,
      collectorLineCoord: candidate.lineCoord + side.side * offset,
      side: side.side,
      sideReason: side.reason,
      alongMin: candidate.alongMin,
      alongMax: candidate.alongMax,
      maxSpacing: candidate.maxSpacing,
      units: options.units,
      reason:
        `${candidate.members.length} ${candidate.kind} in a row along ${candidate.axis} ` +
        `(${formatLength(candidate.alongMax - candidate.alongMin, options.units)} long, max spacing ${formatLength(candidate.maxSpacing, options.units)}); ` +
        `collector ${formatLength(offset, options.units)} on the ${side.side > 0 ? '+' : '−'}${candidate.axis === 'x' ? 'z' : 'x'} side — ${side.text}`,
    })
  }
  return rows
}

function resolveGrid(map: ContinuityMap | null, storeyId: StoreyId, units: WetCorePlanUnits): StoreyObstructionGrid | null {
  if (map === null || map.units !== units) return null
  const grid = map.grids.find((candidate) => candidate.storeyId === storeyId)
  return grid !== undefined && grid.columns > 0 && grid.rows > 0 ? grid : null
}

/**
 * Wall side of a row: probe outward from the row line in both perpendicular
 * directions (at every member's along-coordinate) for the nearest wall/column
 * cell within `wallSearch`; the side with the nearer hit wins. Fallbacks in
 * order: away from the storey plan centre, away from the core centroid, +.
 */
function chooseRowCollectorSide(
  core: WetCore,
  row: { axis: 'x' | 'z'; lineCoord: number; members: PositionedFixture[] },
  grid: StoreyObstructionGrid | null,
  wallSearch: number,
  floorPlanBounds: PlanBounds | null,
): { side: 1 | -1; reason: FixtureRowSideReason; text: string } {
  const perpAxis: 'x' | 'z' = row.axis === 'x' ? 'z' : 'x'
  if (grid !== null) {
    // Probe from the row line itself (not the core bbox edge) so a second row
    // inside the same core is not pulled towards the first row's wall. For a
    // single row the line and the bbox edge coincide. A tie (the fixtures sit
    // inside a wall cell themselves) falls through to the geometric rules.
    let nearestMinus: number | null = null
    let nearestPlus: number | null = null
    for (const member of row.members) {
      const along = row.axis === 'x' ? member.position.x : member.position.z
      const origin: PlanPoint = perpAxis === 'z' ? { x: along, z: row.lineCoord } : { x: row.lineCoord, z: along }
      const minus = probeStructureAlongAxis(grid, origin, perpAxis, -1, wallSearch)
      const plus = probeStructureAlongAxis(grid, origin, perpAxis, 1, wallSearch)
      if (minus !== null && (nearestMinus === null || minus < nearestMinus)) nearestMinus = minus
      if (plus !== null && (nearestPlus === null || plus < nearestPlus)) nearestPlus = plus
    }
    if (nearestMinus !== null && (nearestPlus === null || nearestMinus < nearestPlus)) {
      return { side: -1, reason: 'wall-cell', text: `wall cell ${nearestMinus.toFixed(2)} beyond the row on the ${perpAxis === 'z' ? 'minZ' : 'minX'} edge` }
    }
    if (nearestPlus !== null && (nearestMinus === null || nearestPlus < nearestMinus)) {
      return { side: 1, reason: 'wall-cell', text: `wall cell ${nearestPlus.toFixed(2)} beyond the row on the ${perpAxis === 'z' ? 'maxZ' : 'maxX'} edge` }
    }
  }
  if (floorPlanBounds !== null && isFiniteBounds(floorPlanBounds)) {
    const centre = perpAxis === 'z' ? (floorPlanBounds.minZ + floorPlanBounds.maxZ) / 2 : (floorPlanBounds.minX + floorPlanBounds.maxX) / 2
    if (row.lineCoord !== centre) {
      const side: 1 | -1 = row.lineCoord > centre ? 1 : -1
      return { side, reason: 'plan-centre', text: `no wall cell within reach${grid === null ? ' (no grid)' : ''}; side away from the storey plan centre` }
    }
  }
  const centroid = perpAxis === 'z' ? core.centroid.z : core.centroid.x
  if (row.lineCoord !== centroid) {
    const side: 1 | -1 = row.lineCoord > centroid ? 1 : -1
    return { side, reason: 'core-centroid', text: 'no wall cell and no plan bounds; side away from the core centroid' }
  }
  return { side: 1, reason: 'default', text: 'no wall cell, no plan bounds and the row is at the core centre; + side by convention' }
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
