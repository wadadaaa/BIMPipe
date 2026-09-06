import type { Fixture, KitchenArea, PlanBounds, StoreyId } from '@/domain/types'
import { selectOfficeCoreShafts, snapPointToContinuity, type ContinuityMap, type OfficeCoreShaftSelection } from '@/domain/continuityMap'
import { DEFAULT_BUILDING_TYPOLOGY, TYPOLOGY_PLACEMENT_RULES, type BuildingTypology } from '@/domain/typology'
import {
  clusterWetCores,
  detectFixtureRows,
  placeWetCoreStack,
  type FixtureRow,
  type WetCore,
  type WetCorePlanUnits,
  type WetCoreStackPlacement,
} from '@/domain/wetCores'
import { detectPlanUnits, planDistance, type Point3D } from './planGeometry'
import type { RiserPlacementRuleProfile } from './riserPlacementProfile'

type PositionedFixture = Fixture & { position: NonNullable<Fixture['position']> }
type PositionedKitchen = KitchenArea & { position: NonNullable<KitchenArea['position']> }

/**
 * Max snap distance for continuity snapping (mm/m constant pair). A suggested
 * riser only moves to a shaft candidate or free grid cell within this plan
 * distance of its anchor; otherwise it stays put with an explicit `snapMiss`.
 */
export const MAX_SNAP_MM = 1500
export const MAX_SNAP_M = 1.5

export interface ContinuitySnapOptions {
  /**
   * Continuity map built by `src/domain/continuityMap.ts` from the same model.
   * Must be in the same plan frame and units as the fixture positions.
   */
  map: ContinuityMap
  /** Max snap distance in millimetres. Defaults to {@link MAX_SNAP_MM}. */
  maxSnapMm?: number
}

export interface SuggestRiserOptions {
  /**
   * OFF by default (undefined). When provided, each suggestion snaps to the
   * nearest shaft candidate (preferred) or free obstruction-grid cell within
   * the max snap distance; unsnappable suggestions keep their original
   * position and carry an explicit `snapMiss` reason.
   */
  continuitySnap?: ContinuitySnapOptions
}

export type RiserContinuitySnap =
  | { status: 'snapped'; target: 'shaft'; shaftId: string; distance: number; original: Point3D }
  | {
      status: 'snapped'
      target: 'free-cell'
      cell: { col: number; row: number }
      distance: number
      original: Point3D
    }
  | { status: 'snapMiss'; reason: string }

/**
 * A suggested riser position. The `snap` field only exists when continuity
 * snapping was requested via {@link SuggestRiserOptions.continuitySnap}; with
 * the flag off the returned objects are plain `{ x, y, z }` points, identical
 * to the pre-flag behaviour.
 */
export interface SuggestedRiserPosition extends Point3D {
  snap?: RiserContinuitySnap
}

/**
 * Returns one riser candidate per toilet plus one dedicated corner riser per kitchen.
 * Non-toilet fixtures never spawn risers; they attach to the nearest riser instead
 * (see `src/domain/assignFixturesToRisers.ts`). Distances are measured on the viewer
 * plan plane: X/Z, not X/Y.
 */
export function suggestRiserPositions(
  fixtures: Fixture[],
  kitchens: KitchenArea[] = [],
  floorPlanBounds: PlanBounds | null = null,
  ruleProfile?: Partial<RiserPlacementRuleProfile> | null,
  options?: SuggestRiserOptions,
): SuggestedRiserPosition[] {
  const fixtureOffsetToleranceMm = ruleProfile?.fixtureOffsetToleranceMm ?? 450
  const positionedFixtures = fixtures.filter(
    (fixture): fixture is PositionedFixture =>
      fixture.position !== null,
  )
  const positionedKitchens = kitchens.filter(
    (kitchen): kitchen is PositionedKitchen =>
      kitchen.position !== null,
  )
  const dedicatedKitchenPositions = buildKitchenRiserPositions(positionedKitchens, floorPlanBounds, fixtureOffsetToleranceMm)

  const wcFixtures = positionedFixtures.filter((fixture) => fixture.kind === 'TOILETPAN')

  const continuitySnap = options?.continuitySnap
  if (continuitySnap !== undefined) {
    return suggestWithContinuitySnap(
      wcFixtures,
      positionedKitchens,
      dedicatedKitchenPositions,
      continuitySnap,
    )
  }

  const anchorPositions = [
    ...wcFixtures.map((fixture) => fixture.position),
    ...dedicatedKitchenPositions,
  ]
  if (anchorPositions.length === 0) return []

  return sortByDominantPlanAxis(anchorPositions).map((position) => ({ ...position }))
}

interface SnapAnchor {
  position: Point3D
  storeyId: StoreyId
}

/**
 * Flag-on path: same anchors and the same dominant-axis ordering as the
 * default path, followed by continuity snapping. Shafts win over free cells;
 * a miss keeps the anchor position and records the reason.
 */
function suggestWithContinuitySnap(
  wcFixtures: PositionedFixture[],
  positionedKitchens: PositionedKitchen[],
  dedicatedKitchenPositions: Point3D[],
  continuitySnap: ContinuitySnapOptions,
): SuggestedRiserPosition[] {
  const anchors: SnapAnchor[] = [
    ...wcFixtures.map((fixture) => ({ position: fixture.position, storeyId: fixture.storeyId })),
    // buildKitchenRiserPositions maps kitchens 1:1, so index i belongs to kitchen i.
    ...dedicatedKitchenPositions.map((position, index) => ({
      position,
      storeyId: positionedKitchens[index].storeyId,
    })),
  ]
  if (anchors.length === 0) return []

  const { map } = continuitySnap
  const maxSnapDistance =
    continuitySnap.maxSnapMm !== undefined
      ? map.units === 'mm'
        ? continuitySnap.maxSnapMm
        : continuitySnap.maxSnapMm / 1000
      : map.units === 'mm'
        ? MAX_SNAP_MM
        : MAX_SNAP_M

  return sortByDominantPlanAxisBy(anchors, (anchor) => anchor.position).map(
    ({ position, storeyId }) => {
      const outcome = snapPointToContinuity(
        map,
        storeyId,
        { x: position.x, z: position.z },
        maxSnapDistance,
      )

      if (outcome.kind === 'miss') {
        return { ...position, snap: { status: 'snapMiss', reason: outcome.reason } }
      }

      const snap: RiserContinuitySnap =
        outcome.kind === 'shaft'
          ? {
              status: 'snapped',
              target: 'shaft',
              shaftId: outcome.shaftId,
              distance: outcome.distance,
              original: { ...position },
            }
          : {
              status: 'snapped',
              target: 'free-cell',
              cell: outcome.cell,
              distance: outcome.distance,
              original: { ...position },
            }

      return { x: outcome.position.x, y: position.y, z: outcome.position.z, snap }
    },
  )
}

// ---------------------------------------------------------------------------
// Wet-core path (V3): one stack per wet core, plus one dedicated stack per kitchen
// ---------------------------------------------------------------------------

export interface WetCoreSuggestOptions {
  /** Unit of every fixture / kitchen plan coordinate. Never assumed. */
  planUnits: WetCorePlanUnits
  /**
   * W5 continuity map in the same units; when it covers the storey the
   * placement chain snaps to shafts / free cells and flags obstructed cores.
   * Null/undefined = no structure loaded → wall-side-edge rule.
   */
  continuityMap?: ContinuityMap | null
  /**
   * Snap search radius in millimetres. Defaults to the typology's snap radius:
   * {@link MAX_SNAP_MM} (1.5 m) for residential, `MAX_SNAP_OFFICE_MM` (6 m) for office.
   */
  maxSnapMm?: number
  /**
   * Building typology (G3). Omitted → `'residential'`, byte-identical to the
   * pre-typology behaviour. `'office'`: stacks snap to core shafts only
   * (`selectOfficeCoreShafts`), flagged when none is within the office snap
   * radius, and same-kind fixture rows are detected for collector routing
   * (`fixtureRows`).
   */
  typology?: BuildingTypology
}

/** One suggested stack of the wet-core path with its provenance. */
export type WetCoreSuggestedPosition =
  | (Point3D & { anchor: 'wet-core'; core: WetCore; placement: WetCoreStackPlacement })
  | (Point3D & {
      anchor: 'kitchen'
      kitchenExpressId: number
      storeyId: StoreyId
      /** Continuity snap of the kitchen corner position when a map was available. */
      snap: RiserContinuitySnap | null
    })

export interface WetCoreSuggestion {
  /** Cores first (storey, then dominant plan axis), then kitchens in the default kitchen order. */
  positions: WetCoreSuggestedPosition[]
  cores: WetCore[]
  /** Typology the rules were taken from. */
  typology: BuildingTypology
  /**
   * Office only: same-kind fixture rows inside the cores (`detectFixtureRows`),
   * to be handed to `computeBranchRoutes({ rowCollectors })`. Empty for residential.
   */
  fixtureRows: FixtureRow[]
  /** Office only: the core-shaft selection per storey that placement used. Empty for residential. */
  officeCoreShafts: OfficeCoreShaftSelection[]
  /** Explicit notes about inputs that could not be used (fixtures without positions …). */
  diagnostics: string[]
}

/**
 * Wet-core riser suggestion (V3): clusters every positioned fixture into wet
 * cores (`clusterWetCores`) and places exactly ONE stack per core through the
 * placement chain shaft → free cell → wall-side edge → flagged centroid
 * (`placeWetCoreStack`). Kitchen areas keep the dedicated outer-corner stack of
 * the toilet-anchored path (kitchen waste is its own stack); the corner is
 * snapped to the continuity map when one covers the storey, a miss keeps the
 * corner with the reason attached.
 */
export function suggestWetCoreRiserPositions(
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  floorPlanBounds: PlanBounds | null,
  ruleProfile: Partial<RiserPlacementRuleProfile> | null | undefined,
  options: WetCoreSuggestOptions,
): WetCoreSuggestion {
  const { planUnits } = options
  const typology = options.typology ?? DEFAULT_BUILDING_TYPOLOGY
  const rules = TYPOLOGY_PLACEMENT_RULES[typology]
  const map = options.continuityMap ?? null
  const maxSnap = resolveMaxSnap(planUnits, options.maxSnapMm, typology)
  const diagnostics: string[] = []

  const clustered = clusterWetCores(fixtures, { units: planUnits })
  if (clustered.skippedFixtureExpressIds.length > 0) {
    diagnostics.push(
      `${clustered.skippedFixtureExpressIds.length} fixture(s) without a plan position were not clustered: ` +
        clustered.skippedFixtureExpressIds.join(', '),
    )
  }

  // Office: core-shaft selection once per storey (pure; shared by every core on it).
  const officeCoreShafts: OfficeCoreShaftSelection[] = []
  if (rules.stackCandidates === 'core-shafts-only' && rules.coreShafts !== null && map !== null && map.units === planUnits) {
    const storeyIds = [...new Set(clustered.cores.map((core) => core.storeyId))].sort((a, b) => a - b)
    for (const storeyId of storeyIds) {
      const selection = selectOfficeCoreShafts(map, storeyId, rules.coreShafts)
      officeCoreShafts.push(selection)
      diagnostics.push(
        `office core shafts on storey ${storeyId}: ${selection.selected.length}/${selection.candidates.length} shaft candidate(s) selected ` +
          `(${selection.denseClusters.length} dense-structure cluster(s), ${selection.largeVoids.length} stair/lift void anchor(s))`,
      )
    }
  } else if (rules.stackCandidates === 'core-shafts-only') {
    diagnostics.push('office typology: no usable continuity map, so no core shafts could be selected; every stack is flagged at its core centroid')
  }

  const positions: WetCoreSuggestedPosition[] = clustered.cores.map((core) => {
    const placement = placeWetCoreStack(core, {
      units: planUnits,
      continuityMap: map,
      maxSnap,
      floorPlanBounds,
      ...(typology === DEFAULT_BUILDING_TYPOLOGY
        ? {}
        : { typology, officeCoreShafts: officeCoreShafts.find((selection) => selection.storeyId === core.storeyId) }),
    })
    return { x: placement.position.x, y: core.centroidY, z: placement.position.z, anchor: 'wet-core', core, placement }
  })

  const fixtureRows: FixtureRow[] =
    rules.rowCollectors === null
      ? []
      : clustered.cores.flatMap((core) =>
          detectFixtureRows(core, { units: planUnits, rules: rules.rowCollectors ?? undefined, continuityMap: map, floorPlanBounds }),
        )
  if (rules.rowCollectors !== null) {
    diagnostics.push(
      fixtureRows.length === 0
        ? `office typology: no fixture row of ≥ ${rules.rowCollectors.minFixtures} same-kind fixtures found; fixtures route individually`
        : `office typology: ${fixtureRows.length} fixture row(s) drain through a collector: ` +
            fixtureRows.map((row) => `${row.memberExpressIds.length}× ${row.kind} along ${row.axis} in ${row.coreId}`).join('; '),
    )
  }

  const fixtureOffsetToleranceMm = ruleProfile?.fixtureOffsetToleranceMm ?? 450
  const positionedKitchens = kitchens.filter(
    (kitchen): kitchen is PositionedKitchen => kitchen.position !== null,
  )
  const kitchenPositions = buildKitchenRiserPositions(positionedKitchens, floorPlanBounds, fixtureOffsetToleranceMm)
  kitchenPositions.forEach((position, index) => {
    const kitchen = positionedKitchens[index]
    let snap: RiserContinuitySnap | null = null
    let finalPosition = position
    if (map !== null && map.units === planUnits) {
      const outcome = snapPointToContinuity(map, kitchen.storeyId, { x: position.x, z: position.z }, maxSnap)
      if (outcome.kind === 'miss') {
        snap = { status: 'snapMiss', reason: outcome.reason }
      } else {
        snap =
          outcome.kind === 'shaft'
            ? { status: 'snapped', target: 'shaft', shaftId: outcome.shaftId, distance: outcome.distance, original: { ...position } }
            : { status: 'snapped', target: 'free-cell', cell: outcome.cell, distance: outcome.distance, original: { ...position } }
        finalPosition = { x: outcome.position.x, y: position.y, z: outcome.position.z }
      }
    }
    positions.push({
      ...finalPosition,
      anchor: 'kitchen',
      kitchenExpressId: kitchen.expressId,
      storeyId: kitchen.storeyId,
      snap,
    })
  })

  return { positions, cores: clustered.cores, typology, fixtureRows, officeCoreShafts, diagnostics }
}

function resolveMaxSnap(planUnits: WetCorePlanUnits, maxSnapMm: number | undefined, typology: BuildingTypology): number {
  if (maxSnapMm !== undefined) return planUnits === 'mm' ? maxSnapMm : maxSnapMm / 1000
  if (typology === DEFAULT_BUILDING_TYPOLOGY) return planUnits === 'mm' ? MAX_SNAP_MM : MAX_SNAP_M
  const maxSnapM = TYPOLOGY_PLACEMENT_RULES[typology].maxSnapM
  return planUnits === 'mm' ? maxSnapM * 1000 : maxSnapM
}

function buildKitchenRiserPositions(
  kitchens: PositionedKitchen[],
  floorPlanBounds: PlanBounds | null,
  fixtureOffsetToleranceMm: number,
): Point3D[] {
  if (kitchens.length === 0) return []

  const units = detectPlanUnits(kitchens.map((kitchen) => kitchen.position))
  const cornerInset = units === 'mm' ? 90 : 0.09
  const fallbackOffset = units === 'mm' ? 1200 : 1.2
  const edgeMargin = units === 'mm' ? 220 : 0.22
  const minCornerShift = units === 'mm' ? 350 : 0.35
  const minKitchenSeparation = units === 'mm' ? fixtureOffsetToleranceMm * 3.1 : 1.4

  return kitchens.map((kitchen) => {
    let candidate: Point3D

    if (floorPlanBounds === null) {
      return { ...kitchen.position }
    }

    if (!kitchen.planBounds) {
      candidate = shiftTowardExteriorCorner(kitchen.position, floorPlanBounds, fallbackOffset, edgeMargin)
      return ensureKitchenRiserSeparation(candidate, kitchen.position, floorPlanBounds, minKitchenSeparation, edgeMargin)
    }

    if (kitchen.planCorners && kitchen.planCorners.length >= 4) {
      const corner = chooseExteriorKitchenCorner(kitchen.planCorners, kitchen.position, floorPlanBounds, cornerInset)
      if (planDistance(corner, kitchen.position) >= minCornerShift) {
        candidate = corner
        return ensureKitchenRiserSeparation(candidate, kitchen.position, floorPlanBounds, minKitchenSeparation, edgeMargin)
      }
    }

    const kitchenCenterX = (kitchen.planBounds.minX + kitchen.planBounds.maxX) / 2
    const kitchenCenterZ = (kitchen.planBounds.minZ + kitchen.planBounds.maxZ) / 2
    const floorCenterX = (floorPlanBounds.minX + floorPlanBounds.maxX) / 2
    const floorCenterZ = (floorPlanBounds.minZ + floorPlanBounds.maxZ) / 2

    const cornerPosition = {
      x: resolveCornerAxis(kitchen.planBounds.minX, kitchen.planBounds.maxX, kitchenCenterX <= floorCenterX, cornerInset),
      y: kitchen.position.y,
      z: resolveCornerAxis(kitchen.planBounds.minZ, kitchen.planBounds.maxZ, kitchenCenterZ <= floorCenterZ, cornerInset),
    }

    if (planDistance(cornerPosition, kitchen.position) < minCornerShift) {
      candidate = shiftTowardExteriorCorner(kitchen.position, floorPlanBounds, fallbackOffset, edgeMargin)
      return ensureKitchenRiserSeparation(candidate, kitchen.position, floorPlanBounds, minKitchenSeparation, edgeMargin)
    }

    candidate = cornerPosition
    return ensureKitchenRiserSeparation(candidate, kitchen.position, floorPlanBounds, minKitchenSeparation, edgeMargin)
  })
}

function resolveCornerAxis(min: number, max: number, useMin: boolean, inset: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return (min + max) / 2
  if (max - min <= inset * 2) return (min + max) / 2
  return useMin ? min + inset : max - inset
}

function chooseExteriorKitchenCorner(
  planCorners: Array<{ x: number; z: number }>,
  kitchenCenter: Point3D,
  floorPlanBounds: PlanBounds,
  inset: number,
): Point3D {
  const rankedCorners = [...planCorners].sort((left, right) => {
    const edgeDelta =
      nearestFloorEdgeScore(left, floorPlanBounds) -
      nearestFloorEdgeScore(right, floorPlanBounds)
    if (Math.abs(edgeDelta) > 1e-6) return edgeDelta

    return (
      planDistance({ x: right.x, y: kitchenCenter.y, z: right.z }, kitchenCenter) -
      planDistance({ x: left.x, y: kitchenCenter.y, z: left.z }, kitchenCenter)
    )
  })

  return insetCornerTowardCenter(rankedCorners[0], kitchenCenter, inset)
}

function nearestFloorEdgeScore(point: { x: number; z: number }, floorPlanBounds: PlanBounds): number {
  return Math.min(
    Math.abs(point.x - floorPlanBounds.minX),
    Math.abs(floorPlanBounds.maxX - point.x),
  ) + Math.min(
    Math.abs(point.z - floorPlanBounds.minZ),
    Math.abs(floorPlanBounds.maxZ - point.z),
  )
}

function insetCornerTowardCenter(
  corner: { x: number; z: number },
  center: Point3D,
  inset: number,
): Point3D {
  const dx = center.x - corner.x
  const dz = center.z - corner.z
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-6) {
    return { x: corner.x, y: center.y, z: corner.z }
  }

  const step = Math.min(inset, length * 0.18)
  return {
    x: corner.x + (dx / length) * step,
    y: center.y,
    z: corner.z + (dz / length) * step,
  }
}

function shiftTowardExteriorCorner(
  point: Point3D,
  floorPlanBounds: PlanBounds,
  fallbackOffset: number,
  edgeMargin: number,
): Point3D {
  const floorCenterX = (floorPlanBounds.minX + floorPlanBounds.maxX) / 2
  const floorCenterZ = (floorPlanBounds.minZ + floorPlanBounds.maxZ) / 2
  const useMinX = point.x <= floorCenterX
  const useMinZ = point.z <= floorCenterZ
  const edgeX = useMinX ? floorPlanBounds.minX : floorPlanBounds.maxX
  const edgeZ = useMinZ ? floorPlanBounds.minZ : floorPlanBounds.maxZ
  const offsetX = Math.min(fallbackOffset, Math.max(0, Math.abs(point.x - edgeX) - edgeMargin))
  const offsetZ = Math.min(fallbackOffset, Math.max(0, Math.abs(point.z - edgeZ) - edgeMargin))

  return {
    x: useMinX ? point.x - offsetX : point.x + offsetX,
    y: point.y,
    z: useMinZ ? point.z - offsetZ : point.z + offsetZ,
  }
}

function ensureKitchenRiserSeparation(
  candidate: Point3D,
  center: Point3D,
  floorPlanBounds: PlanBounds,
  minSeparation: number,
  edgeMargin: number,
): Point3D {
  const dx = candidate.x - center.x
  const dz = candidate.z - center.z
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 1e-6) return candidate
  if (length >= minSeparation) return candidate

  const scale = minSeparation / length
  const x = center.x + dx * scale
  const z = center.z + dz * scale

  return {
    x: clamp(x, floorPlanBounds.minX + edgeMargin, floorPlanBounds.maxX - edgeMargin),
    y: candidate.y,
    z: clamp(z, floorPlanBounds.minZ + edgeMargin, floorPlanBounds.maxZ - edgeMargin),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function sortByDominantPlanAxis(points: Point3D[]): Point3D[] {
  return sortByDominantPlanAxisBy(points, (point) => point)
}

/**
 * Same ordering as {@link sortByDominantPlanAxis} but generic, so the
 * continuity-snapping path can keep storey ids attached to each anchor while
 * producing the exact same order as the default path (stable sort, same
 * comparator).
 */
function sortByDominantPlanAxisBy<T>(items: T[], getPoint: (item: T) => Point3D): T[] {
  const minX = Math.min(...items.map((item) => getPoint(item).x))
  const maxX = Math.max(...items.map((item) => getPoint(item).x))
  const minZ = Math.min(...items.map((item) => getPoint(item).z))
  const maxZ = Math.max(...items.map((item) => getPoint(item).z))
  const useZ = maxZ - minZ > maxX - minX

  return [...items].sort((left, right) => {
    const a = getPoint(left)
    const b = getPoint(right)
    const primary = useZ ? a.z - b.z : a.x - b.x
    if (primary !== 0) return primary
    return useZ ? a.x - b.x : a.z - b.z
  })
}
