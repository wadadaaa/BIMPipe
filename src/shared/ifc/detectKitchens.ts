import type { IfcAPI } from 'web-ifc'
import type { KitchenArea, PlanBounds, StoreyId } from '@/domain/types'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'
import { getIfcElementPosition } from './detectFixtures'

const KITCHEN_PATTERN = /kitchen(?:ette)?|מטבח/i

export async function detectKitchens(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<KitchenArea[]> {
  const { IFCSPACE } = await import('web-ifc')
  const { spatialNodeIds } = await collectSpatialTreeElements(api, webIfcModelId, storeyId)
  const ids = api.GetLineIDsWithType(webIfcModelId, IFCSPACE)
  const kitchens: KitchenArea[] = []

  for (let i = 0; i < ids.size(); i++) {
    const expressId = ids.get(i)
    if (!spatialNodeIds.has(expressId)) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = api.GetLine(webIfcModelId, expressId, false) as any
    if (!line) continue

    const searchText = [
      line.Name?.value,
      line.LongName?.value,
      line.ObjectType?.value,
      line.Description?.value,
      line.Tag?.value,
    ]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' ')

    if (!KITCHEN_PATTERN.test(searchText)) continue

    const basePosition = getIfcElementPosition(api, webIfcModelId, expressId)
    const planLayout = getIfcElementPlanLayout(api, webIfcModelId, expressId)
    const kitchen: KitchenArea = {
      expressId,
      name: line.LongName?.value ?? line.Name?.value ?? `Kitchen ${expressId}`,
      storeyId,
      position:
        planLayout !== null
          ? { x: planLayout.centerX, y: basePosition?.y ?? 0, z: planLayout.centerZ }
          : basePosition,
    }

    if (planLayout !== null) {
      kitchen.planBounds = planLayout.planBounds
      kitchen.planCorners = planLayout.planCorners
    }

    kitchens.push(kitchen)
  }

  return kitchens.sort((a, b) => a.expressId - b.expressId)
}

function getIfcElementPlanLayout(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): { centerX: number; centerZ: number; planBounds: PlanBounds; planCorners: Array<{ x: number; z: number }> } | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    const points: Array<{ x: number; z: number }> = []

    for (let i = 0; i < flatMesh.geometries.size(); i++) {
      const placed = flatMesh.geometries.get(i)
      const geometry = api.GetGeometry(webIfcModelId, placed.geometryExpressID)
      const rawVerts = api.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      )
      geometry.delete()

      const matrix = placed.flatTransformation
      for (let j = 0; j < rawVerts.length; j += 6) {
        const localX = rawVerts[j]
        const localY = rawVerts[j + 1]
        const localZ = rawVerts[j + 2]
        const worldX = matrix[0] * localX + matrix[4] * localY + matrix[8] * localZ + matrix[12]
        const worldZ = matrix[2] * localX + matrix[6] * localY + matrix[10] * localZ + matrix[14]
        points.push({ x: worldX, z: worldZ })
      }
    }

    if (points.length < 3) return null
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity

    for (const point of points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.z < minZ) minZ = point.z
      if (point.z > maxZ) maxZ = point.z
    }

    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return null
    const planCorners = computeConvexHull(points)
    if (planCorners.length < 3) return null

    const { x: centerX, z: centerZ } = computePolygonCentroid(planCorners)

    return {
      centerX,
      centerZ,
      planBounds: { minX, maxX, minZ, maxZ },
      planCorners,
    }
  } catch {
    return null
  }
}

function computeConvexHull(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const unique = dedupePoints(points)
    .sort((left, right) => (left.x === right.x ? left.z - right.z : left.x - right.x))
  if (unique.length <= 2) return unique

  const lower: Array<{ x: number; z: number }> = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Array<{ x: number; z: number }> = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function dedupePoints(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const seen = new Set<string>()
  const unique: Array<{ x: number; z: number }> = []

  for (const point of points) {
    const key = `${point.x.toFixed(4)}:${point.z.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(point)
  }

  return unique
}

function cross(
  a: { x: number; z: number },
  b: { x: number; z: number },
  c: { x: number; z: number },
): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
}

function computePolygonCentroid(points: Array<{ x: number; z: number }>): { x: number; z: number } {
  let area = 0
  let cx = 0
  let cz = 0

  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    const factor = current.x * next.z - next.x * current.z
    area += factor
    cx += (current.x + next.x) * factor
    cz += (current.z + next.z) * factor
  }

  if (Math.abs(area) < 1e-6) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
    }
  }

  return {
    x: cx / (3 * area),
    z: cz / (3 * area),
  }
}
