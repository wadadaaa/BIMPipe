import type { Fixture, KitchenArea, PlanBounds } from '@/domain/types'
import { averagePosition, detectPlanUnits, planDistance, type Point3D } from './planGeometry'
import type { RiserPlacementRuleProfile } from './riserPlacementProfile'

interface RiserCluster {
  points: Point3D[]
  centroid: Point3D
}

type PositionedFixture = Fixture & { position: NonNullable<Fixture['position']> }
type PositionedKitchen = KitchenArea & { position: NonNullable<KitchenArea['position']> }

/**
 * Groups nearby sanitary points into wet cores and returns one riser candidate
 * per core. Distances are measured on the viewer plan plane: X/Z, not X/Y.
 */
export function suggestRiserPositions(
  fixtures: Fixture[],
  kitchens: KitchenArea[] = [],
  floorPlanBounds: PlanBounds | null = null,
  ruleProfile?: Partial<RiserPlacementRuleProfile> | null,
): Point3D[] {
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
  const points = positionedFixtures.map((fixture) => fixture.position)

  if (points.length === 0 && dedicatedKitchenPositions.length === 0) return []

  const wcFixtures = positionedFixtures.filter((fixture) => fixture.kind === 'TOILETPAN')
  if (wcFixtures.length > 0) {
    return sortByDominantPlanAxis([
      ...wcFixtures.map((fixture) => fixture.position),
      ...dedicatedKitchenPositions,
    ]).map((position) => ({
      ...position,
    }))
  }

  const clusteredFixturePoints = positionedFixtures
    .filter((fixture) => !fixture.isKitchenSink)
    .map((fixture) => fixture.position)

  if (clusteredFixturePoints.length === 0) {
    return sortByDominantPlanAxis(dedicatedKitchenPositions).map((position) => ({ ...position }))
  }

  const units = detectPlanUnits([...clusteredFixturePoints, ...dedicatedKitchenPositions])
  const maxWetCoreDiameter = units === 'mm' ? 2600 : 2.6
  const spatialClusters = buildBoundedClusters(clusteredFixturePoints, maxWetCoreDiameter)
  const targetCount = Math.min(
    clusteredFixturePoints.length,
    Math.max(spatialClusters.length, Math.ceil(clusteredFixturePoints.length / 4)),
  )

  const rawPositions =
    targetCount <= spatialClusters.length
      ? spatialClusters.map((cluster) => cluster.centroid)
      : kMeansPlan(clusteredFixturePoints, targetCount)

  return sortByDominantPlanAxis([
    ...dedicatedKitchenPositions,
    ...rawPositions,
  ]).map((position) => ({ ...position }))
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

function buildBoundedClusters(points: Point3D[], maxWetCoreDiameter: number): RiserCluster[] {
  const clusters: RiserCluster[] = []

  for (const point of sortByDominantPlanAxis(points)) {
    let nearestCluster: RiserCluster | null = null
    let nearestDistance = Infinity

    for (const cluster of clusters) {
      if (!canAddToCluster(cluster, point, maxWetCoreDiameter)) continue

      const distance = planDistance(point, cluster.centroid)
      if (distance < nearestDistance) {
        nearestCluster = cluster
        nearestDistance = distance
      }
    }

    if (nearestCluster) {
      nearestCluster.points.push(point)
      nearestCluster.centroid = averagePosition(nearestCluster.points)
      continue
    }

    clusters.push({ points: [point], centroid: { ...point } })
  }

  return clusters
}

function kMeansPlan(points: Point3D[], k: number): Point3D[] {
  const sorted = sortByDominantPlanAxis(points)
  const step = sorted.length / k
  let centroids = Array.from({ length: k }, (_, i) => ({
    ...sorted[Math.min(Math.floor(i * step + step / 2), sorted.length - 1)],
  }))

  for (let iteration = 0; iteration < 24; iteration++) {
    const clusters: Point3D[][] = Array.from({ length: k }, () => [])

    for (const point of points) {
      let nearestIndex = 0
      let nearestDistance = Infinity

      for (let i = 0; i < centroids.length; i++) {
        const distance = planDistance(point, centroids[i])
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = i
        }
      }

      clusters[nearestIndex].push(point)
    }

    let moved = false
    centroids = centroids.map((centroid, i) => {
      const cluster = clusters[i]
      if (cluster.length === 0) return centroid

      const next = averagePosition(cluster)
      if (planDistance(centroid, next) > 1e-6) moved = true
      return next
    })

    if (!moved) break
  }

  return centroids
}

function canAddToCluster(cluster: RiserCluster, point: Point3D, maxDiameter: number): boolean {
  for (const existingPoint of cluster.points) {
    if (planDistance(existingPoint, point) > maxDiameter) return false
  }
  return true
}

function sortByDominantPlanAxis(points: Point3D[]): Point3D[] {
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.z))
  const maxZ = Math.max(...points.map((point) => point.z))
  const useZ = maxZ - minZ > maxX - minX

  return [...points].sort((a, b) => {
    const primary = useZ ? a.z - b.z : a.x - b.x
    if (primary !== 0) return primary
    return useZ ? a.x - b.x : a.z - b.z
  })
}
