import { Matrix4, Vector3 } from 'three'
import type { IfcAPI } from 'web-ifc'
import type {
  EngineerPipeNetwork,
  EngineerPipeSegment,
  EngineerPoint3,
  EngineerStoreyRef,
} from '@/domain/engineerPipes'
import type { StoreyId } from '@/domain/types'
import {
  readCoordinates,
  readDirection,
  resolveLocalPlacementWorldMatrix,
} from './localPlacementMatrix'

/**
 * Extraction of the engineer plumbing baseline from a plumbing IFC.
 *
 * Collects IfcFlowSegment/IfcPipeSegment occurrences whose owning IfcSystem
 * name starts with one of the requested prefixes, with:
 * - centreline endpoints in SOURCE model coordinates from the extrusion axis
 *   (IfcExtrudedAreaSolid position + direction + depth through the local
 *   placement chain), falling back to filtered mesh bounds,
 * - outer diameter from IfcCircleProfileDef (explicitly converted to mm),
 * - `Length` / `InvertElevation` from Pset_FlowSegmentPipeSegment (converted
 *   to metres; absent values surface as null, never fabricated),
 * - containing storey and owning IfcSystem name.
 *
 * Known approximations (documented, not silent):
 * - IfcMappedItem representations are resolved one level deep with the
 *   composition `MappingTarget × MappingOrigin`; nested maps fall back to
 *   mesh bounds.
 * - The mesh-bounds fallback returns the bounding-box centreline along the
 *   longest box axis, after dropping stray world-origin vertices; diameters
 *   are not inferred from meshes (null).
 */

const PSET_FLOW_SEGMENT_PIPE_SEGMENT = 'Pset_FlowSegmentPipeSegment'

export interface ExtractEngineerPipeNetworkOptions {
  /**
   * Segments are kept when their owning IfcSystem name starts with any of
   * these prefixes (case-insensitive, trimmed), e.g. ['SW-GRV'] or
   * ['SW-GRV', 'VNT'].
   */
  systemPrefixes: readonly string[]
}

interface IfcHandle {
  value?: number
}

// web-ifc lines are dynamically shaped; this module isolates the `any` boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IfcLine = any

const SI_PREFIX_FACTORS: Record<string, number> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
}

/**
 * Resolves the model length unit as metres-per-source-unit from IfcSIUnit.
 * Throws an explicit error for missing, ambiguous, or non-SI length units —
 * per the repo unknown-unit policy, units are never assumed.
 */
export async function resolveMetersPerSourceUnit(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<number> {
  const { IFCSIUNIT, IFCCONVERSIONBASEDUNIT } = await import('web-ifc')

  const factors = new Set<number>()
  const siUnitIds = api.GetLineIDsWithType(webIfcModelId, IFCSIUNIT)
  for (let i = 0; i < siUnitIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, siUnitIds.get(i), false) as IfcLine
    if (line?.UnitType?.value !== 'LENGTHUNIT') continue
    if (line?.Name?.value !== 'METRE') {
      throw new Error(`Unsupported SI length unit base "${line?.Name?.value}" (expected METRE).`)
    }
    const prefix: string | null = line?.Prefix?.value ?? null
    const factor = prefix === null ? 1 : SI_PREFIX_FACTORS[prefix]
    if (factor === undefined) {
      throw new Error(`Unsupported SI length unit prefix "${prefix}".`)
    }
    factors.add(factor)
  }

  if (factors.size === 1) return [...factors][0]
  if (factors.size > 1) {
    throw new Error(
      `Ambiguous length unit: found ${factors.size} distinct SI length factors in the model.`,
    )
  }

  const conversionIds = api.GetLineIDsWithType(webIfcModelId, IFCCONVERSIONBASEDUNIT)
  for (let i = 0; i < conversionIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, conversionIds.get(i), false) as IfcLine
    if (line?.UnitType?.value === 'LENGTHUNIT') {
      throw new Error(
        `Unsupported conversion-based length unit "${line?.Name?.value ?? 'unknown'}"; only SI metre-based units are handled.`,
      )
    }
  }

  throw new Error('No SI length unit found in the model; cannot convert lengths.')
}

async function readStoreys(api: IfcAPI, webIfcModelId: number): Promise<EngineerStoreyRef[]> {
  const { IFCBUILDINGSTOREY } = await import('web-ifc')
  const storeys: EngineerStoreyRef[] = []
  const ids = api.GetLineIDsWithType(webIfcModelId, IFCBUILDINGSTOREY)
  for (let i = 0; i < ids.size(); i++) {
    const expressId = ids.get(i) as StoreyId
    const line = api.GetLine(webIfcModelId, expressId, false) as IfcLine
    storeys.push({
      id: expressId,
      name: line?.Name?.value ?? line?.LongName?.value ?? `Storey ${expressId}`,
      elevationSource: Number(line?.Elevation?.value ?? 0),
    })
  }
  return storeys.sort((a, b) => a.elevationSource - b.elevationSource)
}

function readHandleIds(refs: unknown): number[] {
  if (!Array.isArray(refs)) return []
  const ids: number[] = []
  for (const ref of refs) {
    const id = (ref as IfcHandle)?.value
    if (typeof id === 'number') ids.push(id)
  }
  return ids
}

/**
 * Maps each element to its containing IfcBuildingStorey by following
 * IfcRelContainedInSpatialStructure and walking IfcRelAggregates upward when
 * the containing structure is a nested spatial node (e.g. a space).
 */
async function buildElementStoreyMap(
  api: IfcAPI,
  webIfcModelId: number,
  storeyIds: Set<number>,
): Promise<Map<number, StoreyId>> {
  const { IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELAGGREGATES } = await import('web-ifc')

  const childToParent = new Map<number, number>()
  const aggregateIds = api.GetLineIDsWithType(webIfcModelId, IFCRELAGGREGATES)
  for (let i = 0; i < aggregateIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, aggregateIds.get(i), false) as IfcLine
    const parentId = (line?.RelatingObject as IfcHandle)?.value
    if (typeof parentId !== 'number') continue
    for (const childId of readHandleIds(line?.RelatedObjects)) {
      if (!childToParent.has(childId)) childToParent.set(childId, parentId)
    }
  }

  const resolveStorey = (structureId: number): StoreyId | null => {
    let current: number | undefined = structureId
    const visited = new Set<number>()
    while (current !== undefined && !visited.has(current)) {
      if (storeyIds.has(current)) return current as StoreyId
      visited.add(current)
      current = childToParent.get(current)
    }
    return null
  }

  const elementToStorey = new Map<number, StoreyId>()
  const containedIds = api.GetLineIDsWithType(webIfcModelId, IFCRELCONTAINEDINSPATIALSTRUCTURE)
  for (let i = 0; i < containedIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, containedIds.get(i), false) as IfcLine
    const structureId = (line?.RelatingStructure as IfcHandle)?.value
    if (typeof structureId !== 'number') continue
    const storeyId = resolveStorey(structureId)
    if (storeyId === null) continue
    for (const elementId of readHandleIds(line?.RelatedElements)) {
      if (!elementToStorey.has(elementId)) elementToStorey.set(elementId, storeyId)
    }
  }

  return elementToStorey
}

/**
 * Maps each grouped element to its IfcSystem names (sorted for determinism).
 * Only groups that are IfcSystem (or IfcDistributionSystem) are considered.
 */
async function buildElementSystemNamesMap(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<Map<number, string[]>> {
  const { IFCRELASSIGNSTOGROUP, IFCSYSTEM, IFCDISTRIBUTIONSYSTEM } = await import('web-ifc')
  const systemTypes = new Set<number>([IFCSYSTEM, IFCDISTRIBUTIONSYSTEM])

  const groupNameCache = new Map<number, string | null>()
  const readSystemName = (groupId: number): string | null => {
    if (groupNameCache.has(groupId)) return groupNameCache.get(groupId)!
    let name: string | null = null
    try {
      if (systemTypes.has(api.GetLineType(webIfcModelId, groupId))) {
        const line = api.GetLine(webIfcModelId, groupId, false) as IfcLine
        name = line?.Name?.value ?? null
      }
    } catch {
      name = null
    }
    groupNameCache.set(groupId, name)
    return name
  }

  const elementToSystems = new Map<number, string[]>()
  const relIds = api.GetLineIDsWithType(webIfcModelId, IFCRELASSIGNSTOGROUP)
  for (let i = 0; i < relIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, relIds.get(i), false) as IfcLine
    const groupId = (line?.RelatingGroup as IfcHandle)?.value
    if (typeof groupId !== 'number') continue
    const systemName = readSystemName(groupId)
    if (systemName === null) continue
    for (const elementId of readHandleIds(line?.RelatedObjects)) {
      const names = elementToSystems.get(elementId) ?? []
      names.push(systemName)
      elementToSystems.set(elementId, names)
    }
  }

  for (const names of elementToSystems.values()) names.sort((a, b) => a.localeCompare(b))
  return elementToSystems
}

interface PipePsetValues {
  lengthSource: number | null
  invertElevationSource: number | null
}

/** Reads Length / InvertElevation (in SOURCE units) for the candidate pipes. */
async function buildPipePsetMap(
  api: IfcAPI,
  webIfcModelId: number,
  candidateIds: Set<number>,
): Promise<Map<number, PipePsetValues>> {
  const { IFCRELDEFINESBYPROPERTIES, IFCPROPERTYSET, IFCPROPERTYSINGLEVALUE } = await import(
    'web-ifc'
  )

  const psetMap = new Map<number, PipePsetValues>()
  const relIds = api.GetLineIDsWithType(webIfcModelId, IFCRELDEFINESBYPROPERTIES)
  for (let i = 0; i < relIds.size(); i++) {
    const rel = api.GetLine(webIfcModelId, relIds.get(i), false) as IfcLine
    const relatedIds = readHandleIds(rel?.RelatedObjects).filter((id) => candidateIds.has(id))
    if (relatedIds.length === 0) continue

    const definitionId = (rel?.RelatingPropertyDefinition as IfcHandle)?.value
    if (typeof definitionId !== 'number') continue
    if (api.GetLineType(webIfcModelId, definitionId) !== IFCPROPERTYSET) continue
    const pset = api.GetLine(webIfcModelId, definitionId, false) as IfcLine
    if (pset?.Name?.value !== PSET_FLOW_SEGMENT_PIPE_SEGMENT) continue

    let lengthSource: number | null = null
    let invertElevationSource: number | null = null
    for (const propertyId of readHandleIds(pset?.HasProperties)) {
      if (api.GetLineType(webIfcModelId, propertyId) !== IFCPROPERTYSINGLEVALUE) continue
      const property = api.GetLine(webIfcModelId, propertyId, false) as IfcLine
      const propertyName: string | undefined = property?.Name?.value
      const rawValue = property?.NominalValue?.value
      const numericValue = typeof rawValue === 'number' ? rawValue : null
      if (propertyName === 'Length') lengthSource = numericValue
      if (propertyName === 'InvertElevation') invertElevationSource = numericValue
    }

    for (const elementId of relatedIds) {
      const existing = psetMap.get(elementId) ?? { lengthSource: null, invertElevationSource: null }
      psetMap.set(elementId, {
        lengthSource: existing.lengthSource ?? lengthSource,
        invertElevationSource: existing.invertElevationSource ?? invertElevationSource,
      })
    }
  }

  return psetMap
}

/**
 * Axis placement to matrix with a degenerate-hint guard: when the placement
 * Z-axis is (near-)parallel to the RefDirection hint, a fallback hint is used
 * so horizontal pipe axes never produce a NaN basis.
 */
function robustAxisPlacementMatrix(api: IfcAPI, webIfcModelId: number, placementId: number): Matrix4 {
  const placement = api.GetLine(webIfcModelId, placementId, false) as IfcLine
  const location = readCoordinates(api, webIfcModelId, (placement?.Location as IfcHandle)?.value ?? null, [0, 0, 0])
  const zAxis = readDirection(api, webIfcModelId, (placement?.Axis as IfcHandle)?.value ?? null, new Vector3(0, 0, 1))
  let xHint = readDirection(api, webIfcModelId, (placement?.RefDirection as IfcHandle)?.value ?? null, new Vector3(1, 0, 0))

  if (new Vector3().crossVectors(zAxis, xHint).lengthSq() < 1e-12) {
    xHint = Math.abs(zAxis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
  }
  const yAxis = new Vector3().crossVectors(zAxis, xHint).normalize()
  const xAxis = new Vector3().crossVectors(yAxis, zAxis).normalize()

  const matrix = new Matrix4()
  matrix.makeBasis(xAxis, yAxis, zAxis)
  matrix.setPosition(location)
  return matrix
}

interface ExtrudedSolidResult {
  /** Solid express ID. */
  solidId: number
  /** Extra transform accumulated from IfcMappedItem wrappers (identity for direct items). */
  itemMatrix: Matrix4
}

/**
 * Finds the first IfcExtrudedAreaSolid in the product's shape representations,
 * looking one level into IfcMappedItem wrappers. Deterministic: representations
 * and items are scanned in file order.
 */
function findExtrudedSolid(
  api: IfcAPI,
  webIfcModelId: number,
  representationId: number,
  typeIds: { IFCEXTRUDEDAREASOLID: number; IFCMAPPEDITEM: number },
): ExtrudedSolidResult | null {
  const productShape = api.GetLine(webIfcModelId, representationId, false) as IfcLine
  for (const shapeRepId of readHandleIds(productShape?.Representations)) {
    const shapeRep = api.GetLine(webIfcModelId, shapeRepId, false) as IfcLine
    for (const itemId of readHandleIds(shapeRep?.Items)) {
      const itemType = api.GetLineType(webIfcModelId, itemId)
      if (itemType === typeIds.IFCEXTRUDEDAREASOLID) {
        return { solidId: itemId, itemMatrix: new Matrix4() }
      }
      if (itemType !== typeIds.IFCMAPPEDITEM) continue

      const mappedItem = api.GetLine(webIfcModelId, itemId, false) as IfcLine
      const mapId = (mappedItem?.MappingSource as IfcHandle)?.value
      if (typeof mapId !== 'number') continue
      const representationMap = api.GetLine(webIfcModelId, mapId, false) as IfcLine

      const originId = (representationMap?.MappingOrigin as IfcHandle)?.value
      const originMatrix =
        typeof originId === 'number'
          ? robustAxisPlacementMatrix(api, webIfcModelId, originId)
          : new Matrix4()
      const targetId = (mappedItem?.MappingTarget as IfcHandle)?.value
      const targetMatrix =
        typeof targetId === 'number'
          ? cartesianTransformationOperatorMatrix(api, webIfcModelId, targetId)
          : new Matrix4()

      const mappedRepId = (representationMap?.MappedRepresentation as IfcHandle)?.value
      if (typeof mappedRepId !== 'number') continue
      const mappedRep = api.GetLine(webIfcModelId, mappedRepId, false) as IfcLine
      for (const mappedItemId of readHandleIds(mappedRep?.Items)) {
        if (api.GetLineType(webIfcModelId, mappedItemId) === typeIds.IFCEXTRUDEDAREASOLID) {
          return {
            solidId: mappedItemId,
            itemMatrix: new Matrix4().multiplyMatrices(targetMatrix, originMatrix),
          }
        }
      }
    }
  }
  return null
}

function cartesianTransformationOperatorMatrix(
  api: IfcAPI,
  webIfcModelId: number,
  operatorId: number,
): Matrix4 {
  const operator = api.GetLine(webIfcModelId, operatorId, false) as IfcLine
  const origin = readCoordinates(api, webIfcModelId, (operator?.LocalOrigin as IfcHandle)?.value ?? null, [0, 0, 0])
  const xAxis = readDirection(api, webIfcModelId, (operator?.Axis1 as IfcHandle)?.value ?? null, new Vector3(1, 0, 0))
  const yAxis = readDirection(api, webIfcModelId, (operator?.Axis2 as IfcHandle)?.value ?? null, new Vector3(0, 1, 0))
  const zAxis = readDirection(api, webIfcModelId, (operator?.Axis3 as IfcHandle)?.value ?? null, new Vector3(0, 0, 1))
  const scale = Number(operator?.Scale?.value ?? 1)

  const matrix = new Matrix4()
  matrix.makeBasis(xAxis.multiplyScalar(scale), yAxis.multiplyScalar(scale), zAxis.multiplyScalar(scale))
  matrix.setPosition(origin)
  return matrix
}

interface SegmentGeometry {
  start: EngineerPoint3
  end: EngineerPoint3
  endpointSource: 'extrusion-axis' | 'mesh-bounds'
  outerDiameterMm: number | null
}

function extractExtrusionAxisGeometry(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
  metersPerSourceUnit: number,
  typeIds: { IFCEXTRUDEDAREASOLID: number; IFCMAPPEDITEM: number; IFCCIRCLEPROFILEDEF: number },
): SegmentGeometry | null {
  const element = api.GetLine(webIfcModelId, expressId, false) as IfcLine
  const placementId = (element?.ObjectPlacement as IfcHandle)?.value
  const representationId = (element?.Representation as IfcHandle)?.value
  if (typeof placementId !== 'number' || typeof representationId !== 'number') return null

  const found = findExtrudedSolid(api, webIfcModelId, representationId, typeIds)
  if (found === null) return null

  const solid = api.GetLine(webIfcModelId, found.solidId, false) as IfcLine
  const positionId = (solid?.Position as IfcHandle)?.value
  const directionId = (solid?.ExtrudedDirection as IfcHandle)?.value
  const depth = Number(solid?.Depth?.value)
  if (typeof positionId !== 'number' || !Number.isFinite(depth)) return null

  const worldMatrix = resolveLocalPlacementWorldMatrix(api, webIfcModelId, placementId)
    .multiply(found.itemMatrix)
    .multiply(robustAxisPlacementMatrix(api, webIfcModelId, positionId))

  // ExtrudedDirection is expressed in the solid's position coordinate system.
  const direction = readDirection(api, webIfcModelId, directionId ?? null, new Vector3(0, 0, 1))
  const startWorld = new Vector3(0, 0, 0).applyMatrix4(worldMatrix)
  const endWorld = direction.clone().multiplyScalar(depth).applyMatrix4(worldMatrix)

  let outerDiameterMm: number | null = null
  const profileId = (solid?.SweptArea as IfcHandle)?.value
  if (typeof profileId === 'number' && api.GetLineType(webIfcModelId, profileId) === typeIds.IFCCIRCLEPROFILEDEF) {
    const profile = api.GetLine(webIfcModelId, profileId, false) as IfcLine
    const radiusSource = Number(profile?.Radius?.value)
    if (Number.isFinite(radiusSource)) {
      outerDiameterMm = radiusSource * 2 * metersPerSourceUnit * 1000
    }
  }

  return {
    start: { x: startWorld.x, y: startWorld.y, z: startWorld.z },
    end: { x: endWorld.x, y: endWorld.y, z: endWorld.z },
    endpointSource: 'extrusion-axis',
    outerDiameterMm,
  }
}

/**
 * Drops stray vertices at the world origin: points whose distance from the
 * origin is negligible (< 1e-6 x the farthest vertex) are export artifacts in
 * models placed far from the origin. When everything would be dropped, the
 * original points are kept (a legitimately origin-centred model).
 */
export function filterOriginArtifacts(points: EngineerPoint3[]): EngineerPoint3[] {
  let maxNormSq = 0
  for (const point of points) {
    const normSq = point.x * point.x + point.y * point.y + point.z * point.z
    if (normSq > maxNormSq) maxNormSq = normSq
  }
  if (maxNormSq === 0) return points

  const thresholdSq = maxNormSq * 1e-12 // (1e-6 x maxNorm)^2
  const filtered = points.filter(
    (point) => point.x * point.x + point.y * point.y + point.z * point.z > thresholdSq,
  )
  return filtered.length > 0 ? filtered : points
}

function extractMeshBoundsGeometry(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): SegmentGeometry | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    const worldPoints: EngineerPoint3[] = []
    for (let gi = 0; gi < flatMesh.geometries.size(); gi++) {
      const placed = flatMesh.geometries.get(gi)
      const t = placed.flatTransformation
      const geomData = api.GetGeometry(webIfcModelId, placed.geometryExpressID)
      const rawVerts = api.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize())
      geomData.delete()

      // Vertex stride is 6: [x, y, z, nx, ny, nz]; transform is column-major 4x4.
      for (let j = 0; j < rawVerts.length / 6; j++) {
        const lx = rawVerts[j * 6]
        const ly = rawVerts[j * 6 + 1]
        const lz = rawVerts[j * 6 + 2]
        worldPoints.push({
          x: t[0] * lx + t[4] * ly + t[8] * lz + t[12],
          y: t[1] * lx + t[5] * ly + t[9] * lz + t[13],
          z: t[2] * lx + t[6] * ly + t[10] * lz + t[14],
        })
      }
    }
    if (worldPoints.length === 0) return null

    const points = filterOriginArtifacts(worldPoints)
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const point of points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
      if (point.z < minZ) minZ = point.z
      if (point.z > maxZ) maxZ = point.z
    }

    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
    const extents: Array<{ axis: 'x' | 'y' | 'z'; size: number; min: number; max: number }> = [
      { axis: 'x', size: maxX - minX, min: minX, max: maxX },
      { axis: 'y', size: maxY - minY, min: minY, max: maxY },
      { axis: 'z', size: maxZ - minZ, min: minZ, max: maxZ },
    ]
    const dominant = extents.reduce((best, entry) => (entry.size > best.size ? entry : best))

    const start = { ...centre, [dominant.axis]: dominant.min }
    const end = { ...centre, [dominant.axis]: dominant.max }
    return { start, end, endpointSource: 'mesh-bounds', outerDiameterMm: null }
  } catch {
    return null
  }
}

/**
 * Extracts the engineer pipe network from an already-opened plumbing IFC,
 * filtered to the requested system prefixes. See module doc for guarantees.
 * Throws for unknown/ambiguous length units (never assumes).
 */
export async function extractEngineerPipeNetwork(
  api: IfcAPI,
  webIfcModelId: number,
  options: ExtractEngineerPipeNetworkOptions,
): Promise<EngineerPipeNetwork> {
  const { IFCFLOWSEGMENT, IFCPIPESEGMENT, IFCEXTRUDEDAREASOLID, IFCMAPPEDITEM, IFCCIRCLEPROFILEDEF } =
    await import('web-ifc')

  const metersPerSourceUnit = await resolveMetersPerSourceUnit(api, webIfcModelId)
  const storeys = await readStoreys(api, webIfcModelId)
  const storeyIdSet = new Set<number>(storeys.map((storey) => storey.id))
  const storeyNameById = new Map(storeys.map((storey) => [storey.id, storey.name]))

  const elementToStorey = await buildElementStoreyMap(api, webIfcModelId, storeyIdSet)
  const elementToSystems = await buildElementSystemNamesMap(api, webIfcModelId)

  const normalizedPrefixes = options.systemPrefixes.map((prefix) => prefix.trim().toUpperCase())
  const matchSystemName = (elementId: number): string | null => {
    const names = elementToSystems.get(elementId) ?? []
    for (const name of names) {
      const normalized = name.trim().toUpperCase()
      if (normalizedPrefixes.some((prefix) => normalized.startsWith(prefix))) return name
    }
    return null
  }

  const candidates: Array<{ expressId: number; systemName: string }> = []
  for (const typeConstant of [IFCFLOWSEGMENT, IFCPIPESEGMENT]) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
    for (let i = 0; i < ids.size(); i++) {
      const expressId = ids.get(i)
      const systemName = matchSystemName(expressId)
      if (systemName !== null) candidates.push({ expressId, systemName })
    }
  }
  candidates.sort((a, b) => a.expressId - b.expressId)

  const psetMap = await buildPipePsetMap(
    api,
    webIfcModelId,
    new Set(candidates.map((candidate) => candidate.expressId)),
  )

  const geometryTypeIds = { IFCEXTRUDEDAREASOLID, IFCMAPPEDITEM, IFCCIRCLEPROFILEDEF }
  const segments: EngineerPipeSegment[] = candidates.map(({ expressId, systemName }) => {
    const line = api.GetLine(webIfcModelId, expressId, false) as IfcLine
    const name: string | null = line?.Name?.value ?? null

    let geometry: SegmentGeometry | null = null
    try {
      geometry = extractExtrusionAxisGeometry(
        api,
        webIfcModelId,
        expressId,
        metersPerSourceUnit,
        geometryTypeIds,
      )
    } catch {
      geometry = null
    }
    if (geometry === null) geometry = extractMeshBoundsGeometry(api, webIfcModelId, expressId)

    const psetValues = psetMap.get(expressId) ?? { lengthSource: null, invertElevationSource: null }
    const storeyId = elementToStorey.get(expressId) ?? null

    return {
      expressId,
      name,
      systemName,
      storeyId,
      storeyName: storeyId !== null ? (storeyNameById.get(storeyId) ?? null) : null,
      start: geometry?.start ?? null,
      end: geometry?.end ?? null,
      endpointSource: geometry?.endpointSource ?? null,
      outerDiameterMm: geometry?.outerDiameterMm ?? null,
      lengthM: psetValues.lengthSource !== null ? psetValues.lengthSource * metersPerSourceUnit : null,
      invertElevationM:
        psetValues.invertElevationSource !== null
          ? psetValues.invertElevationSource * metersPerSourceUnit
          : null,
    }
  })

  return { metersPerSourceUnit, storeys, segments }
}
