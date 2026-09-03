import { Vector3 } from 'three'
import { BRANCH_FALLBACK_DIAMETER_MM } from '@/domain/branchDefaults'
import type { FloorRoutes, RouteSegment, RouteSegmentEndpoint } from '@/domain/branchRouting'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'
import {
  createViewerPointToStoreyLocalResolver,
  writeSanitaryRouteElements,
  writeSanitaryRouteSystemAssignment,
  type SanitaryRouteExportDebugSummary,
} from '@/shared/ifc/exportSanitaryRouteElements'
import { Handle, type IfcAPI } from 'web-ifc'
import type { PlanBounds, Riser, Storey, StoreyId } from '@/domain/types'
import {
  resolveContextSourceFrame,
  type ModelOriginDecision,
  type ModelSourceFrame,
} from '@/shared/frame/modelFrame'
import { readDirection, resolveLocalPlacementWorldMatrix } from './localPlacementMatrix'
import { readRepresentationContextFrame } from './readRepresentationContextFrame'

type IfcHandle = { type: 5; value: number }
type IfcWritableLine = { expressID: number; type: number; [key: string]: unknown }
type IfcEntityRef = { expressID: number; type: number }
type ImportedIfcTypes = Awaited<typeof import('web-ifc')>
type Point3Debug = { x: number; y: number; z: number }
type RiserStoreyDebugInfo = Pick<Storey, 'id' | 'name' | 'elevation'>
type StoreyContext = {
  storeyId: StoreyId
  targetStoreyPlacementId: number
  ownerHistory: IfcHandle | null
  containment: {
    expressID: number
    type: number
    RelatedElements?: unknown[]
    RelatingStructure?: IfcHandle | null
  } | null
}
type ResolvedRiserPlacement = {
  webPositionUsedForExport: Point3Debug
  worldOrModelPosition: Point3Debug
  finalIfcLocalPlacement: Point3Debug
  parentPlacementOrigin: Point3Debug
  parentPlacementAxis: Point3Debug
  parentPlacementRefDirection: Point3Debug
}
type WrittenRiser = {
  element: IfcEntityRef
  createdEntityIds: Record<string, number | undefined>
  createdRelationIds: Record<string, number | undefined>
}
type StoreySpanInfo = {
  id: StoreyId
  name: string | null
  elevation: number | null
}
type StackGroup = {
  stackId: string
  stackLabel: string
  canonicalPosition: { x: number; y: number; z: number }
  bottomRiser: ExportRiser
  topRiser: ExportRiser
  members: ExportRiser[]
  /** Outer diameter in millimetres, resolved from members or DEFAULT_RISER_DIAMETER_MM. */
  diameterMm: number
}

/**
 * Riser as accepted by the export boundary. The placement result may carry an
 * explicit outer diameter per stack; when absent the export falls back to
 * DEFAULT_RISER_DIAMETER_MM. Members of one stack must agree on the diameter.
 */
export type ExportRiser = Riser & {
  /** Outer stack diameter in millimetres. */
  diameterMm?: number
}

export type FullIfcRiserDebugOptions = {
  exportRunId?: string
  timestamp?: string
  sourceIfcName?: string | null
  storeys?: RiserStoreyDebugInfo[]
  /** The viewer's origin decision for this model (render frame), echoed into the debug JSON. */
  modelOrigin?: ModelOriginDecision | null
}

export type FullIfcRiserDebugRecord = {
  exportRunId: string
  timestamp: string
  sourceIfcName: string | null
  schema: string
  riserId: string
  riserTag: string
  floorId: StoreyId
  floorName: string | null
  storeyEntityId: StoreyId
  storeyName: string | null
  storeyElevation: number | null
  webPositionRaw: Point3Debug
  webPositionUsedForExport: Point3Debug
  floorLocalPosition: Point3Debug
  worldOrModelPosition: Point3Debug
  chosenAnchorEntityId: number
  chosenAnchorType: string
  chosenParentPlacementId: number
  parentPlacementOrigin: Point3Debug
  parentPlacementAxis: Point3Debug
  parentPlacementRefDirection: Point3Debug
  finalIfcLocalPlacement: Point3Debug
  bottomStoreyEntityId: StoreyId
  bottomStoreyName: string | null
  bottomStoreyElevation: number | null
  topStoreyEntityId: StoreyId
  topStoreyName: string | null
  topStoreyElevation: number | null
  coveredStoreyIds: StoreyId[]
  extrusionLengthSourceUnits: number
  /** Outer diameter written for this stack, in millimetres. */
  diameterMm: number
  createdEntityIds: Record<string, number>
  createdRelationIds: Record<string, number>
  warnings: string[]
  notes: string[]
}

export type FullIfcSystemAssignmentDebug = {
  ifcSystemId: number
  ifcRelAssignsToGroupId: number
  ifcRelServicesBuildingsId: number | null
  ifcBuildingId: number
  name: string
  objectType: string
  description: string
}

export type FullIfcRiserDebugArtifact = {
  exportRunId: string
  timestamp: string
  sourceIfcName: string | null
  schema: string
  sourceFloorPlanBounds: PlanBounds | null
  /** Viewer render-frame decision as passed by the caller; null when not provided. */
  modelOrigin: ModelOriginDecision | null
  /**
   * Absolute source frame read from the SOURCE file's representation context
   * (null when its WCS is at/near the origin). Also written to the exported
   * IFC as the `BIMPipe_Frame` property set on IfcProject.
   */
  sourceFrame: ModelSourceFrame | null
  systemAssignment: FullIfcSystemAssignmentDebug | null
  sanitaryRouteExport: SanitaryRouteExportDebugSummary | null
  risers: FullIfcRiserDebugRecord[]
  warnings: string[]
  notes: string[]
}

export type FullIfcWithRisersDebugResult = {
  ifcBytes: Uint8Array
  debugMapping: FullIfcRiserDebugArtifact
}

/** Outer diameter written when the placement result does not specify one. */
export const DEFAULT_RISER_DIAMETER_MM = 110
/**
 * Branch route segments carry their own `diameterMm` (per-kind defaults in
 * `src/domain/branchDefaults.ts`); this is only the guard used when a segment
 * arrives without a finite positive diameter.
 */
export const BRANCH_ROUTE_FALLBACK_DIAMETER_MM = BRANCH_FALLBACK_DIAMETER_MM
/**
 * Maximum allowed distance, in millimetres, between a branch-route group's
 * riser connection point and the current riser plan position. Routes are
 * recomputed upstream on every riser move, so at export time the only
 * legitimate difference is floating-point noise from unit conversion; 1 mm is
 * far above that noise and far below any real riser displacement.
 */
export const BRANCH_ROUTE_RISER_DRIFT_TOLERANCE_MM = 1
const RISER_WALL_THICKNESS_MM = 5
const RISER_ROUGHNESS_MM = 0.0015
const RISER_SYSTEM_NAME = 'BIMPipe Sanitary Stacks'
const RISER_SYSTEM_DESCRIPTION = 'Sanitary drainage system generated by BIMPipe.'
const RISER_MATERIAL_NAME = 'PVC'
const RISER_STACK_ALIGNMENT_EPSILON = 1e-3
/** Property set written on IfcProject when the source frame comes from the context WCS. */
export const FRAME_PSET_NAME = 'BIMPipe_Frame'

/**
 * Refuses branch routes that no longer match the current riser set instead of
 * silently exporting stale geometry. Route recomputation happens upstream;
 * this check only guarantees the exporter never writes inconsistent input.
 *
 * Riser plan positions are in viewer units (metres); route coordinates are in
 * the plan units recorded on each FloorRoutes entry.
 */
export function assertBranchRoutesConsistentWithRisers(
  branchRoutes: FloorRoutes[],
  risers: ExportRiser[],
): void {
  if (branchRoutes.length === 0) return

  const risersById = new Map(risers.map((riser) => [riser.id, riser]))
  for (const floor of branchRoutes) {
    const metresPerPlanUnit = floor.planUnits === 'mm' ? 0.001 : 1
    const segmentsByRiserId = new Map<string, RouteSegment[]>()
    for (const segment of floor.segments) {
      const group = segmentsByRiserId.get(segment.riserId)
      if (group) group.push(segment)
      else segmentsByRiserId.set(segment.riserId, [segment])
    }

    for (const [riserId, segments] of segmentsByRiserId) {
      const riser = risersById.get(riserId)
      if (!riser) {
        throw new Error(
          `Branch routes on storey #${floor.storeyId} reference riser ${riserId}, which no longer exists. ` +
          'Recompute branch routes, then export again.',
        )
      }
      if (riser.storeyId !== floor.storeyId) {
        throw new Error(
          `Branch routes on storey #${floor.storeyId} reference riser ${riserId} (stack ${riser.stackLabel}), ` +
          `but that riser is now on storey #${riser.storeyId}. Recompute branch routes, then export again.`,
        )
      }
      const staleStackSegment = segments.find(
        (segment) => segment.riserStackId !== undefined && segment.riserStackId !== riser.stackId,
      )
      if (staleStackSegment) {
        throw new Error(
          `Branch route segment ${staleStackSegment.id} on storey #${floor.storeyId} expects riser ${riserId} ` +
          `in stack ${staleStackSegment.riserStackId}, but the riser now belongs to stack ${riser.stackId}. ` +
          'Recompute branch routes, then export again.',
        )
      }

      const connection = findRiserConnectionEndpoint(segments)
      const driftXMm = (connection.x * metresPerPlanUnit - riser.position.x) * 1000
      const driftZMm = (connection.z * metresPerPlanUnit - riser.position.z) * 1000
      const driftMm = Math.hypot(driftXMm, driftZMm)
      if (driftMm > BRANCH_ROUTE_RISER_DRIFT_TOLERANCE_MM) {
        throw new Error(
          `Branch routes on storey #${floor.storeyId} connect to riser ${riserId} (stack ${riser.stackLabel}) at ` +
          `(${(connection.x * metresPerPlanUnit).toFixed(3)}, ${(connection.z * metresPerPlanUnit).toFixed(3)}) m, ` +
          `but the riser is now at (${riser.position.x.toFixed(3)}, ${riser.position.z.toFixed(3)}) m — ` +
          `${driftMm.toFixed(1)} mm drift exceeds the ${BRANCH_ROUTE_RISER_DRIFT_TOLERANCE_MM} mm export tolerance. ` +
          'Recompute branch routes after moving risers, then export again.',
        )
      }
    }
  }
}

/**
 * The riser connection is the endpoint at the elevation datum (0 = the branch
 * connection at the riser). Picks the lowest-elevation endpoint of the group,
 * with a deterministic (x, z) tie-break for endpoints at equal elevation.
 */
function findRiserConnectionEndpoint(segments: RouteSegment[]): RouteSegmentEndpoint {
  let best: RouteSegmentEndpoint | null = null
  for (const segment of segments) {
    for (const endpoint of [segment.start, segment.end]) {
      if (
        !best ||
        endpoint.elevation < best.elevation ||
        (endpoint.elevation === best.elevation &&
          (endpoint.x < best.x || (endpoint.x === best.x && endpoint.z < best.z)))
      ) {
        best = endpoint
      }
    }
  }
  if (!best) {
    throw new Error('Branch route group has no segments; cannot resolve its riser connection point.')
  }
  return best
}

/** sourceFloorPlanBounds is preserved only as debug artifact metadata; it is not used for placement. */
export async function exportFullIfcWithRisers(
  api: IfcAPI,
  sourceBytes: Uint8Array,
  primaryStoreyId: StoreyId,
  risers: ExportRiser[],
  sourceFloorPlanBounds: PlanBounds | null = null,
  sanitaryRoutes: SanitaryFixtureRoute[] = [],
  branchRoutes: FloorRoutes[] = [],
): Promise<Uint8Array> {
  const { ifcBytes } = await exportFullIfcWithRisersInternal(
    api,
    sourceBytes,
    primaryStoreyId,
    risers,
    sourceFloorPlanBounds,
    null,
    sanitaryRoutes,
    branchRoutes,
  )
  return ifcBytes
}

/** sourceFloorPlanBounds is preserved only as debug artifact metadata; it is not used for placement. */
export async function exportFullIfcWithRisersWithDebug(
  api: IfcAPI,
  sourceBytes: Uint8Array,
  primaryStoreyId: StoreyId,
  risers: ExportRiser[],
  sourceFloorPlanBounds: PlanBounds | null = null,
  debugOptions: FullIfcRiserDebugOptions = {},
  sanitaryRoutes: SanitaryFixtureRoute[] = [],
  branchRoutes: FloorRoutes[] = [],
): Promise<FullIfcWithRisersDebugResult> {
  const result = await exportFullIfcWithRisersInternal(
    api,
    sourceBytes,
    primaryStoreyId,
    risers,
    sourceFloorPlanBounds,
    debugOptions,
    sanitaryRoutes,
    branchRoutes,
  )
  if (!result.debugMapping) {
    throw new Error('Debug mapping was not created.')
  }
  return {
    ifcBytes: result.ifcBytes,
    debugMapping: result.debugMapping,
  }
}

async function exportFullIfcWithRisersInternal(
  api: IfcAPI,
  sourceBytes: Uint8Array,
  _primaryStoreyId: StoreyId,
  risers: ExportRiser[],
  sourceFloorPlanBounds: PlanBounds | null,
  debugOptions: FullIfcRiserDebugOptions | null,
  sanitaryRoutes: SanitaryFixtureRoute[] = [],
  branchRoutes: FloorRoutes[] = [],
): Promise<{
  ifcBytes: Uint8Array
  debugMapping: FullIfcRiserDebugArtifact | null
}> {
  if (risers.length === 0) {
    throw new Error('Add or suggest risers before downloading the full IFC.')
  }
  assertBranchRoutesConsistentWithRisers(branchRoutes, risers)

  const ifc = await import('web-ifc')
  const { IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCLABEL } = ifc

  const modelId = api.OpenModel(sourceBytes.slice())

  try {
    const schema = api.GetModelSchema(modelId)
    const bodyContextId = resolveBodyContext(api, modelId)
    const millimetresPerSourceUnit = resolveLengthScaleToMillimetres(api, modelId)
    const sourceUnitsPerViewerUnit = 1000 / millimetresPerSourceUnit
    // Source frame from the file itself (context WCS + TrueNorth). Geometry is
    // never shifted by it; it is documented so downstream tools know these are
    // project-base-point coordinates.
    const contextFrame = await readRepresentationContextFrame(api, modelId)
    const sourceFrame = contextFrame === null ? null : resolveContextSourceFrame(contextFrame)
    const debugMapping = debugOptions
      ? createDebugArtifact(debugOptions, schema, sourceFloorPlanBounds, sourceFrame)
      : null
    const debugStoreysById = new Map(
      (debugOptions?.storeys ?? []).map((storey) => [storey.id, storey]),
    )
    const storeysById = buildRiserStoreysById(api, modelId, risers, debugStoreysById)
    const stackGroups = groupRisersByStackId(risers, storeysById)
    const modelStoreyElevations = readModelStoreyElevations(api, modelId)
    const createdFlowSegmentHandles: IfcHandle[] = []
    let systemOwnerHistory: IfcHandle | null = null

    for (const stack of stackGroups) {
      const bottomStoreyId = stack.bottomRiser.storeyId
      const storeyContext = resolveStoreyContext(
        api,
        modelId,
        bottomStoreyId,
        IFCRELCONTAINEDINSPATIALSTRUCTURE,
      )
      const placement = resolveRiserPlacement(
        api,
        modelId,
        storeyContext,
        stack.bottomRiser,
        sourceUnitsPerViewerUnit,
      )
      const bottomElevation = getStoreyElevation(stack.bottomRiser, storeysById)
      const topElevation = getStoreyElevation(stack.topRiser, storeysById)
      // Convention: a multi-storey stack is extruded from its bottom storey's
      // elevation to its top storey's elevation. A stack confined to ONE storey
      // (a V4 extent can bound it that way) has no such span, so it is given
      // that storey's height instead — never a zero-length solid.
      let extrusionLengthSourceUnits = topElevation - bottomElevation
      let singleStoreyNote: string | null = null
      if (stack.bottomRiser.storeyId === stack.topRiser.storeyId) {
        const height = resolveSingleStoreyHeight(bottomElevation, modelStoreyElevations)
        if (height === null) {
          throw new Error(
            `Riser stack ${stack.stackLabel} spans only storey ${formatStoreyName(requireStoreySpanInfo(storeysById, stack.bottomRiser.storeyId, stack.stackLabel, stack.stackId))} ` +
              'and the model has no storey above it nor a derivable storey pitch, so the vertical extrusion cannot be sized.',
          )
        }
        extrusionLengthSourceUnits = height.lengthSourceUnits
        singleStoreyNote =
          `Single-storey stack: extruded ${height.lengthSourceUnits} source units ` +
          (height.source === 'next-storey-above' ? 'up to the next storey above.' : 'using the median storey pitch (top storey of the model).')
      }
      if (!Number.isFinite(extrusionLengthSourceUnits) || extrusionLengthSourceUnits <= 0) {
        throw new Error(
          `Riser stack ${stack.stackLabel} resolved a non-positive extrusion length (${extrusionLengthSourceUnits}); ` +
          `bottom storey ${stack.bottomRiser.storeyId}, top storey ${stack.topRiser.storeyId}.`,
        )
      }

      const riserElement = writeMinimalRiser(
        api,
        ifc,
        modelId,
        schema,
        bodyContextId,
        storeyContext.targetStoreyPlacementId,
        storeyContext.ownerHistory,
        stack.bottomRiser,
        new Vector3(
          placement.finalIfcLocalPlacement.x,
          placement.finalIfcLocalPlacement.y,
          placement.finalIfcLocalPlacement.z,
        ),
        stack.diameterMm,
        extrusionLengthSourceUnits,
        millimetresPerSourceUnit,
      )
      const createdHandles = [handleRef(riserElement.element.expressID)]
      createdFlowSegmentHandles.push(...createdHandles)
      systemOwnerHistory ??= storeyContext.ownerHistory

      const debugRecord = debugMapping
        ? buildRiserDebugRecord(
            api,
            modelId,
            debugMapping,
            schema,
            storeyContext,
            storeysById,
            stack,
            placement,
            riserElement,
            extrusionLengthSourceUnits,
          )
        : null
      if (debugMapping && debugRecord) {
        if (singleStoreyNote !== null) debugRecord.notes.push(singleStoreyNote)
        debugMapping.risers.push(debugRecord)
      }

      if (storeyContext.containment) {
        storeyContext.containment.RelatedElements = [
          ...(Array.isArray(storeyContext.containment.RelatedElements) ? storeyContext.containment.RelatedElements : []),
          ...createdHandles,
        ]
        api.WriteLine(modelId, storeyContext.containment)
        if (debugRecord) {
          debugRecord.notes.push(`Appended to existing IfcRelContainedInSpatialStructure #${storeyContext.containment.expressID}.`)
        }
      } else {
        const relation = writeLabeledLine(api, modelId, 'riser containment', {
          expressID: -1,
          type: IFCRELCONTAINEDINSPATIALSTRUCTURE,
          GlobalId: api.CreateIFCGloballyUniqueId(modelId),
          OwnerHistory: storeyContext.ownerHistory,
          Name: api.CreateIfcType(modelId, IFCLABEL, 'BIMPipe riser set'),
          Description: null,
          RelatedElements: createdHandles,
          RelatingStructure: handleRef(bottomStoreyId),
        })
        if (debugRecord) {
          debugRecord.createdRelationIds.containmentRelation = relation.expressID
          debugRecord.notes.push(`Created IfcRelContainedInSpatialStructure #${relation.expressID}.`)
        }
      }
    }

    const storeyContextCache = new Map<StoreyId, ReturnType<typeof resolveStoreyContext>>()
    const resolveCachedStoreyContext = (storeyId: StoreyId) => {
      const cached = storeyContextCache.get(storeyId)
      if (cached) return cached
      const context = resolveStoreyContext(api, modelId, storeyId, IFCRELCONTAINEDINSPATIALSTRUCTURE)
      storeyContextCache.set(storeyId, context)
      return context
    }
    const resolveViewerPointToStoreyLocal = createViewerPointToStoreyLocalResolver(
      api,
      modelId,
      sourceUnitsPerViewerUnit,
    )

    const branchRouteExport = writeBranchRouteSegments(
      api,
      ifc,
      modelId,
      schema,
      bodyContextId,
      branchRoutes,
      storeysById,
      new Map(risers.map((riser) => [riser.id, riser])),
      sourceUnitsPerViewerUnit,
      millimetresPerSourceUnit,
      resolveCachedStoreyContext,
      resolveViewerPointToStoreyLocal,
      IFCRELCONTAINEDINSPATIALSTRUCTURE,
      debugMapping?.notes,
    )
    createdFlowSegmentHandles.push(...branchRouteExport.handles)
    systemOwnerHistory ??= branchRouteExport.ownerHistory

    const sanitaryRouteExport = writeSanitaryRouteElements(
      api,
      ifc,
      modelId,
      schema,
      bodyContextId,
      sanitaryRoutes,
      [...storeysById.values()].flatMap((storey) =>
        typeof storey.elevation === "number" ? [{ id: storey.id, elevation: storey.elevation }] : [],
      ),
      risers,
      sourceUnitsPerViewerUnit,
      millimetresPerSourceUnit,
      resolveCachedStoreyContext,
      resolveViewerPointToStoreyLocal,
      IFCRELCONTAINEDINSPATIALSTRUCTURE,
      debugMapping?.notes,
    )
    if (debugMapping) {
      debugMapping.sanitaryRouteExport = sanitaryRouteExport.debugSummary
    }
    if (sanitaryRouteExport.flowSegmentHandles.length > 0) {
      writeSanitaryRouteSystemAssignment(
        api,
        ifc,
        modelId,
        schema,
        systemOwnerHistory,
        sanitaryRouteExport.flowSegmentHandles,
      )
      if (debugMapping) {
        debugMapping.notes.push(
          `Exported ${sanitaryRouteExport.elements.length} sanitary route pipe segment(s) as IfcFlowSegment/IfcPipeSegment elements.`,
        )
      }
    }

    const systemAssignment = writeSanitarySystemAssignment(
      api,
      ifc,
      modelId,
      schema,
      systemOwnerHistory,
      createdFlowSegmentHandles,
    )
    if (debugMapping) {
      debugMapping.systemAssignment = systemAssignment
    }

    if (sourceFrame !== null) {
      const framePset = writeFramePset(api, ifc, modelId, sourceFrame)
      debugMapping?.notes.push(
        `Wrote ${FRAME_PSET_NAME} #${framePset.expressID} on IfcProject: coordinates are project-base-point ` +
          `coordinates; context WCS offset = (${sourceFrame.offsetSourceUnits.x}, ${sourceFrame.offsetSourceUnits.y}, ` +
          `${sourceFrame.offsetSourceUnits.z}) ${sourceFrame.lengthUnit ?? 'unknown unit'}; ` +
          `true north = ${sourceFrame.trueNorthDeg === null ? 'not declared' : `${sourceFrame.trueNorthDeg.toFixed(4)} deg`}.`,
      )
    }

    return {
      ifcBytes: api.SaveModel(modelId),
      debugMapping,
    }
  } finally {
    api.CloseModel(modelId)
  }
}

function buildRiserStoreysById(
  api: IfcAPI,
  modelId: number,
  risers: ExportRiser[],
  debugStoreysById: Map<StoreyId, RiserStoreyDebugInfo>,
): Map<StoreyId, StoreySpanInfo> {
  const storeysById = new Map<StoreyId, StoreySpanInfo>()
  for (const riser of risers) {
    if (storeysById.has(riser.storeyId)) continue
    const storeyInfo = resolveStoreyDebugInfo(api, modelId, riser.storeyId, debugStoreysById)
    storeysById.set(riser.storeyId, {
      id: riser.storeyId,
      name: storeyInfo.name,
      elevation: storeyInfo.elevation,
    })
  }
  return storeysById
}

function groupRisersByStackId(
  risers: ExportRiser[],
  storeysById: Map<StoreyId, StoreySpanInfo>,
): StackGroup[] {
  const risersByStack = new Map<string, ExportRiser[]>()
  for (const riser of risers) {
    const group = risersByStack.get(riser.stackId)
    if (group) group.push(riser)
    else risersByStack.set(riser.stackId, [riser])
  }

  const stackGroups: StackGroup[] = []
  for (const [stackId, members] of risersByStack) {
    if (members.length === 0) continue

    const first = members[0]
    const stackLabel = first.stackLabel.trim() || stackId
    const firstStorey = requireStoreySpanInfo(storeysById, first.storeyId, stackLabel, stackId)

    for (const member of members.slice(1)) {
      const memberStorey = requireStoreySpanInfo(storeysById, member.storeyId, stackLabel, stackId)
      const deltaX = Math.abs(member.position.x - first.position.x)
      const deltaZ = Math.abs(member.position.z - first.position.z)
      if (deltaX > RISER_STACK_ALIGNMENT_EPSILON || deltaZ > RISER_STACK_ALIGNMENT_EPSILON) {
        throw new Error(
          `Riser stack ${stackLabel} (${stackId}) has misaligned floors: ` +
          `floor ${formatStoreyName(firstStorey)} at (${first.position.x}, ${first.position.z}) ` +
          `vs floor ${formatStoreyName(memberStorey)} at (${member.position.x}, ${member.position.z})`,
        )
      }
    }

    const orderedMembers = [...members].sort((left, right) =>
      getStoreyElevation(left, storeysById) - getStoreyElevation(right, storeysById),
    )
    const bottomRiser = orderedMembers[0]
    const topRiser = orderedMembers[orderedMembers.length - 1]

    stackGroups.push({
      stackId,
      stackLabel,
      canonicalPosition: { ...bottomRiser.position },
      bottomRiser,
      topRiser,
      members: orderedMembers,
      diameterMm: resolveStackDiameterMm(orderedMembers, stackLabel, stackId),
    })
  }

  return stackGroups
}

function resolveStackDiameterMm(
  members: ExportRiser[],
  stackLabel: string,
  stackId: string,
): number {
  const definedDiameters = [
    ...new Set(members.flatMap((member) => (member.diameterMm !== undefined ? [member.diameterMm] : []))),
  ]
  if (definedDiameters.length > 1) {
    throw new Error(
      `Riser stack ${stackLabel} (${stackId}) carries conflicting diameters: ${definedDiameters.join(', ')} mm. ` +
      'All floors of one stack must share a single diameter.',
    )
  }
  const diameterMm = definedDiameters[0] ?? DEFAULT_RISER_DIAMETER_MM
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
    throw new Error(`Riser stack ${stackLabel} (${stackId}) has an invalid diameter (${diameterMm} mm).`)
  }
  return diameterMm
}

function requireStoreySpanInfo(
  storeysById: Map<StoreyId, StoreySpanInfo>,
  storeyId: StoreyId,
  stackLabel: string,
  stackId: string,
): StoreySpanInfo {
  const storey = storeysById.get(storeyId)
  if (!storey || !Number.isFinite(storey.elevation)) {
    throw new Error(
      `Riser stack ${stackLabel} (${stackId}) references storey ${storeyId} without a resolvable elevation.`,
    )
  }
  return storey
}

function getStoreyElevation(
  riser: Riser,
  storeysById: Map<StoreyId, StoreySpanInfo>,
): number {
  const storey = storeysById.get(riser.storeyId)
  const elevation = storey?.elevation
  if (typeof elevation !== 'number' || !Number.isFinite(elevation)) {
    throw new Error(`Riser ${riser.id} references storey ${riser.storeyId} without a resolvable elevation.`)
  }
  return elevation
}

function formatStoreyName(storey: StoreySpanInfo): string {
  return storey.name ?? `#${storey.id}`
}

/** Distinct, ascending `IfcBuildingStorey.Elevation` values of the model, in source units. */
function readModelStoreyElevations(api: IfcAPI, modelId: number): number[] {
  const storeyType = api.GetTypeCodeFromName('IFCBUILDINGSTOREY')
  const storeyIds = api.GetLineIDsWithType(modelId, storeyType)
  const elevations = new Set<number>()
  for (let i = 0; i < storeyIds.size(); i += 1) {
    const storey = api.GetLine(modelId, storeyIds.get(i), false) as {
      Elevation?: { value?: number } | number | null
    } | null
    const elevation = readOptionalNumberValue(storey?.Elevation)
    if (elevation !== null && Number.isFinite(elevation)) elevations.add(elevation)
  }
  return [...elevations].sort((a, b) => a - b)
}

/**
 * Height of a single-storey stack: the distance to the next storey above the
 * stack's storey; on the model's top storey, the median pitch of the model's
 * storeys. Null when neither is derivable (single-storey model) — the caller
 * fails explicitly rather than inventing a height.
 */
function resolveSingleStoreyHeight(
  storeyElevation: number,
  modelStoreyElevations: readonly number[],
): { lengthSourceUnits: number; source: 'next-storey-above' | 'median-storey-pitch' } | null {
  const above = modelStoreyElevations.find((elevation) => elevation > storeyElevation)
  if (above !== undefined) return { lengthSourceUnits: above - storeyElevation, source: 'next-storey-above' }
  const pitches: number[] = []
  for (let i = 1; i < modelStoreyElevations.length; i += 1) {
    pitches.push(modelStoreyElevations[i] - modelStoreyElevations[i - 1])
  }
  if (pitches.length === 0) return null
  pitches.sort((a, b) => a - b)
  const middle = Math.floor(pitches.length / 2)
  const median = pitches.length % 2 === 1 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2
  return median > 0 ? { lengthSourceUnits: median, source: 'median-storey-pitch' } : null
}

function resolveLengthScaleToMillimetres(api: IfcAPI, modelId: number): number {
  const projectType = api.GetTypeCodeFromName('IFCPROJECT')
  const projectIds = api.GetLineIDsWithType(modelId, projectType)
  if (projectIds.size() === 0) return 1000

  const project = api.GetLine(modelId, projectIds.get(0), false) as {
    UnitsInContext?: IfcHandle | null
  } | null
  const assignmentId = project?.UnitsInContext?.value ?? null
  if (assignmentId === null) return 1000

  const assignment = api.GetLine(modelId, assignmentId, false) as {
    Units?: Array<IfcHandle | null> | null
  } | null

  for (const unitRef of assignment?.Units ?? []) {
    const unitId = unitRef?.value ?? null
    if (unitId === null) continue
    if (api.GetNameFromTypeCode(api.GetLineType(modelId, unitId)) !== 'IfcSIUnit') continue

    const unit = api.GetLine(modelId, unitId, false) as {
      UnitType?: { value?: string } | null
      Name?: { value?: string } | null
      Prefix?: { value?: string } | null
    } | null
    if (unit?.UnitType?.value !== 'LENGTHUNIT') continue
    if (unit?.Name?.value !== 'METRE') continue

    switch (unit?.Prefix?.value ?? null) {
      case 'MILLI':
        return 1
      case 'CENTI':
        return 10
      case null:
      case undefined:
        return 1000
      default:
        throw new Error(`Unsupported length prefix ${unit.Prefix?.value}.`)
    }
  }

  return 1000
}

/**
 * Representation context for the exported pipe bodies. Preferred: the model's
 * `Body` sub-context (`IfcGeometricRepresentationSubContext` with
 * ContextIdentifier 'Body'). Fallback: the context that the model's own
 * `Body` shape representations reference — some exporters (e.g. the bundled
 * Duplex MEP sample) attach Body shapes straight to the 'Model'
 * `IfcGeometricRepresentationContext` without any sub-context. Fails
 * explicitly when neither exists; the caller surfaces the message.
 */
function resolveBodyContext(api: IfcAPI, modelId: number): number {
  const subContextType = api.GetTypeCodeFromName('IFCGEOMETRICREPRESENTATIONSUBCONTEXT')
  const subContextIds = api.GetLineIDsWithType(modelId, subContextType)
  for (let i = 0; i < subContextIds.size(); i += 1) {
    const subContext = api.GetLine(modelId, subContextIds.get(i), false) as {
      ContextIdentifier?: { value?: string } | null
    } | null
    if (subContext?.ContextIdentifier?.value === 'Body') return subContextIds.get(i)
  }

  const shapeType = api.GetTypeCodeFromName('IFCSHAPEREPRESENTATION')
  const shapeIds = api.GetLineIDsWithType(modelId, shapeType)
  for (let i = 0; i < shapeIds.size(); i += 1) {
    const shape = api.GetLine(modelId, shapeIds.get(i), false) as {
      ContextOfItems?: IfcHandle | null
      RepresentationIdentifier?: { value?: string } | null
    } | null
    const contextId = shape?.ContextOfItems?.value ?? null
    if (contextId !== null && shape?.RepresentationIdentifier?.value === 'Body') return contextId
  }

  throw new Error(
    'Could not resolve a Body representation context: the model has neither a Body sub-context nor any Body shape representation.',
  )
}

function toIfcWorldPlanPoint(
  position: { x: number; y: number; z: number },
  sourceUnitsPerViewerUnit: number,
  storeyWorldZ: number,
): Vector3 {
  return new Vector3(
    position.x * sourceUnitsPerViewerUnit,
    -position.z * sourceUnitsPerViewerUnit,
    storeyWorldZ,
  )
}

function resolveStoreyContext(
  api: IfcAPI,
  modelId: number,
  storeyId: StoreyId,
  relationType: number,
): StoreyContext {
  const targetStorey = api.GetLine(modelId, storeyId, false) as {
    OwnerHistory?: IfcHandle | null
    ObjectPlacement?: IfcHandle | null
  } | null
  if (!targetStorey) {
    throw new Error(`Storey #${storeyId} is missing from the IFC model.`)
  }

  const targetStoreyPlacementId = targetStorey.ObjectPlacement?.value ?? null
  if (targetStoreyPlacementId === null) {
    throw new Error(`Storey #${storeyId} is missing ObjectPlacement.`)
  }

  const containment = findStoreyContainmentRelation(api, modelId, relationType, storeyId)

  return {
    storeyId,
    targetStoreyPlacementId,
    ownerHistory: toHandle(targetStorey.OwnerHistory),
    containment,
  }
}

function resolveRiserPlacement(
  api: IfcAPI,
  modelId: number,
  storeyContext: StoreyContext,
  riser: Riser,
  sourceUnitsPerViewerUnit: number,
): ResolvedRiserPlacement {
  const exportPosition = riser.position

  const storeyWorldMatrix = resolveLocalPlacementWorldMatrix(api, modelId, storeyContext.targetStoreyPlacementId)
  const inverseStoreyWorldMatrix = storeyWorldMatrix.clone().invert()
  const storeyWorldOrigin = new Vector3().setFromMatrixPosition(storeyWorldMatrix)
  const ifcWorldPoint = toIfcWorldPlanPoint(exportPosition, sourceUnitsPerViewerUnit, storeyWorldOrigin.z)
  const localPoint = ifcWorldPoint.clone().applyMatrix4(inverseStoreyWorldMatrix)
  const parentPlacementAxes = readLocalPlacementAxes(api, modelId, storeyContext.targetStoreyPlacementId)

  return {
    webPositionUsedForExport: vectorLikeToDebugPoint(exportPosition),
    worldOrModelPosition: vectorToDebugPoint(ifcWorldPoint),
    finalIfcLocalPlacement: vectorToDebugPoint(localPoint),
    parentPlacementOrigin: vectorToDebugPoint(storeyWorldOrigin),
    parentPlacementAxis: vectorToDebugPoint(parentPlacementAxes.axis),
    parentPlacementRefDirection: vectorToDebugPoint(parentPlacementAxes.refDirection),
  }
}

function createDebugArtifact(
  options: FullIfcRiserDebugOptions,
  schema: string,
  sourceFloorPlanBounds: PlanBounds | null,
  sourceFrame: ModelSourceFrame | null,
): FullIfcRiserDebugArtifact {
  return {
    exportRunId: options.exportRunId ?? createExportRunId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    sourceIfcName: options.sourceIfcName ?? null,
    schema,
    sourceFloorPlanBounds,
    modelOrigin: options.modelOrigin ?? null,
    sourceFrame,
    systemAssignment: null,
    sanitaryRouteExport: null,
    risers: [],
    warnings: [],
    notes: [
      'Generated by the BIMPipe full IFC export flow.',
      'worldOrModelPosition and finalIfcLocalPlacement are in source IFC length units.',
      'Each riser is now exported as one continuous IfcFlowSegment per stack; previous per-storey 3 m segments are no longer produced.',
    ],
  }
}

function buildRiserDebugRecord(
  api: IfcAPI,
  modelId: number,
  artifact: FullIfcRiserDebugArtifact,
  schema: string,
  storeyContext: StoreyContext,
  storeysById: Map<StoreyId, StoreySpanInfo>,
  stack: StackGroup,
  placement: ResolvedRiserPlacement,
  writtenRiser: WrittenRiser,
  extrusionLengthSourceUnits: number,
): FullIfcRiserDebugRecord {
  const bottomStoreyInfo = storeysById.get(stack.bottomRiser.storeyId) ?? {
    id: stack.bottomRiser.storeyId,
    name: null,
    elevation: null,
  }
  const topStoreyInfo = storeysById.get(stack.topRiser.storeyId) ?? {
    id: stack.topRiser.storeyId,
    name: null,
    elevation: null,
  }
  const warnings = [
    ...(!bottomStoreyInfo.name ? ['Storey name was not available from app state or IFC line.'] : []),
  ]

  return {
    exportRunId: artifact.exportRunId,
    timestamp: artifact.timestamp,
    sourceIfcName: artifact.sourceIfcName,
    schema,
    riserId: stack.bottomRiser.id,
    riserTag: stack.stackLabel,
    floorId: stack.bottomRiser.storeyId,
    floorName: bottomStoreyInfo.name,
    storeyEntityId: storeyContext.storeyId,
    storeyName: bottomStoreyInfo.name,
    storeyElevation: bottomStoreyInfo.elevation,
    webPositionRaw: vectorLikeToDebugPoint(stack.canonicalPosition),
    webPositionUsedForExport: placement.webPositionUsedForExport,
    floorLocalPosition: placement.finalIfcLocalPlacement,
    worldOrModelPosition: placement.worldOrModelPosition,
    chosenAnchorEntityId: storeyContext.targetStoreyPlacementId,
    chosenAnchorType: getIfcTypeName(api, modelId, storeyContext.targetStoreyPlacementId),
    chosenParentPlacementId: storeyContext.targetStoreyPlacementId,
    parentPlacementOrigin: placement.parentPlacementOrigin,
    parentPlacementAxis: placement.parentPlacementAxis,
    parentPlacementRefDirection: placement.parentPlacementRefDirection,
    finalIfcLocalPlacement: placement.finalIfcLocalPlacement,
    bottomStoreyEntityId: stack.bottomRiser.storeyId,
    bottomStoreyName: bottomStoreyInfo.name,
    bottomStoreyElevation: bottomStoreyInfo.elevation,
    topStoreyEntityId: stack.topRiser.storeyId,
    topStoreyName: topStoreyInfo.name,
    topStoreyElevation: topStoreyInfo.elevation,
    coveredStoreyIds: stack.members.map((member) => member.storeyId),
    extrusionLengthSourceUnits,
    diameterMm: stack.diameterMm,
    createdEntityIds: compactIdMap(writtenRiser.createdEntityIds),
    createdRelationIds: compactIdMap(writtenRiser.createdRelationIds),
    warnings,
    notes: [
      'Plan position written verbatim from web frame after axis swap and storey-chain inverse.',
    ],
  }
}

function resolveStoreyDebugInfo(
  api: IfcAPI,
  modelId: number,
  storeyId: StoreyId,
  debugStoreysById: Map<StoreyId, RiserStoreyDebugInfo>,
): { name: string | null; elevation: number | null } {
  const appStorey = debugStoreysById.get(storeyId)
  if (appStorey) {
    return {
      name: appStorey.name,
      elevation: appStorey.elevation,
    }
  }

  const ifcStorey = api.GetLine(modelId, storeyId, false) as {
    Name?: { value?: string } | string | null
    Elevation?: { value?: number } | number | null
  } | null

  return {
    name: readOptionalStringValue(ifcStorey?.Name),
    elevation: readOptionalNumberValue(ifcStorey?.Elevation),
  }
}

function readLocalPlacementAxes(
  api: IfcAPI,
  modelId: number,
  placementId: number,
): { axis: Vector3; refDirection: Vector3 } {
  const placement = api.GetLine(modelId, placementId, false) as {
    RelativePlacement?: IfcHandle | null
  } | null
  const relativePlacementId = placement?.RelativePlacement?.value ?? null
  if (relativePlacementId === null) {
    return {
      axis: new Vector3(0, 0, 1),
      refDirection: new Vector3(1, 0, 0),
    }
  }

  const relativePlacement = api.GetLine(modelId, relativePlacementId, false) as {
    Axis?: IfcHandle | null
    RefDirection?: IfcHandle | null
  } | null

  return {
    axis: readDirection(api, modelId, relativePlacement?.Axis?.value ?? null, new Vector3(0, 0, 1)),
    refDirection: readDirection(api, modelId, relativePlacement?.RefDirection?.value ?? null, new Vector3(1, 0, 0)),
  }
}

function compactIdMap(ids: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(ids).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
}

function vectorToDebugPoint(vector: Vector3): Point3Debug {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  }
}

function vectorLikeToDebugPoint(point: { x: number; y: number; z: number }): Point3Debug {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
  }
}

function readOptionalStringValue(value: { value?: string } | string | null | undefined): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && typeof value?.value === 'string') return value.value
  return null
}

function readOptionalNumberValue(value: { value?: number } | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && typeof value?.value === 'number' && Number.isFinite(value.value)) {
    return value.value
  }
  return null
}

function getIfcTypeName(api: IfcAPI, modelId: number, expressId: number): string {
  const typeCode = api.GetLineType(modelId, expressId)
  if (typeCode < 0) return 'Unknown'
  return api.GetNameFromTypeCode(typeCode)
}

function createExportRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `riser-export-${Date.now().toString(36)}`
}

function writeMinimalRiser(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  schema: string,
  bodyContextId: number,
  targetStoreyPlacementId: number,
  ownerHistory: IfcHandle | null,
  riser: ExportRiser,
  localPoint: Vector3,
  diameterMm: number,
  riserExtrusionLengthSourceUnits: number,
  millimetresPerSourceUnit: number,
): WrittenRiser {
  const riserRadiusSourceUnits = (diameterMm / 2) / millimetresPerSourceUnit
  const {
    IFCAXIS2PLACEMENT2D,
    IFCAXIS2PLACEMENT3D,
    IFCCARTESIANPOINT,
    IFCCIRCLEPROFILEDEF,
    IFCEXTRUDEDAREASOLID,
    IFCFLOWSEGMENT,
    IFCIDENTIFIER,
    IFCLABEL,
    IFCLENGTHMEASURE,
    IFCLOCALPLACEMENT,
    IFCMATERIAL,
    IFCPIPESEGMENT,
    IFCPIPESEGMENTTYPE,
    IFCPRODUCTDEFINITIONSHAPE,
    IFCRELASSOCIATESMATERIAL,
    IFCRELDEFINESBYTYPE,
    IFCSHAPEREPRESENTATION,
  } = ifc

  const point2d = writeLabeledLine(api, modelId, 'profile point', {
    expressID: -1,
    type: IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, 0),
    ],
  })

  const dir2d = writeLabeledLine(api, modelId, 'profile direction', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCDIRECTION'),
    DirectionRatios: [1, 0],
  })

  const profilePlacement = writeLabeledLine(api, modelId, 'profile placement', {
    expressID: -1,
    type: IFCAXIS2PLACEMENT2D,
    Location: handleRef(point2d.expressID),
    RefDirection: handleRef(dir2d.expressID),
  })

  const profile = writeLabeledLine(api, modelId, 'circle profile', {
    expressID: -1,
    type: IFCCIRCLEPROFILEDEF,
    ProfileType: { type: 3, value: 'AREA' },
    ProfileName: null,
    Position: handleRef(profilePlacement.expressID),
    Radius: api.CreateIfcType(modelId, IFCLENGTHMEASURE, riserRadiusSourceUnits),
  })

  const point3d = writeLabeledLine(api, modelId, 'swept solid point', {
    expressID: -1,
    type: IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, 0),
    ],
  })

  const dirZ = writeLabeledLine(api, modelId, 'vertical direction', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCDIRECTION'),
    DirectionRatios: [0, 0, 1],
  })

  const dirX = writeLabeledLine(api, modelId, 'x direction', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCDIRECTION'),
    DirectionRatios: [1, 0, 0],
  })

  const sweptPlacement = writeLabeledLine(api, modelId, 'swept solid placement', {
    expressID: -1,
    type: IFCAXIS2PLACEMENT3D,
    Location: handleRef(point3d.expressID),
    Axis: handleRef(dirZ.expressID),
    RefDirection: handleRef(dirX.expressID),
  })

  const solid = writeLabeledLine(api, modelId, 'extruded solid', {
    expressID: -1,
    type: IFCEXTRUDEDAREASOLID,
    SweptArea: handleRef(profile.expressID),
    Position: handleRef(sweptPlacement.expressID),
    ExtrudedDirection: handleRef(dirZ.expressID),
    Depth: api.CreateIfcType(modelId, IFCLENGTHMEASURE, riserExtrusionLengthSourceUnits),
  })

  const shape = writeLabeledLine(api, modelId, 'shape representation', {
    expressID: -1,
    type: IFCSHAPEREPRESENTATION,
    ContextOfItems: handleRef(bodyContextId),
    RepresentationIdentifier: api.CreateIfcType(modelId, IFCLABEL, 'Body'),
    RepresentationType: api.CreateIfcType(modelId, IFCLABEL, 'SweptSolid'),
    Items: [handleRef(solid.expressID)],
  })

  const productShape = writeLabeledLine(api, modelId, 'product definition shape', {
    expressID: -1,
    type: IFCPRODUCTDEFINITIONSHAPE,
    Name: null,
    Description: null,
    Representations: [handleRef(shape.expressID)],
  })

  const placementPoint = writeLabeledLine(api, modelId, 'object placement point', {
    expressID: -1,
    type: IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, localPoint.x),
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, localPoint.y),
      api.CreateIfcType(modelId, IFCLENGTHMEASURE, localPoint.z),
    ],
  })

  const placementAxis = writeLabeledLine(api, modelId, 'object placement axis', {
    expressID: -1,
    type: IFCAXIS2PLACEMENT3D,
    Location: handleRef(placementPoint.expressID),
    Axis: handleRef(dirZ.expressID),
    RefDirection: handleRef(dirX.expressID),
  })

  const localPlacement = writeLabeledLine(api, modelId, 'local placement', {
    expressID: -1,
    type: IFCLOCALPLACEMENT,
    PlacementRelTo: handleRef(targetStoreyPlacementId),
    RelativePlacement: handleRef(placementAxis.expressID),
  })

  const stackLabel = riser.stackLabel.trim() || 'R1'
  const riserName = `BIMPipe ${stackLabel}`
  const riserElementType = schema === 'IFC2X3' ? IFCFLOWSEGMENT : IFCPIPESEGMENT

  const riserElement = writeLabeledLine(api, modelId, 'riser element', {
    expressID: -1,
    type: riserElementType,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, IFCLABEL, riserName),
    Description: null,
    ObjectType: api.CreateIfcType(modelId, IFCLABEL, 'BIMPipeRiser'),
    ObjectPlacement: handleRef(localPlacement.expressID),
    Representation: handleRef(productShape.expressID),
    Tag: api.CreateIfcType(modelId, IFCIDENTIFIER, stackLabel),
    ...(schema === 'IFC2X3' ? {} : { PredefinedType: { type: 3, value: 'NOTDEFINED' } }),
  })

  let pipeSegmentType: IfcWritableLine | null = null
  let typeRelation: IfcEntityRef | null = null
  let typeCommonPset: { pset: IfcEntityRef; relation: IfcEntityRef } | null = null
  if (schema === 'IFC2X3') {
    pipeSegmentType = writeLabeledLine(api, modelId, 'pipe segment type', {
      expressID: -1,
      type: IFCPIPESEGMENTTYPE,
      GlobalId: api.CreateIFCGloballyUniqueId(modelId),
      OwnerHistory: ownerHistory,
      Name: api.CreateIfcType(modelId, IFCLABEL, `BIMPipe PVC ${diameterMm}`),
      Description: null,
      ApplicableOccurrence: null,
      HasPropertySets: [],
      RepresentationMaps: null,
      Tag: api.CreateIfcType(modelId, IFCLABEL, `${stackLabel}-Type`),
      ElementType: api.CreateIfcType(modelId, IFCLABEL, `PVC ${diameterMm} Pipe Type`),
      PredefinedType: { type: 3, value: 'RIGIDSEGMENT' },
    })

    typeRelation = writeLabeledLine(api, modelId, 'type relation', {
      expressID: -1,
      type: IFCRELDEFINESBYTYPE,
      GlobalId: api.CreateIFCGloballyUniqueId(modelId),
      OwnerHistory: ownerHistory,
      Name: null,
      Description: null,
      RelatedObjects: [handleRef(riserElement.expressID)],
      RelatingType: handleRef(pipeSegmentType.expressID),
    })

    typeCommonPset = writePipeSegmentTypeCommonPset(
      api,
      ifc,
      modelId,
      ownerHistory,
      pipeSegmentType,
      stackLabel,
      diameterMm,
      millimetresPerSourceUnit,
    )
    pipeSegmentType.HasPropertySets = [handleRef(typeCommonPset.pset.expressID)]
    writeLabeledLine(api, modelId, 'pipe segment type inline property sets', pipeSegmentType)
  }

  const material = writeLabeledLine(api, modelId, 'material', {
    expressID: -1,
    type: IFCMATERIAL,
    Name: api.CreateIfcType(modelId, IFCLABEL, RISER_MATERIAL_NAME),
  })

  const materialRelation = writeLabeledLine(api, modelId, 'material relation', {
    expressID: -1,
    type: IFCRELASSOCIATESMATERIAL,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: null,
    Description: null,
    RelatedObjects: [handleRef(riserElement.expressID)],
    RelatingMaterial: handleRef(material.expressID),
  })

  const occurrencePset = writeFlowSegmentOccurrencePset(
    api,
    ifc,
    modelId,
    ownerHistory,
    riserElement,
    riserExtrusionLengthSourceUnits,
    diameterMm / millimetresPerSourceUnit,
  )
  const baseQuantities = writePipeSegmentBaseQuantities(
    api,
    ifc,
    modelId,
    ownerHistory,
    riserElement,
    riserExtrusionLengthSourceUnits,
    diameterMm / millimetresPerSourceUnit,
  )

  return {
    element: riserElement,
    createdEntityIds: {
      riserElement: riserElement.expressID,
      flowSegment: schema === 'IFC2X3' ? riserElement.expressID : undefined,
      pipeSegment: schema === 'IFC2X3' ? undefined : riserElement.expressID,
      pipeSegmentType: pipeSegmentType?.expressID,
      psetTypeCommon: typeCommonPset?.pset.expressID,
      psetOccurrence: occurrencePset.pset.expressID,
      qtoSet: baseQuantities.qtoSet.expressID,
      material: material.expressID,
      circleProfile: profile.expressID,
      extrudedAreaSolid: solid.expressID,
      shapeRepresentation: shape.expressID,
      productDefinitionShape: productShape.expressID,
      localPlacement: localPlacement.expressID,
      placementAxis: placementAxis.expressID,
      placementPoint: placementPoint.expressID,
      profilePoint: point2d.expressID,
      profileDirection: dir2d.expressID,
      profilePlacement: profilePlacement.expressID,
      sweptSolidPoint: point3d.expressID,
      verticalDirection: dirZ.expressID,
      xDirection: dirX.expressID,
      sweptSolidPlacement: sweptPlacement.expressID,
    },
    createdRelationIds: {
      typeRelation: typeRelation?.expressID,
      psetTypeCommonRel: typeCommonPset?.relation.expressID,
      psetOccurrenceRel: occurrencePset.relation.expressID,
      qtoSetRel: baseQuantities.relation.expressID,
      materialRelation: materialRelation.expressID,
    },
  }
}

type BranchRouteExportResult = {
  handles: IfcHandle[]
  ownerHistory: IfcHandle | null
  writtenCount: number
}

/**
 * Writes each branch RouteSegment as one IfcFlowSegment (IFC2X3) / IfcPipeSegment
 * (IFC4) whose representation is a circular profile extruded in a straight line
 * between the segment's sloped endpoints. This is an honest simplification: runs
 * are straight sweeps between endpoint levels, with no elbows/fittings at corners
 * and no junction geometry where segments meet.
 *
 * Elevation datum: RouteSegment endpoint elevations are relative to the branch
 * connection at the riser (0 = storey slab level), so the absolute elevation is
 * storey elevation + endpoint elevation.
 *
 * Schema parity mirrors the stack path: IFC2X3 additionally writes one shared
 * IfcPipeSegmentType with Pset_PipeSegmentTypeCommon; IFC4 intentionally writes
 * no type object/pset (see TODO(BIM-51)).
 */
function writeBranchRouteSegments(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  schema: string,
  bodyContextId: number,
  branchRoutes: FloorRoutes[],
  storeysById: Map<StoreyId, StoreySpanInfo>,
  risersById: Map<string, ExportRiser>,
  sourceUnitsPerViewerUnit: number,
  millimetresPerSourceUnit: number,
  resolveStoreyContext: (storeyId: StoreyId) => StoreyContext,
  resolveViewerPointToStoreyLocal: (
    storeyContext: StoreyContext,
    position: { x: number; y: number; z: number },
    elevationSourceUnits: number,
  ) => Vector3,
  relationContainedInSpatialStructure: number,
  exportNotes?: string[],
): BranchRouteExportResult {
  const segmentCount = branchRoutes.reduce((count, floor) => count + floor.segments.length, 0)
  if (segmentCount === 0) {
    return { handles: [], ownerHistory: null, writtenCount: 0 }
  }

  const elementType = schema === 'IFC2X3' ? ifc.IFCFLOWSEGMENT : ifc.IFCPIPESEGMENT
  const handles: IfcHandle[] = []
  const elements: IfcEntityRef[] = []
  const elementsByDiameterMm = new Map<number, IfcEntityRef[]>()
  let ownerHistory: IfcHandle | null = null

  for (const floor of branchRoutes) {
    if (floor.segments.length === 0) continue
    const storey = storeysById.get(floor.storeyId)
    const storeyElevation = storey?.elevation
    if (typeof storeyElevation !== 'number' || !Number.isFinite(storeyElevation)) {
      throw new Error(
        `Branch routes on storey #${floor.storeyId} cannot be exported: the storey has no resolvable elevation.`,
      )
    }
    const metresPerPlanUnit = floor.planUnits === 'mm' ? 0.001 : 1
    const storeyContext = resolveStoreyContext(floor.storeyId)
    ownerHistory ??= storeyContext.ownerHistory

    const endpointToLocal = (endpoint: RouteSegmentEndpoint): Vector3 =>
      resolveViewerPointToStoreyLocal(
        storeyContext,
        { x: endpoint.x * metresPerPlanUnit, y: 0, z: endpoint.z * metresPerPlanUnit },
        storeyElevation + endpoint.elevation * metresPerPlanUnit * sourceUnitsPerViewerUnit,
      )

    for (const segment of floor.segments) {
      const stackLabel = risersById.get(segment.riserId)?.stackLabel ?? segment.riserId
      const startLocal = endpointToLocal(segment.start)
      const endLocal = endpointToLocal(segment.end)
      const runVector = endLocal.clone().sub(startLocal)
      const runLength = runVector.length()
      if (!Number.isFinite(runLength) || runLength <= 1e-6) {
        throw new Error(
          `Branch route segment ${segment.id} on storey #${floor.storeyId} resolved to zero length in IFC coordinates.`,
        )
      }
      const runAxis = runVector.clone().normalize()
      const diameterMm = resolveBranchSegmentExportDiameterMm(segment)
      const diameterSourceUnits = diameterMm / millimetresPerSourceUnit
      const radiusSourceUnits = diameterSourceUnits / 2

      const element = writeBranchSegmentElement(
        api,
        ifc,
        modelId,
        schema,
        bodyContextId,
        storeyContext,
        segment,
        stackLabel,
        diameterMm,
        startLocal,
        runAxis,
        runLength,
        radiusSourceUnits,
        elementType,
      )

      writeFlowSegmentOccurrencePset(api, ifc, modelId, storeyContext.ownerHistory, element, runLength, diameterSourceUnits)
      writePipeSegmentBaseQuantities(api, ifc, modelId, storeyContext.ownerHistory, element, runLength, diameterSourceUnits)
      const sameDiameter = elementsByDiameterMm.get(diameterMm) ?? []
      sameDiameter.push(element)
      elementsByDiameterMm.set(diameterMm, sameDiameter)
      appendBranchSegmentToStoreyContainment(
        api,
        ifc,
        modelId,
        storeyContext,
        element.expressID,
        relationContainedInSpatialStructure,
      )

      handles.push(handleRef(element.expressID))
      elements.push(element)
    }
  }

  if (elements.length > 0) {
    const material = writeLabeledLine(api, modelId, 'branch route material', {
      expressID: -1,
      type: ifc.IFCMATERIAL,
      Name: api.CreateIfcType(modelId, ifc.IFCLABEL, RISER_MATERIAL_NAME),
    })
    writeLabeledLine(api, modelId, 'branch route material relation', {
      expressID: -1,
      type: ifc.IFCRELASSOCIATESMATERIAL,
      GlobalId: api.CreateIFCGloballyUniqueId(modelId),
      OwnerHistory: ownerHistory,
      Name: null,
      Description: null,
      RelatedObjects: elements.map((element) => handleRef(element.expressID)),
      RelatingMaterial: handleRef(material.expressID),
    })

    if (schema === 'IFC2X3') {
      for (const diameterMm of [...elementsByDiameterMm.keys()].sort((a, b) => a - b)) {
        writeSharedBranchPipeSegmentType(
          api,
          ifc,
          modelId,
          ownerHistory,
          elementsByDiameterMm.get(diameterMm) ?? [],
          diameterMm,
          millimetresPerSourceUnit,
        )
      }
    } else {
      // TODO(BIM-51): like the stack and sanitary-route paths, IFC4 branch export
      // intentionally writes no IfcPipeSegmentType / type-level Pset_PipeSegmentTypeCommon yet.
      exportNotes?.push(
        'IFC4 branch route export omits IfcPipeSegmentType/NominalDiameter type psets (not yet implemented).',
      )
    }
  }

  exportNotes?.push(
    `Exported ${elements.length} branch route segment(s) as straight circular sweeps between sloped endpoints (no fittings).`,
  )

  return { handles, ownerHistory, writtenCount: elements.length }
}

// The element placement is a pure translation to the segment start; the sweep
// orientation lives solely in the extruded solid's Position (Axis = run direction),
// so the run direction is applied exactly once.
function writeBranchSegmentElement(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  schema: string,
  bodyContextId: number,
  storeyContext: StoreyContext,
  segment: RouteSegment,
  stackLabel: string,
  diameterMm: number,
  startLocal: Vector3,
  runAxis: Vector3,
  runLength: number,
  radiusSourceUnits: number,
  elementType: number,
): IfcEntityRef {
  const types = ifc
  const point2d = writeLabeledLine(api, modelId, 'branch profile point', {
    expressID: -1,
    type: types.IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, 0),
    ],
  })
  const dir2d = writeLabeledLine(api, modelId, 'branch profile direction', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCDIRECTION'),
    DirectionRatios: [1, 0],
  })
  const profilePlacement = writeLabeledLine(api, modelId, 'branch profile placement', {
    expressID: -1,
    type: types.IFCAXIS2PLACEMENT2D,
    Location: handleRef(point2d.expressID),
    RefDirection: handleRef(dir2d.expressID),
  })
  const profile = writeLabeledLine(api, modelId, 'branch circle profile', {
    expressID: -1,
    type: types.IFCCIRCLEPROFILEDEF,
    ProfileType: { type: 3, value: 'AREA' },
    ProfileName: null,
    Position: handleRef(profilePlacement.expressID),
    Radius: api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, radiusSourceUnits),
  })

  const point3d = writeLabeledLine(api, modelId, 'branch swept solid point', {
    expressID: -1,
    type: types.IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, 0),
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, 0),
    ],
  })
  const runDirection = writeBranchDirection(api, modelId, runAxis)
  const perpendicular = writeBranchDirection(api, modelId, pickBranchPerpendicularReference(runAxis))
  const solidLocalZ = writeBranchDirection(api, modelId, new Vector3(0, 0, 1))
  const sweptPlacement = writeLabeledLine(api, modelId, 'branch swept solid placement', {
    expressID: -1,
    type: types.IFCAXIS2PLACEMENT3D,
    Location: handleRef(point3d.expressID),
    Axis: handleRef(runDirection.expressID),
    RefDirection: handleRef(perpendicular.expressID),
  })
  const solid = writeLabeledLine(api, modelId, 'branch extruded solid', {
    expressID: -1,
    type: types.IFCEXTRUDEDAREASOLID,
    SweptArea: handleRef(profile.expressID),
    Position: handleRef(sweptPlacement.expressID),
    ExtrudedDirection: handleRef(solidLocalZ.expressID),
    Depth: api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, runLength),
  })
  const shape = writeLabeledLine(api, modelId, 'branch shape representation', {
    expressID: -1,
    type: types.IFCSHAPEREPRESENTATION,
    ContextOfItems: handleRef(bodyContextId),
    RepresentationIdentifier: api.CreateIfcType(modelId, types.IFCLABEL, 'Body'),
    RepresentationType: api.CreateIfcType(modelId, types.IFCLABEL, 'SweptSolid'),
    Items: [handleRef(solid.expressID)],
  })
  const productShape = writeLabeledLine(api, modelId, 'branch product definition shape', {
    expressID: -1,
    type: types.IFCPRODUCTDEFINITIONSHAPE,
    Name: null,
    Description: null,
    Representations: [handleRef(shape.expressID)],
  })

  const placementPoint = writeLabeledLine(api, modelId, 'branch object placement point', {
    expressID: -1,
    type: types.IFCCARTESIANPOINT,
    Coordinates: [
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, startLocal.x),
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, startLocal.y),
      api.CreateIfcType(modelId, types.IFCLENGTHMEASURE, startLocal.z),
    ],
  })
  const placementAxis = writeLabeledLine(api, modelId, 'branch object placement axis', {
    expressID: -1,
    type: types.IFCAXIS2PLACEMENT3D,
    Location: handleRef(placementPoint.expressID),
    Axis: null,
    RefDirection: null,
  })
  const localPlacement = writeLabeledLine(api, modelId, 'branch local placement', {
    expressID: -1,
    type: types.IFCLOCALPLACEMENT,
    PlacementRelTo: handleRef(storeyContext.targetStoreyPlacementId),
    RelativePlacement: handleRef(placementAxis.expressID),
  })

  const roleLabel = segment.kind === 'trunk' ? 'Trunk' : 'Branch'
  return writeLabeledLine(api, modelId, 'branch route element', {
    expressID: -1,
    type: elementType,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: storeyContext.ownerHistory,
    Name: api.CreateIfcType(
      modelId,
      types.IFCLABEL,
      `BIMPipe ${roleLabel} ${diameterMm}mm -> ${stackLabel}`,
    ),
    Description: api.CreateIfcType(
      modelId,
      types.IFCLABEL,
      'Axis-aligned sloped branch run toward the riser; straight circular sweep between endpoints (no fittings).',
    ),
    ObjectType: api.CreateIfcType(modelId, types.IFCLABEL, 'BIMPipeBranchRoute'),
    ObjectPlacement: handleRef(localPlacement.expressID),
    Representation: handleRef(productShape.expressID),
    Tag: api.CreateIfcType(modelId, types.IFCIDENTIFIER, segment.id),
    ...(schema === 'IFC2X3' ? {} : { PredefinedType: { type: 3, value: 'NOTDEFINED' } }),
  })
}

function resolveBranchSegmentExportDiameterMm(segment: RouteSegment): number {
  const diameterMm = segment.diameterMm
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) {
    return BRANCH_ROUTE_FALLBACK_DIAMETER_MM
  }
  return diameterMm
}

// One shared IfcPipeSegmentType per distinct branch diameter (Ø50 / Ø63 / Ø110)
// covers every exported branch segment of that diameter, matching the
// IFC2X3-only behavior of the stack and sanitary-route paths.
function writeSharedBranchPipeSegmentType(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  ownerHistory: IfcHandle | null,
  elements: IfcEntityRef[],
  diameterMm: number,
  millimetresPerSourceUnit: number,
): void {
  if (elements.length === 0) return
  const typeName = `BIMPipe PVC ${diameterMm} Branch`
  const pipeSegmentType = writeLabeledLine(api, modelId, 'branch pipe segment type', {
    expressID: -1,
    type: ifc.IFCPIPESEGMENTTYPE,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, typeName),
    Description: null,
    ApplicableOccurrence: null,
    HasPropertySets: [],
    RepresentationMaps: null,
    Tag: api.CreateIfcType(modelId, ifc.IFCLABEL, `BranchRoutes-${diameterMm}-Type`),
    ElementType: api.CreateIfcType(modelId, ifc.IFCLABEL, typeName),
    PredefinedType: { type: 3, value: 'RIGIDSEGMENT' },
  })

  writeLabeledLine(api, modelId, 'branch type relation', {
    expressID: -1,
    type: ifc.IFCRELDEFINESBYTYPE,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: null,
    Description: null,
    RelatedObjects: elements.map((element) => handleRef(element.expressID)),
    RelatingType: handleRef(pipeSegmentType.expressID),
  })

  const diameterSourceUnits = diameterMm / millimetresPerSourceUnit
  const properties = [
    writePropertySingleValue(
      api,
      ifc,
      modelId,
      'NominalDiameter',
      api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
      diameterSourceUnits,
    ),
    writePropertySingleValue(
      api,
      ifc,
      modelId,
      'OuterDiameter',
      api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
      diameterSourceUnits,
    ),
    writePropertySingleValue(
      api,
      ifc,
      modelId,
      'Reference',
      api.GetTypeCodeFromName('IFCIDENTIFIER'),
      `BranchRoutes-${diameterMm}`,
    ),
  ]
  const pset = writePropertySet(api, ifc, modelId, ownerHistory, 'Pset_PipeSegmentTypeCommon', properties)
  writeRelDefinesByProperties(api, modelId, ownerHistory, [pipeSegmentType], pset)
  // Written first with empty HasPropertySets so the pset can reference the type; WriteLine
  // is an upsert keyed by expressID, so this re-write updates the same line.
  pipeSegmentType.HasPropertySets = [handleRef(pset.expressID)]
  writeLabeledLine(api, modelId, 'branch pipe segment type property sets', pipeSegmentType)
}

function appendBranchSegmentToStoreyContainment(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  storeyContext: StoreyContext,
  elementExpressId: number,
  relationContainedInSpatialStructure: number,
): void {
  const createdHandle = handleRef(elementExpressId)
  if (storeyContext.containment) {
    storeyContext.containment.RelatedElements = [
      ...(Array.isArray(storeyContext.containment.RelatedElements)
        ? storeyContext.containment.RelatedElements
        : []),
      createdHandle,
    ]
    api.WriteLine(modelId, storeyContext.containment)
    return
  }

  const relation = writeLabeledLine(api, modelId, 'branch route containment', {
    expressID: -1,
    type: relationContainedInSpatialStructure,
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: storeyContext.ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, 'BIMPipe branch routes'),
    Description: null,
    RelatedElements: [createdHandle],
    RelatingStructure: handleRef(storeyContext.storeyId),
  })
  storeyContext.containment = relation as unknown as StoreyContext['containment']
}

function pickBranchPerpendicularReference(axis: Vector3): Vector3 {
  const worldUp = new Vector3(0, 0, 1)
  const candidate = new Vector3().crossVectors(worldUp, axis)
  if (candidate.lengthSq() > 1e-9) return candidate.normalize()
  return new Vector3(1, 0, 0)
}

function writeBranchDirection(api: IfcAPI, modelId: number, direction: Vector3): IfcEntityRef {
  return writeLabeledLine(api, modelId, 'branch direction', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCDIRECTION'),
    DirectionRatios: [direction.x, direction.y, direction.z],
  })
}

function writePipeSegmentTypeCommonPset(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  ownerHistory: IfcHandle | null,
  typeHandle: IfcEntityRef,
  stackLabel: string,
  diameterMm: number,
  millimetresPerSourceUnit: number,
): { pset: IfcEntityRef; relation: IfcEntityRef } {
  const nominalDiameter = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'NominalDiameter',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    diameterMm / millimetresPerSourceUnit,
  )
  const outerDiameter = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'OuterDiameter',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    diameterMm / millimetresPerSourceUnit,
  )
  const innerDiameter = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'InnerDiameter',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    (diameterMm - 2 * RISER_WALL_THICKNESS_MM) / millimetresPerSourceUnit,
  )
  const wallThickness = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'WallThickness',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    RISER_WALL_THICKNESS_MM / millimetresPerSourceUnit,
  )
  const roughness = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'Roughness',
    api.GetTypeCodeFromName('IFCLENGTHMEASURE'),
    RISER_ROUGHNESS_MM / millimetresPerSourceUnit,
  )
  const reference = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'Reference',
    api.GetTypeCodeFromName('IFCIDENTIFIER'),
    stackLabel,
  )
  const pset = writePropertySet(api, ifc, modelId, ownerHistory, 'Pset_PipeSegmentTypeCommon', [
    nominalDiameter,
    outerDiameter,
    innerDiameter,
    wallThickness,
    roughness,
    reference,
  ])
  const relation = writeRelDefinesByProperties(api, modelId, ownerHistory, [typeHandle], pset)

  return { pset, relation }
}

function writePipeSegmentBaseQuantities(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  ownerHistory: IfcHandle | null,
  riserHandle: IfcEntityRef,
  extrusionLengthSourceUnits: number,
  diameterSourceUnits: number,
): { qtoSet: IfcEntityRef; relation: IfcEntityRef } {
  const netLength = writeQuantityLength(api, ifc, modelId, 'NetLength', extrusionLengthSourceUnits)
  const grossLength = writeQuantityLength(api, ifc, modelId, 'GrossLength', extrusionLengthSourceUnits)
  const nominalDiameter = writeQuantityLength(api, ifc, modelId, 'NominalDiameter', diameterSourceUnits)
  const qtoSet = writeLabeledLine(api, modelId, 'pipe segment base quantities', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCELEMENTQUANTITY'),
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, 'Qto_PipeSegmentBaseQuantities'),
    Description: null,
    MethodOfMeasurement: null,
    Quantities: [
      handleRef(netLength.expressID),
      handleRef(grossLength.expressID),
      handleRef(nominalDiameter.expressID),
    ],
  })
  const relation = writeRelDefinesByProperties(api, modelId, ownerHistory, [riserHandle], qtoSet)

  return { qtoSet, relation }
}

function writeQuantityLength(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  name: string,
  lengthValue: number,
): IfcEntityRef {
  return writeLabeledLine(api, modelId, `quantity ${name}`, {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCQUANTITYLENGTH'),
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, name),
    Description: null,
    Unit: null,
    LengthValue: api.CreateIfcType(modelId, ifc.IFCLENGTHMEASURE, lengthValue),
  })
}

function writeFlowSegmentOccurrencePset(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  ownerHistory: IfcHandle | null,
  riserHandle: IfcEntityRef,
  extrusionLengthSourceUnits: number,
  diameterSourceUnits: number,
): { pset: IfcEntityRef; relation: IfcEntityRef } {
  const systemType = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'SystemType',
    api.GetTypeCodeFromName('IFCLABEL'),
    'SANITARY',
  )
  const flowDirection = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'FlowDirection',
    api.GetTypeCodeFromName('IFCLABEL'),
    'NOTDEFINED',
  )
  const length = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'Length',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    extrusionLengthSourceUnits,
  )
  const nominalDiameter = writePropertySingleValue(
    api,
    ifc,
    modelId,
    'NominalDiameter',
    api.GetTypeCodeFromName('IFCPOSITIVELENGTHMEASURE'),
    diameterSourceUnits,
  )
  const pset = writePropertySet(api, ifc, modelId, ownerHistory, 'Pset_FlowSegmentOccurrence', [
    systemType,
    flowDirection,
    length,
    nominalDiameter,
  ])
  const relation = writeRelDefinesByProperties(api, modelId, ownerHistory, [riserHandle], pset)

  return { pset, relation }
}

/**
 * Documents the absolute frame on the IfcProject. Offsets are the context WCS
 * location in the model's own length unit (never converted — the file's unit
 * assignment applies), angles are plain reals in degrees so no IFC angle unit
 * is implied. Geometry is untouched: nothing in the exported file is shifted.
 */
function writeFramePset(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  frame: ModelSourceFrame,
): IfcEntityRef {
  const projectIds = api.GetLineIDsWithType(modelId, ifc.IFCPROJECT)
  if (projectIds.size() === 0) {
    throw new Error(`Source IFC has no IfcProject; cannot attach ${FRAME_PSET_NAME}.`)
  }
  const projectId = projectIds.get(0)
  const project = api.GetLine(modelId, projectId, false) as { OwnerHistory?: IfcHandle | null } | null
  const ownerHistory = toHandle(project?.OwnerHistory)

  const label = api.GetTypeCodeFromName('IFCLABEL')
  const lengthMeasure = api.GetTypeCodeFromName('IFCLENGTHMEASURE')
  const real = api.GetTypeCodeFromName('IFCREAL')
  const properties = [
    writePropertySingleValue(api, ifc, modelId, 'DetectedBy', label, frame.detectedBy),
    writePropertySingleValue(api, ifc, modelId, 'LengthUnit', label, frame.lengthUnit ?? 'unknown'),
    writePropertySingleValue(api, ifc, modelId, 'OffsetX', lengthMeasure, frame.offsetSourceUnits.x),
    writePropertySingleValue(api, ifc, modelId, 'OffsetY', lengthMeasure, frame.offsetSourceUnits.y),
    writePropertySingleValue(api, ifc, modelId, 'OffsetZ', lengthMeasure, frame.offsetSourceUnits.z),
    writePropertySingleValue(api, ifc, modelId, 'WcsRotationDeg', real, frame.wcsRotationDeg),
    ...(frame.trueNorthDeg === null
      ? []
      : [writePropertySingleValue(api, ifc, modelId, 'TrueNorthDeg', real, frame.trueNorthDeg)]),
  ]
  const pset = writePropertySet(
    api,
    ifc,
    modelId,
    ownerHistory,
    FRAME_PSET_NAME,
    properties,
    'Coordinates in this file are project-base-point coordinates. Offset = representation-context ' +
      'WorldCoordinateSystem location (survey point) in the model length unit; TrueNorthDeg = true north ' +
      'from project +Y, degrees, positive toward +X. Written by BIMPipe; no geometry was shifted.',
  )
  writeRelDefinesByProperties(api, modelId, ownerHistory, [{ expressID: projectId, type: ifc.IFCPROJECT }], pset)
  return pset
}

function writePropertySingleValue(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  propertyName: string,
  valueType: number,
  value: string | number,
): IfcEntityRef {
  return writeLabeledLine(api, modelId, `property ${propertyName}`, {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCPROPERTYSINGLEVALUE'),
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, propertyName),
    Description: null,
    NominalValue: api.CreateIfcType(modelId, valueType, value),
    Unit: null,
  })
}

function writePropertySet(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  ownerHistory: IfcHandle | null,
  name: string,
  properties: IfcEntityRef[],
  description: string | null = null,
): IfcEntityRef {
  return writeLabeledLine(api, modelId, `property set ${name}`, {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCPROPERTYSET'),
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, name),
    Description:
      description === null ? null : api.CreateIfcType(modelId, api.GetTypeCodeFromName('IFCTEXT'), description),
    HasProperties: properties.map((property) => handleRef(property.expressID)),
  })
}

function writeRelDefinesByProperties(
  api: IfcAPI,
  modelId: number,
  ownerHistory: IfcHandle | null,
  relatedObjects: IfcEntityRef[],
  propertySet: IfcEntityRef,
): IfcEntityRef {
  return writeLabeledLine(api, modelId, 'property relation', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCRELDEFINESBYPROPERTIES'),
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: null,
    Description: null,
    RelatedObjects: relatedObjects.map((object) => handleRef(object.expressID)),
    RelatingPropertyDefinition: handleRef(propertySet.expressID),
  })
}

function writeSanitarySystemAssignment(
  api: IfcAPI,
  ifc: ImportedIfcTypes,
  modelId: number,
  schema: string,
  ownerHistory: IfcHandle | null,
  riserHandles: IfcHandle[],
): FullIfcSystemAssignmentDebug {
  const buildingType = api.GetTypeCodeFromName('IFCBUILDING')
  const buildingIds = api.GetLineIDsWithType(modelId, buildingType)
  if (buildingIds.size() === 0) {
    throw new Error('Source IFC has no IfcBuilding; cannot attach BIMPipe sanitary system.')
  }

  const buildingId = buildingIds.get(0)
  const system = writeLabeledLine(api, modelId, 'sanitary system', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCSYSTEM'),
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, RISER_SYSTEM_NAME),
    Description: api.CreateIfcType(modelId, api.GetTypeCodeFromName('IFCTEXT'), RISER_SYSTEM_DESCRIPTION),
    ObjectType: api.CreateIfcType(modelId, ifc.IFCLABEL, 'SANITARY'),
  })

  const groupRelation = writeLabeledLine(api, modelId, 'sanitary system assignment', {
    expressID: -1,
    type: api.GetTypeCodeFromName('IFCRELASSIGNSTOGROUP'),
    GlobalId: api.CreateIFCGloballyUniqueId(modelId),
    OwnerHistory: ownerHistory,
    Name: api.CreateIfcType(modelId, ifc.IFCLABEL, 'BIMPipe Sanitary System Assignment'),
    Description: null,
    RelatedObjects: riserHandles,
    // Must be written explicitly as null on IFC4: omitting the attribute makes
    // web-ifc serialize `*`, which misparses RelatingGroup on reopen.
    RelatedObjectsType:
      schema === 'IFC2X3' ? api.CreateIfcType(modelId, ifc.IFCLABEL, 'IFCFLOWSEGMENT') : null,
    RelatingGroup: handleRef(system.expressID),
  })

  if (schema === 'IFC2X3') {
    const serviceRelation = writeLabeledLine(api, modelId, 'sanitary system service', {
      expressID: -1,
      type: api.GetTypeCodeFromName('IFCRELSERVICESBUILDINGS'),
      GlobalId: api.CreateIFCGloballyUniqueId(modelId),
      OwnerHistory: ownerHistory,
      Name: api.CreateIfcType(modelId, ifc.IFCLABEL, 'BIMPipe Sanitary System Service'),
      Description: null,
      RelatedBuildings: [handleRef(buildingId)],
      RelatingSystem: handleRef(system.expressID),
    })

    return {
      ifcSystemId: system.expressID,
      ifcRelAssignsToGroupId: groupRelation.expressID,
      ifcRelServicesBuildingsId: serviceRelation.expressID,
      ifcBuildingId: buildingId,
      name: RISER_SYSTEM_NAME,
      objectType: 'SANITARY',
      description: RISER_SYSTEM_DESCRIPTION,
    }
  }

  return {
    ifcSystemId: system.expressID,
    ifcRelAssignsToGroupId: groupRelation.expressID,
    ifcRelServicesBuildingsId: null,
    ifcBuildingId: buildingId,
    name: RISER_SYSTEM_NAME,
    objectType: 'SANITARY',
    description: RISER_SYSTEM_DESCRIPTION,
  }
}

function findStoreyContainmentRelation(
  api: IfcAPI,
  modelId: number,
  relationType: number,
  storeyId: StoreyId,
): {
  expressID: number
  type: number
  RelatedElements?: unknown[]
  RelatingStructure?: IfcHandle | null
} | null {
  const relationIds = api.GetLineIDsWithType(modelId, relationType)

  for (let i = 0; i < relationIds.size(); i++) {
    const relation = api.GetLine(modelId, relationIds.get(i), false) as {
      expressID: number
      type: number
      RelatedElements?: unknown[]
      RelatingStructure?: IfcHandle | null
    } | null

    const relatingId = relation?.RelatingStructure?.value ?? null
    if (relation && relatingId === storeyId) {
      return relation
    }
  }

  return null
}

function toHandle(value: IfcHandle | { expressID: number } | null | undefined): IfcHandle | null {
  if (!value) return null
  if ('type' in value && value.type === 5 && typeof value.value === 'number') {
    return handleRef(value.value)
  }
  if ('expressID' in value && typeof value.expressID === 'number') return handleRef(value.expressID)
  return null
}

function handleRef(expressId: number): IfcHandle {
  // web-ifc's WriteLine requires a real Handle instance for SELECT-typed attributes
  // (e.g. IfcLocalPlacement.RelativePlacement); a plain { type: 5, value } object throws
  // "Cannot pass non-string to std::string". A Handle instance is accepted everywhere.
  return new Handle(expressId) as unknown as IfcHandle
}

function writeLabeledLine(api: IfcAPI, modelId: number, label: string, line: IfcWritableLine) {
  try {
    api.WriteLine(modelId, line)
    return line
  } catch (error) {
    throw new Error(`Failed to write ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

