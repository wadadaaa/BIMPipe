import { Matrix4, Vector3 } from 'three'
import type { IfcAPI } from 'web-ifc'
import {
  ENGINEER_FITTING_MAX_PORTS,
  ENGINEER_JUNCTION_TOLERANCE_M,
  fittingConnectorExpressId,
  type EngineerEndInvertElevationsM,
  type EngineerEndpointSource,
  type EngineerPipeNetwork,
  type EngineerPipeSegment,
  type EngineerPoint3,
  type EngineerStoreyRef,
} from '@/domain/engineerPipes'
import type { StoreyId } from '@/domain/types'
import { dropIsolatedOriginVertices } from '@/shared/frame/originArtifacts'
import { toMeters } from '@/shared/lengthUnits'
import {
  readCoordinates,
  readDirection,
  resolveLocalPlacementWorldMatrix,
} from './localPlacementMatrix'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'

/**
 * Extraction of the engineer plumbing baseline from a plumbing IFC.
 *
 * Collects IfcFlowSegment/IfcPipeSegment occurrences whose owning IfcSystem
 * name starts with one of the requested prefixes, with:
 * - centreline endpoints in SOURCE model coordinates (Z-up, source length
 *   unit), derived in this order:
 *   1. `extrusion-axis`: IfcExtrudedAreaSolid position + direction + depth
 *      through the local placement chain;
 *   2. `distribution-ports`: the two IfcDistributionPort placements of the
 *      segment (Revit exports vertical pipes crossing the view range as a
 *      single cut face — no solid — but keeps full-length ports);
 *   3. `mesh-bounds`: bounding-box centreline of the tessellated mesh,
 *      mapped back from web-ifc's viewer frame (metres, Y-up) to the source
 *      frame; degenerate meshes (a flat face, no discernible axis) are left
 *      unresolved instead of becoming zero-length segments;
 * - outer diameter from IfcCircleProfileDef (explicitly converted to mm) or,
 *   for port-derived centrelines, estimated from the mesh cross-section
 *   perpendicular to the axis (rounded to 0.1 mm; null when no mesh exists),
 * - `Length` / `InvertElevation` from Pset_FlowSegmentPipeSegment (converted
 *   to metres; absent values surface as null, never fabricated),
 * - containing storey and owning IfcSystem name,
 * - a `geometrySummary` with segment counts per endpoint source and the
 *   express IDs of segments whose centreline could not be resolved,
 * - (R3) `fittingConnectors`: matching-system IfcFlowFitting / IfcPipeFitting
 *   occurrences (elbows, tees, wyes, reducers) rendered as one short connector
 *   per port, body origin → port, so a drawn network is continuous where the
 *   pipes meet through fitting bodies; with a `fittingSummary` census.
 *
 * Known approximations (documented, not silent):
 * - IfcMappedItem representations are resolved one level deep with the
 *   composition `MappingTarget × MappingOrigin`; nested maps fall back to
 *   ports / mesh bounds.
 * - The mesh-bounds fallback returns the bounding-box centreline along the
 *   longest box axis, after dropping isolated world-origin vertices (shared
 *   guard in `src/shared/frame/originArtifacts.ts`); diameters are not
 *   inferred for it (null).
 */

const PSET_FLOW_SEGMENT_PIPE_SEGMENT = 'Pset_FlowSegmentPipeSegment'

/**
 * Revit's per-end invert parameters, exported (in the model's length unit,
 * under the `Constraints` group) when "Export Revit property sets" is on.
 * Matched by property NAME in any pset attached to the pipe, because the group
 * name is a Revit UI label. Census (2026-09-07): present on 132/132 pipes of
 * the second project's sanitary model; absent from the first project's
 * plumbing model (Pset invert only) — neither file carries a
 * `Start/End Invert Elevation` pair, so no other spelling is read.
 */
const REVIT_UPPER_END_INVERT_PROPERTY = 'Upper End Invert Elevation'
const REVIT_LOWER_END_INVERT_PROPERTY = 'Lower End Invert Elevation'

/** Mesh-bounds centrelines shorter than this (in metres) are treated as unresolved. */
const MIN_MESH_BOUNDS_LENGTH_M = 0.001
/** The dominant mesh extent must exceed the second-largest by this factor to define an axis. */
const MIN_MESH_BOUNDS_ELONGATION = 1.5
/** Estimated mesh-cross-section diameters are rounded to this step (float32 vertex noise). */
const MESH_DIAMETER_ROUNDING_MM = 0.1
/** Above this vertex count the diameter estimate uses projected extents instead of pairwise distances. */
const MAX_PAIRWISE_DIAMETER_POINTS = 4096

/** Per-endpoint-source segment counts plus the unresolved set, for UI/debug output. */
export interface EngineerGeometrySummary {
  /** Number of segments per centreline source; `unresolved` = start/end are null. */
  endpointSourceCounts: Record<EngineerEndpointSource | 'unresolved', number>
  /**
   * Segments (expressId ascending) whose centreline could not be resolved,
   * each with a one-line reason (why ports and mesh bounds both failed).
   */
  unresolvedSegments: Array<{ expressId: number; reason: string }>
}

/** Outcome of one centreline strategy: geometry, or a one-line reason it did not apply. */
type GeometryAttempt = { geometry: SegmentGeometry; reason: null } | { geometry: null; reason: string }

/**
 * Fitting connector census (R3): how many matching-system IfcFlowFitting /
 * IfcPipeFitting occurrences were seen, how many connectors they yielded and
 * why the rest were skipped. Counts only — no names leave this module.
 */
export interface EngineerFittingSummary {
  /** Matching-system fitting occurrences. */
  fittings: number
  /** Connectors emitted (one per usable port). */
  connectors: number
  /** Fittings by number of ports (key = port count as text). */
  byPortCount: Record<string, number>
  /** Fittings whose placement origin was replaced by the port centroid (origin off the body). */
  originReplacedByPortCentroid: number
  /** Fittings (expressId ascending) that yielded no connector, each with a one-line reason. */
  skipped: Array<{ expressId: number; reason: string }>
}

export interface ExtractedEngineerPipeNetwork extends EngineerPipeNetwork {
  geometrySummary: EngineerGeometrySummary
  fittingConnectors: EngineerPipeSegment[]
  fittingSummary: EngineerFittingSummary
}

/**
 * A fitting whose placement origin lies farther than this from one of its
 * ports is not modelled around its body (measured: origin → port ≤ 0.22 m on
 * both client files, always inside the mesh box); the port centroid is used
 * instead and the case is counted.
 */
export const ENGINEER_FITTING_MAX_ORIGIN_REACH_M = 0.5

/** Connectors shorter than this (origin sitting on the port face) are not emitted. */
const MIN_FITTING_CONNECTOR_LENGTH_M = 0.001

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

/** Metres per unit for an IfcSIUnit LENGTHUNIT line; throws for non-metre bases and unknown prefixes. */
function siLengthUnitFactor(line: IfcLine): number {
  if (line?.Name?.value !== 'METRE') {
    throw new Error(`Unsupported SI length unit base "${line?.Name?.value}" (expected METRE).`)
  }
  const prefix: string | null = line?.Prefix?.value ?? null
  const factor = prefix === null ? 1 : SI_PREFIX_FACTORS[prefix]
  if (factor === undefined) {
    throw new Error(`Unsupported SI length unit prefix "${prefix}".`)
  }
  return factor
}

/**
 * Express ID of the LENGTHUNIT entry of `IfcProject.UnitsInContext`, or null
 * when the project has no unit assignment / no length unit in it.
 */
async function findAssignedLengthUnitId(api: IfcAPI, webIfcModelId: number): Promise<number | null> {
  const { IFCPROJECT } = await import('web-ifc')
  const projectIds = api.GetLineIDsWithType(webIfcModelId, IFCPROJECT)
  if (projectIds.size() === 0) return null

  const project = api.GetLine(webIfcModelId, projectIds.get(0), false) as IfcLine
  const assignmentId = (project?.UnitsInContext as IfcHandle)?.value
  if (typeof assignmentId !== 'number') return null

  const assignment = api.GetLine(webIfcModelId, assignmentId, false) as IfcLine
  for (const unitId of readHandleIds(assignment?.Units)) {
    const unit = api.GetLine(webIfcModelId, unitId, false) as IfcLine
    if (unit?.UnitType?.value === 'LENGTHUNIT') return unitId
  }
  return null
}

/**
 * Resolves the model length unit as metres-per-source-unit.
 *
 * Order (units are never assumed, per the repo unknown-unit policy):
 * 1. The project's unit assignment (`IfcProject.UnitsInContext` LENGTHUNIT)
 *    via the app's single unit reader `resolveModelLengthUnit`, converted
 *    with `lengthUnits.toMeters`. Files routinely declare further IfcSIUnit
 *    LENGTHUNIT lines that only serve as elements of derived units (flow
 *    rate, concentration); those must not make the model ambiguous.
 * 2. An assigned length unit the reader does not support (e.g. a DECI prefix)
 *    is resolved from the SI prefix table, or rejected explicitly when it is
 *    conversion-based (feet, inches).
 * 3. Only when the project declares no length unit at all: a global scan of
 *    IfcSIUnit LENGTHUNIT lines, which throws when THAT is ambiguous.
 */
export async function resolveMetersPerSourceUnit(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<number> {
  const assignedUnit = await resolveModelLengthUnit(api, webIfcModelId)
  if (assignedUnit !== null) return toMeters(1, assignedUnit)

  const { IFCSIUNIT, IFCCONVERSIONBASEDUNIT } = await import('web-ifc')

  const assignedUnitId = await findAssignedLengthUnitId(api, webIfcModelId)
  if (assignedUnitId !== null) {
    const line = api.GetLine(webIfcModelId, assignedUnitId, false) as IfcLine
    if (api.GetLineType(webIfcModelId, assignedUnitId) === IFCSIUNIT) {
      return siLengthUnitFactor(line)
    }
    throw new Error(
      `Unsupported conversion-based length unit "${line?.Name?.value ?? 'unknown'}" in the project unit assignment; only SI metre-based units are handled.`,
    )
  }

  const factors = new Set<number>()
  const siUnitIds = api.GetLineIDsWithType(webIfcModelId, IFCSIUNIT)
  for (let i = 0; i < siUnitIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, siUnitIds.get(i), false) as IfcLine
    if (line?.UnitType?.value !== 'LENGTHUNIT') continue
    factors.add(siLengthUnitFactor(line))
  }

  if (factors.size === 1) return [...factors][0]
  if (factors.size > 1) {
    throw new Error(
      `Ambiguous length unit: the project declares no length unit and the model has ${factors.size} distinct SI length factors.`,
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
  /** Revit `Upper End Invert Elevation` (source units); null when absent. */
  upperEndInvertSource: number | null
  /** Revit `Lower End Invert Elevation` (source units); null when absent. */
  lowerEndInvertSource: number | null
}

const EMPTY_PSET_VALUES: PipePsetValues = {
  lengthSource: null,
  invertElevationSource: null,
  upperEndInvertSource: null,
  lowerEndInvertSource: null,
}

/**
 * Reads, in SOURCE units, for the candidate pipes: `Length` / `InvertElevation`
 * from `Pset_FlowSegmentPipeSegment`, and Revit's per-end invert properties
 * from any pset attached to the pipe (see the constants above). Absent values
 * stay null; the first value seen per property wins.
 */
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
    const isStandardPipePset = pset?.Name?.value === PSET_FLOW_SEGMENT_PIPE_SEGMENT

    const found: PipePsetValues = { ...EMPTY_PSET_VALUES }
    for (const propertyId of readHandleIds(pset?.HasProperties)) {
      if (api.GetLineType(webIfcModelId, propertyId) !== IFCPROPERTYSINGLEVALUE) continue
      const property = api.GetLine(webIfcModelId, propertyId, false) as IfcLine
      const propertyName: string | undefined = property?.Name?.value
      const rawValue = property?.NominalValue?.value
      const numericValue = typeof rawValue === 'number' ? rawValue : null
      if (isStandardPipePset && propertyName === 'Length') found.lengthSource = numericValue
      if (isStandardPipePset && propertyName === 'InvertElevation') found.invertElevationSource = numericValue
      if (propertyName === REVIT_UPPER_END_INVERT_PROPERTY) found.upperEndInvertSource = numericValue
      if (propertyName === REVIT_LOWER_END_INVERT_PROPERTY) found.lowerEndInvertSource = numericValue
    }
    if (Object.values(found).every((value) => value === null)) continue

    for (const elementId of relatedIds) {
      const existing = psetMap.get(elementId) ?? EMPTY_PSET_VALUES
      psetMap.set(elementId, {
        lengthSource: existing.lengthSource ?? found.lengthSource,
        invertElevationSource: existing.invertElevationSource ?? found.invertElevationSource,
        upperEndInvertSource: existing.upperEndInvertSource ?? found.upperEndInvertSource,
        lowerEndInvertSource: existing.lowerEndInvertSource ?? found.lowerEndInvertSource,
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
  endpointSource: EngineerEndpointSource
  outerDiameterMm: number | null
}

/**
 * Maps each candidate element to its IfcDistributionPort express IDs (sorted
 * ascending for determinism). Reads both IFC2X3 `IfcRelConnectsPortToElement`
 * and IFC4 `IfcRelNests` (element nests its ports).
 */
async function buildElementPortsMap(
  api: IfcAPI,
  webIfcModelId: number,
  candidateIds: Set<number>,
): Promise<Map<number, number[]>> {
  const { IFCRELCONNECTSPORTTOELEMENT, IFCRELNESTS, IFCDISTRIBUTIONPORT } = await import('web-ifc')
  const ports = new Map<number, Set<number>>()
  const addPort = (elementId: number, portId: number): void => {
    const set = ports.get(elementId) ?? new Set<number>()
    set.add(portId)
    ports.set(elementId, set)
  }

  const connectIds = api.GetLineIDsWithType(webIfcModelId, IFCRELCONNECTSPORTTOELEMENT)
  for (let i = 0; i < connectIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, connectIds.get(i), false) as IfcLine
    const elementId = (line?.RelatedElement as IfcHandle)?.value
    const portId = (line?.RelatingPort as IfcHandle)?.value
    if (typeof elementId !== 'number' || typeof portId !== 'number') continue
    if (candidateIds.has(elementId)) addPort(elementId, portId)
  }

  const nestIds = api.GetLineIDsWithType(webIfcModelId, IFCRELNESTS)
  for (let i = 0; i < nestIds.size(); i++) {
    const line = api.GetLine(webIfcModelId, nestIds.get(i), false) as IfcLine
    const elementId = (line?.RelatingObject as IfcHandle)?.value
    if (typeof elementId !== 'number' || !candidateIds.has(elementId)) continue
    for (const relatedId of readHandleIds(line?.RelatedObjects)) {
      let isPort = false
      try {
        isPort = api.GetLineType(webIfcModelId, relatedId) === IFCDISTRIBUTIONPORT
      } catch {
        isPort = false
      }
      if (isPort) addPort(elementId, relatedId)
    }
  }

  const result = new Map<number, number[]>()
  for (const [elementId, portIds] of ports) result.set(elementId, [...portIds].sort((a, b) => a - b))
  return result
}

/**
 * Maps a web-ifc mesh vertex (viewer frame: metres, Y-up, z = −IFC Y) back to
 * the IFC source frame (source units, Z-up). Inverse of
 * `ifcSourceToViewerPoint` in `src/shared/frame/ifcSourceFrame.ts`.
 */
function viewerToSourcePoint(x: number, y: number, z: number, metersPerSourceUnit: number): EngineerPoint3 {
  return { x: x / metersPerSourceUnit, y: -z / metersPerSourceUnit, z: y / metersPerSourceUnit }
}

/**
 * All mesh vertices of an element in SOURCE coordinates, after the shared
 * origin-artifact guard. Null when the element has no tessellated geometry.
 */
function readMeshSourcePoints(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
  metersPerSourceUnit: number,
): EngineerPoint3[] | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    const points: EngineerPoint3[] = []
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
        points.push(
          viewerToSourcePoint(
            t[0] * lx + t[4] * ly + t[8] * lz + t[12],
            t[1] * lx + t[5] * ly + t[9] * lz + t[13],
            t[2] * lx + t[6] * ly + t[10] * lz + t[14],
            metersPerSourceUnit,
          ),
        )
      }
    }
    if (points.length === 0) return null
    return filterOriginArtifacts(points)
  } catch {
    return null
  }
}

/**
 * Estimates the outer diameter (mm) of a pipe from its mesh vertices projected
 * onto the plane perpendicular to the centreline axis: the largest projected
 * extent. Exact for circles tessellated with an even vertex count (opposite
 * vertices span the diameter); rounded to 0.1 mm to absorb float32 vertex
 * noise. Null when the mesh has too few points or the extent is below 1 mm.
 */
function estimateDiameterFromMeshCrossSection(
  points: readonly EngineerPoint3[],
  axis: Vector3,
  metersPerSourceUnit: number,
): number | null {
  if (points.length < 3 || axis.lengthSq() < 1e-12) return null
  const zAxis = axis.clone().normalize()
  const hint = Math.abs(zAxis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
  const u = new Vector3().crossVectors(zAxis, hint).normalize()
  const v = new Vector3().crossVectors(zAxis, u).normalize()

  const projected: Array<[number, number]> = points.map((point) => {
    const p = new Vector3(point.x, point.y, point.z)
    return [p.dot(u), p.dot(v)]
  })

  let extentSource = 0
  if (projected.length <= MAX_PAIRWISE_DIAMETER_POINTS) {
    for (let i = 0; i < projected.length; i++) {
      for (let j = i + 1; j < projected.length; j++) {
        const du = projected[i][0] - projected[j][0]
        const dv = projected[i][1] - projected[j][1]
        const distance = Math.sqrt(du * du + dv * dv)
        if (distance > extentSource) extentSource = distance
      }
    }
  } else {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [pu, pv] of projected) {
      if (pu < minU) minU = pu
      if (pu > maxU) maxU = pu
      if (pv < minV) minV = pv
      if (pv > maxV) maxV = pv
    }
    extentSource = Math.max(maxU - minU, maxV - minV)
  }

  const diameterMm = extentSource * metersPerSourceUnit * 1000
  if (!(diameterMm >= 1)) return null
  return Math.round(diameterMm / MESH_DIAMETER_ROUNDING_MM) * MESH_DIAMETER_ROUNDING_MM
}

/**
 * Centreline from the segment's two IfcDistributionPorts: each port placement
 * is resolved through the local placement chain to SOURCE coordinates. Start
 * is the lower express ID port. Requires exactly two distinct port positions
 * (Revit omits the port of an open pipe end, which is reported as a reason).
 * The diameter is estimated from the mesh cross-section.
 */
function extractPortGeometry(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
  portIds: readonly number[] | undefined,
  metersPerSourceUnit: number,
): GeometryAttempt {
  if (portIds === undefined || portIds.length === 0) return { geometry: null, reason: 'no ports' }
  if (portIds.length === 1) return { geometry: null, reason: 'single port' }
  if (portIds.length > 2) return { geometry: null, reason: `${portIds.length} ports` }

  const positions: EngineerPoint3[] = []
  for (const portId of portIds) {
    const port = api.GetLine(webIfcModelId, portId, false) as IfcLine
    const placementId = (port?.ObjectPlacement as IfcHandle)?.value
    if (typeof placementId !== 'number') return { geometry: null, reason: 'port without placement' }
    const elements = resolveLocalPlacementWorldMatrix(api, webIfcModelId, placementId).elements
    const position = { x: elements[12], y: elements[13], z: elements[14] }
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      return { geometry: null, reason: 'port placement not finite' }
    }
    positions.push(position)
  }

  const [start, end] = positions
  const axis = new Vector3(end.x - start.x, end.y - start.y, end.z - start.z)
  if (axis.length() * metersPerSourceUnit < MIN_MESH_BOUNDS_LENGTH_M) {
    return { geometry: null, reason: 'coincident ports' }
  }

  const meshPoints = readMeshSourcePoints(api, webIfcModelId, expressId, metersPerSourceUnit)
  const outerDiameterMm =
    meshPoints === null ? null : estimateDiameterFromMeshCrossSection(meshPoints, axis, metersPerSourceUnit)

  return { geometry: { start, end, endpointSource: 'distribution-ports', outerDiameterMm }, reason: null }
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
 * Drops stray world-origin vertices from a pipe mesh before its bounds are
 * taken. Delegates to the shared origin guard
 * (`src/shared/frame/originArtifacts.ts`): only exact-zero vertices that are
 * isolated from the rest of the mesh are dropped; a mesh that is entirely at
 * the origin, or that legitimately touches it, is returned unchanged.
 */
export function filterOriginArtifacts(points: EngineerPoint3[]): EngineerPoint3[] {
  return dropIsolatedOriginVertices(points)
}

/**
 * Bounding-box centreline of the mesh in SOURCE coordinates along the longest
 * box axis. Unresolved (null) when the mesh has no discernible axis: the
 * dominant extent is shorter than `MIN_MESH_BOUNDS_LENGTH_M` or not at least
 * `MIN_MESH_BOUNDS_ELONGATION` times the second-largest extent (e.g. a
 * single cut face, whose "longest axis" would be its own diameter).
 */
function extractMeshBoundsGeometry(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
  metersPerSourceUnit: number,
): GeometryAttempt {
  const points = readMeshSourcePoints(api, webIfcModelId, expressId, metersPerSourceUnit)
  if (points === null) return { geometry: null, reason: 'no mesh' }

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
  const sorted = [...extents].sort((a, b) => b.size - a.size)
  const dominant = sorted[0]
  const second = sorted[1]
  if (dominant.size * metersPerSourceUnit < MIN_MESH_BOUNDS_LENGTH_M) {
    return { geometry: null, reason: 'mesh extent below 1 mm' }
  }
  if (dominant.size < MIN_MESH_BOUNDS_ELONGATION * second.size) {
    return { geometry: null, reason: 'degenerate mesh (no discernible axis, e.g. a single cut face)' }
  }

  const start = { ...centre, [dominant.axis]: dominant.min }
  const end = { ...centre, [dominant.axis]: dominant.max }
  return { geometry: { start, end, endpointSource: 'mesh-bounds', outerDiameterMm: null }, reason: null }
}

function readWorldPosition(api: IfcAPI, webIfcModelId: number, placementId: number): EngineerPoint3 | null {
  const elements = resolveLocalPlacementWorldMatrix(api, webIfcModelId, placementId).elements
  const position = { x: elements[12], y: elements[13], z: elements[14] }
  return [position.x, position.y, position.z].every(Number.isFinite) ? position : null
}

/**
 * Connectors of one fitting: body origin (ObjectPlacement) → each port
 * (IfcDistributionPort placement), ports in ascending express-ID order. The
 * diameter of a connector is borrowed from the pipe whose end lies within
 * {@link ENGINEER_JUNCTION_TOLERANCE_M} of its port (null when none does).
 * A fitting with fewer than two ports (a cap, an unresolved body) yields no
 * connector and is reported with a reason.
 */
function extractFittingConnectors(
  api: IfcAPI,
  webIfcModelId: number,
  fitting: { expressId: number; systemName: string },
  portIds: readonly number[] | undefined,
  pipeSegments: readonly EngineerPipeSegment[],
  metersPerSourceUnit: number,
  storey: { storeyId: StoreyId | null; storeyName: string | null },
): { connectors: EngineerPipeSegment[]; reason: string | null; originReplaced: boolean; portCount: number } {
  const portCount = portIds?.length ?? 0
  if (portIds === undefined || portCount === 0) return { connectors: [], reason: 'no ports', originReplaced: false, portCount }
  if (portCount === 1) return { connectors: [], reason: 'single port', originReplaced: false, portCount }
  if (portCount > ENGINEER_FITTING_MAX_PORTS) {
    return { connectors: [], reason: `${portCount} ports (more than ${ENGINEER_FITTING_MAX_PORTS})`, originReplaced: false, portCount }
  }

  const ports: EngineerPoint3[] = []
  for (const portId of portIds) {
    const port = api.GetLine(webIfcModelId, portId, false) as IfcLine
    const placementId = (port?.ObjectPlacement as IfcHandle)?.value
    if (typeof placementId !== 'number') return { connectors: [], reason: 'port without placement', originReplaced: false, portCount }
    const position = readWorldPosition(api, webIfcModelId, placementId)
    if (position === null) return { connectors: [], reason: 'port placement not finite', originReplaced: false, portCount }
    ports.push(position)
  }

  const line = api.GetLine(webIfcModelId, fitting.expressId, false) as IfcLine
  const placementId = (line?.ObjectPlacement as IfcHandle)?.value
  let origin = typeof placementId === 'number' ? readWorldPosition(api, webIfcModelId, placementId) : null
  let originReplaced = false
  const reachSource = ENGINEER_FITTING_MAX_ORIGIN_REACH_M / metersPerSourceUnit
  if (origin === null || ports.some((port) => distanceSource(port, origin!) > reachSource)) {
    origin = {
      x: ports.reduce((sum, port) => sum + port.x, 0) / ports.length,
      y: ports.reduce((sum, port) => sum + port.y, 0) / ports.length,
      z: ports.reduce((sum, port) => sum + port.z, 0) / ports.length,
    }
    originReplaced = true
  }

  const name: string | null = line?.Name?.value ?? null
  const tagValue: unknown = line?.Tag?.value
  const tag: string | null =
    typeof tagValue === 'string' ? tagValue : typeof tagValue === 'number' ? String(tagValue) : null
  const junctionSource = ENGINEER_JUNCTION_TOLERANCE_M / metersPerSourceUnit
  const minLengthSource = MIN_FITTING_CONNECTOR_LENGTH_M / metersPerSourceUnit

  const connectors: EngineerPipeSegment[] = []
  ports.forEach((port, portIndex) => {
    if (distanceSource(port, origin!) < minLengthSource) return
    let diameterMm: number | null = null
    let nearest = Infinity
    for (const pipe of pipeSegments) {
      if (pipe.start === null || pipe.end === null || pipe.outerDiameterMm === null) continue
      const distance = Math.min(distanceSource(pipe.start, port), distanceSource(pipe.end, port))
      if (distance <= junctionSource && distance < nearest) {
        nearest = distance
        diameterMm = pipe.outerDiameterMm
      }
    }
    connectors.push({
      expressId: fittingConnectorExpressId(fitting.expressId, portIndex),
      name,
      tag,
      systemName: fitting.systemName,
      storeyId: storey.storeyId,
      storeyName: storey.storeyName,
      start: origin!,
      end: port,
      endpointSource: 'distribution-ports',
      outerDiameterMm: diameterMm,
      lengthM: null,
      invertElevationM: null,
      elementKind: 'fitting',
      fittingExpressId: fitting.expressId,
    })
  })
  if (connectors.length === 0) return { connectors, reason: 'every port coincides with the origin', originReplaced, portCount }
  return { connectors, reason: null, originReplaced, portCount }
}

function distanceSource(a: EngineerPoint3, b: EngineerPoint3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
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
): Promise<ExtractedEngineerPipeNetwork> {
  const {
    IFCFLOWSEGMENT,
    IFCPIPESEGMENT,
    IFCFLOWFITTING,
    IFCPIPEFITTING,
    IFCEXTRUDEDAREASOLID,
    IFCMAPPEDITEM,
    IFCCIRCLEPROFILEDEF,
  } = await import('web-ifc')

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

  const fittingCandidates: Array<{ expressId: number; systemName: string }> = []
  for (const typeConstant of [IFCFLOWFITTING, IFCPIPEFITTING]) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
    for (let i = 0; i < ids.size(); i++) {
      const expressId = ids.get(i)
      const systemName = matchSystemName(expressId)
      if (systemName !== null) fittingCandidates.push({ expressId, systemName })
    }
  }
  fittingCandidates.sort((a, b) => a.expressId - b.expressId)

  const candidateIdSet = new Set(candidates.map((candidate) => candidate.expressId))
  const psetMap = await buildPipePsetMap(api, webIfcModelId, candidateIdSet)
  const portsMap = await buildElementPortsMap(
    api,
    webIfcModelId,
    new Set([...candidateIdSet, ...fittingCandidates.map((fitting) => fitting.expressId)]),
  )

  const geometryTypeIds = { IFCEXTRUDEDAREASOLID, IFCMAPPEDITEM, IFCCIRCLEPROFILEDEF }
  const endpointSourceCounts: EngineerGeometrySummary['endpointSourceCounts'] = {
    'extrusion-axis': 0,
    'distribution-ports': 0,
    'mesh-bounds': 0,
    unresolved: 0,
  }
  const unresolvedSegments: EngineerGeometrySummary['unresolvedSegments'] = []

  const segments: EngineerPipeSegment[] = candidates.map(({ expressId, systemName }) => {
    const line = api.GetLine(webIfcModelId, expressId, false) as IfcLine
    const name: string | null = line?.Name?.value ?? null
    const tagValue: unknown = line?.Tag?.value
    const tag: string | null =
      typeof tagValue === 'string' ? tagValue : typeof tagValue === 'number' ? String(tagValue) : null

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
    const reasons: string[] = []
    if (geometry === null) {
      let attempt: GeometryAttempt
      try {
        attempt = extractPortGeometry(api, webIfcModelId, expressId, portsMap.get(expressId), metersPerSourceUnit)
      } catch (error) {
        attempt = { geometry: null, reason: `port placement unreadable (${error instanceof Error ? error.message : String(error)})` }
      }
      geometry = attempt.geometry
      if (attempt.reason !== null) reasons.push(attempt.reason)
    }
    if (geometry === null) {
      const attempt = extractMeshBoundsGeometry(api, webIfcModelId, expressId, metersPerSourceUnit)
      geometry = attempt.geometry
      if (attempt.reason !== null) reasons.push(attempt.reason)
    }

    if (geometry === null) {
      endpointSourceCounts.unresolved += 1
      unresolvedSegments.push({ expressId, reason: `no extrusion solid; ${reasons.join('; ')}` })
    } else {
      endpointSourceCounts[geometry.endpointSource] += 1
    }

    const psetValues = psetMap.get(expressId) ?? EMPTY_PSET_VALUES
    const storeyId = elementToStorey.get(expressId) ?? null
    // Both ends or nothing: a single invert is not a slope (see `resolveEngineerSegmentSlope`).
    const endInvertElevationsM: EngineerEndInvertElevationsM | null =
      psetValues.upperEndInvertSource !== null && psetValues.lowerEndInvertSource !== null
        ? {
            upperEndM: psetValues.upperEndInvertSource * metersPerSourceUnit,
            lowerEndM: psetValues.lowerEndInvertSource * metersPerSourceUnit,
          }
        : null

    return {
      expressId,
      name,
      tag,
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
      endInvertElevationsM,
    }
  })

  // --- fitting connectors (R3) -------------------------------------------------
  const fittingConnectors: EngineerPipeSegment[] = []
  const fittingSummary: EngineerFittingSummary = {
    fittings: fittingCandidates.length,
    connectors: 0,
    byPortCount: {},
    originReplacedByPortCentroid: 0,
    skipped: [],
  }
  for (const fitting of fittingCandidates) {
    const storeyId = elementToStorey.get(fitting.expressId) ?? null
    let outcome: ReturnType<typeof extractFittingConnectors>
    try {
      outcome = extractFittingConnectors(api, webIfcModelId, fitting, portsMap.get(fitting.expressId), segments, metersPerSourceUnit, {
        storeyId,
        storeyName: storeyId !== null ? (storeyNameById.get(storeyId) ?? null) : null,
      })
    } catch (error) {
      outcome = {
        connectors: [],
        reason: `fitting unreadable (${error instanceof Error ? error.message : String(error)})`,
        originReplaced: false,
        portCount: portsMap.get(fitting.expressId)?.length ?? 0,
      }
    }
    const portKey = String(outcome.portCount)
    fittingSummary.byPortCount[portKey] = (fittingSummary.byPortCount[portKey] ?? 0) + 1
    if (outcome.originReplaced) fittingSummary.originReplacedByPortCentroid += 1
    if (outcome.reason !== null) fittingSummary.skipped.push({ expressId: fitting.expressId, reason: outcome.reason })
    fittingConnectors.push(...outcome.connectors)
  }
  fittingConnectors.sort((a, b) => a.expressId - b.expressId)
  fittingSummary.connectors = fittingConnectors.length

  return {
    metersPerSourceUnit,
    storeys,
    segments,
    fittingConnectors,
    geometrySummary: { endpointSourceCounts, unresolvedSegments },
    fittingSummary,
  }
}
