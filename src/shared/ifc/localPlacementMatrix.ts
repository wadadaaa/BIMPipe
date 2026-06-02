import { Matrix4, Vector3 } from 'three'
import type { IfcAPI } from 'web-ifc'

type IfcHandle = { type: 5; value: number }

/**
 * Resolves the world-space transform of an `IfcLocalPlacement` by walking its `PlacementRelTo`
 * chain. `visited` guards against circular chains in malformed IFC files (which would otherwise
 * overflow the stack during export).
 */
export function resolveLocalPlacementWorldMatrix(
  api: IfcAPI,
  modelId: number,
  placementId: number,
  visited: Set<number> = new Set(),
): Matrix4 {
  if (visited.has(placementId)) {
    throw new Error(`Circular IfcLocalPlacement chain detected at #${placementId}.`)
  }
  visited.add(placementId)

  const placement = api.GetLine(modelId, placementId, false) as {
    PlacementRelTo?: IfcHandle | null
    RelativePlacement?: IfcHandle | null
  } | null
  if (!placement) throw new Error(`Missing IfcLocalPlacement #${placementId}.`)

  const parentMatrix =
    placement.PlacementRelTo?.value != null
      ? resolveLocalPlacementWorldMatrix(api, modelId, placement.PlacementRelTo.value, visited)
      : new Matrix4()

  const relativePlacementId = placement.RelativePlacement?.value ?? null
  if (relativePlacementId === null) return parentMatrix

  return parentMatrix.multiply(resolveAxisPlacementMatrix(api, modelId, relativePlacementId))
}

export function resolveAxisPlacementMatrix(api: IfcAPI, modelId: number, placementId: number): Matrix4 {
  const placement = api.GetLine(modelId, placementId, false) as {
    Location?: IfcHandle | null
    Axis?: IfcHandle | null
    RefDirection?: IfcHandle | null
  } | null
  if (!placement) throw new Error(`Missing axis placement #${placementId}.`)

  const location = readCoordinates(api, modelId, placement.Location?.value ?? null, [0, 0, 0])
  const zAxis = readDirection(api, modelId, placement.Axis?.value ?? null, new Vector3(0, 0, 1))
  const xHint = readDirection(api, modelId, placement.RefDirection?.value ?? null, new Vector3(1, 0, 0))
  const yAxis = new Vector3().crossVectors(zAxis, xHint).normalize()
  const xAxis = new Vector3().crossVectors(yAxis, zAxis).normalize()

  const matrix = new Matrix4()
  matrix.makeBasis(xAxis, yAxis, zAxis)
  matrix.setPosition(location)
  return matrix
}

export function readCoordinates(
  api: IfcAPI,
  modelId: number,
  pointId: number | null,
  fallback: [number, number, number],
): Vector3 {
  if (pointId === null) return new Vector3(...fallback)
  const point = api.GetLine(modelId, pointId, false) as {
    Coordinates?: Array<{ value?: number } | number> | null
  } | null
  const coords = (point?.Coordinates ?? []).map((value) => Number((value as { value?: number })?.value ?? value))
  return new Vector3(
    Number.isFinite(coords[0]) ? coords[0] : fallback[0],
    Number.isFinite(coords[1]) ? coords[1] : fallback[1],
    Number.isFinite(coords[2]) ? coords[2] : fallback[2],
  )
}

export function readDirection(
  api: IfcAPI,
  modelId: number,
  directionId: number | null,
  fallback: Vector3,
): Vector3 {
  if (directionId === null) return fallback.clone()
  const direction = api.GetLine(modelId, directionId, false) as {
    DirectionRatios?: Array<{ value?: number } | number> | null
  } | null
  const ratios = (direction?.DirectionRatios ?? []).map((value) => Number((value as { value?: number })?.value ?? value))
  const vector = new Vector3(
    Number.isFinite(ratios[0]) ? ratios[0] : fallback.x,
    Number.isFinite(ratios[1]) ? ratios[1] : fallback.y,
    Number.isFinite(ratios[2]) ? ratios[2] : fallback.z,
  )
  return vector.lengthSq() > 1e-9 ? vector.normalize() : fallback.clone()
}
