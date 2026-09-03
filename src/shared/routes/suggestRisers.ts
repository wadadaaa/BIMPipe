import type { Fixture, KitchenArea, PlanBounds, StoreyId } from '@/domain/types'
import { snapPointToContinuity, type ContinuityMap } from '@/domain/continuityMap'
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
