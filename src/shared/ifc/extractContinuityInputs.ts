import type { IfcAPI } from 'web-ifc'
import type {
  ContinuityObstructionInput,
  ContinuityObstructionKind,
  ContinuitySpaceInput,
  ContinuityStoreyInput,
  ContinuityVoidInput,
  PlanFootprint,
} from '@/domain/continuityMap'
import type { StoreyId } from '@/domain/types'
import { footprintFromWorldVertices, type WorldVertex } from '@/domain/continuityFootprints'
import { collectSpatialTreeElementsForStoreys } from './collectSpatialTreeElements'
import { parseStoreys } from './parseStoreys'

/**
 * IFC → continuity-map input adapter (W5).
 *
 * Reads walls / columns / slabs, slab openings (via IfcRelVoidsElement) and
 * named spaces per storey and converts them into the simplified geometric
 * inputs consumed by `buildContinuityMap` in `src/domain/continuityMap.ts`.
 *
 * Coordinates are emitted in the model's own world units and in the same
 * frame as `Fixture.position` (identical vertex-transform math to
 * `getIfcElementPosition` in `detectFixtures.ts`): plan plane = (x, z).
 * The caller decides the `units` value passed to `buildContinuityMap` —
 * units are never assumed here.
 *
 * Performance note: this walks GetFlatMesh per element, which is expensive on
 * large models. It is meant for one-shot continuity-map building, not for
 * per-frame use, and is intentionally not exercised against the 63.5 MB 096-A
 * model inside unit tests (see extractContinuityInputs.096.test.ts).
 */

export interface SpaceNameRecord {
  expressId: number
  name: string
}

/**
 * Lightweight space listing (no geometry): every IfcSpace express id with its
 * best-effort display name. Cheap enough to run on large models.
 */
export async function listSpacesWithNames(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<SpaceNameRecord[]> {
  const { IFCSPACE } = await import('web-ifc')

  const records: SpaceNameRecord[] = []
  const ids = api.GetLineIDsWithType(webIfcModelId, IFCSPACE)
  for (let i = 0; i < ids.size(); i++) {
    const expressId = ids.get(i)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = api.GetLine(webIfcModelId, expressId, false) as any
    const name: string =
      line?.LongName?.value ?? line?.Name?.value ?? `Space ${expressId}`
    records.push({ expressId, name })
  }
  return records.sort((a, b) => a.expressId - b.expressId)
}

/**
 * Reads all world-space vertices of an element, transforming each local vertex
 * through the column-major 4×4 flatTransformation (same math as
 * `getIfcElementPosition`). Returns null when the element has no geometry.
 */
function readWorldVertices(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): WorldVertex[] | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    const vertices: WorldVertex[] = []
    for (let gi = 0; gi < flatMesh.geometries.size(); gi++) {
      const placed = flatMesh.geometries.get(gi)
      const t = placed.flatTransformation
      const geomData = api.GetGeometry(webIfcModelId, placed.geometryExpressID)
      const rawVerts = api.GetVertexArray(
        geomData.GetVertexData(),
        geomData.GetVertexDataSize(),
      )
      geomData.delete()

      // Vertex stride is 6: [x, y, z, nx, ny, nz]
      for (let j = 0; j < rawVerts.length / 6; j++) {
        const lx = rawVerts[j * 6]
        const ly = rawVerts[j * 6 + 1]
        const lz = rawVerts[j * 6 + 2]
        vertices.push({
          x: t[0] * lx + t[4] * ly + t[8] * lz + t[12],
          y: t[1] * lx + t[5] * ly + t[9] * lz + t[13],
          z: t[2] * lx + t[6] * ly + t[10] * lz + t[14],
        })
      }
    }
    return vertices
  } catch {
    return null
  }
}

/**
 * Plan bbox footprint of an element, with stray world-origin vertices dropped
 * (see `dropStrayOriginVertices`). Null when no usable geometry exists.
 */
export function extractElementPlanFootprint(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): PlanFootprint | null {
  const vertices = readWorldVertices(api, webIfcModelId, expressId)
  if (vertices === null) return null
  const footprint = footprintFromWorldVertices(vertices)
  if (footprint === null) return null
  return { shape: 'bbox', bounds: footprint.bounds }
}

export interface ContinuityExtractionResult {
  /** Storeys sorted bottom-to-top by elevation, ready for buildContinuityMap. */
  storeys: ContinuityStoreyInput[]
  /** Elements that had to be skipped, with reasons — never silently dropped. */
  diagnostics: string[]
}

export interface ExtractContinuityOptions {
  /**
   * When set, only these storeys (by their express IDs in THIS model) are
   * processed, preserving bottom-to-top order. Scoping to a contiguous window
   * keeps the ≥3-aligned-void rule meaningful locally while avoiding
   * whole-model tessellation on large files.
   */
  storeyIds?: ReadonlySet<StoreyId>
  /**
   * Awaited after each processed storey so a UI can repaint a progress state
   * between the synchronous per-storey tessellation batches.
   */
  onStoreyProgress?: (processed: number, total: number) => void | Promise<void>
}

interface OpeningRelation {
  hostId: number
  openingId: number
}

function readVoidRelations(
  api: IfcAPI,
  webIfcModelId: number,
  relVoidsType: number,
): OpeningRelation[] {
  const relations: OpeningRelation[] = []
  const ids = api.GetLineIDsWithType(webIfcModelId, relVoidsType)
  for (let i = 0; i < ids.size(); i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = api.GetLine(webIfcModelId, ids.get(i), false) as any
    const hostId: number | undefined =
      rel?.RelatingBuildingElement?.value ?? rel?.RelatingBuildingElement?.expressID
    const openingId: number | undefined =
      rel?.RelatedOpeningElement?.value ?? rel?.RelatedOpeningElement?.expressID
    if (typeof hostId === 'number' && typeof openingId === 'number') {
      relations.push({ hostId, openingId })
    }
  }
  return relations.sort((a, b) => a.openingId - b.openingId)
}

function collectTypeIds(api: IfcAPI, webIfcModelId: number, typeConstant: number): Set<number> {
  const set = new Set<number>()
  const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
  for (let i = 0; i < ids.size(); i++) set.add(ids.get(i))
  return set
}

/**
 * Extracts per-storey continuity inputs for the whole model. Storeys come from
 * IfcBuildingStorey (bottom-to-top); elements are assigned to storeys through
 * the spatial tree; openings follow their host element's storey.
 */
export async function extractContinuityStoreyInputs(
  api: IfcAPI,
  webIfcModelId: number,
  options: ExtractContinuityOptions = {},
): Promise<ContinuityExtractionResult> {
  const {
    IFCWALL,
    IFCWALLSTANDARDCASE,
    IFCCOLUMN,
    IFCSLAB,
    IFCSPACE,
    IFCRELVOIDSELEMENT,
  } = await import('web-ifc')

  const diagnostics: string[] = []

  const wallIds = new Set([
    ...collectTypeIds(api, webIfcModelId, IFCWALL),
    ...collectTypeIds(api, webIfcModelId, IFCWALLSTANDARDCASE),
  ])
  const columnIds = collectTypeIds(api, webIfcModelId, IFCCOLUMN)
  const slabIds = collectTypeIds(api, webIfcModelId, IFCSLAB)
  const spaceIds = collectTypeIds(api, webIfcModelId, IFCSPACE)
  const voidRelations = readVoidRelations(api, webIfcModelId, IFCRELVOIDSELEMENT)

  const obstructionKindOf = (expressId: number): ContinuityObstructionKind | null => {
    if (wallIds.has(expressId)) return 'wall'
    if (columnIds.has(expressId)) return 'column'
    if (slabIds.has(expressId)) return 'slab'
    return null
  }

  // parseStoreys returns bottom-to-top ordering, which the continuity map's
  // "consecutive storeys" rule relies on. The domain model id is irrelevant here.
  const allStoreys = await parseStoreys(api, webIfcModelId, 'continuity-extraction')
  const storeys =
    options.storeyIds === undefined
      ? allStoreys
      : allStoreys.filter((storey) => options.storeyIds!.has(storey.id))

  // Spatial relation tables are read once for every storey in scope.
  const spatialByStorey = await collectSpatialTreeElementsForStoreys(
    api,
    webIfcModelId,
    storeys.map((storey) => storey.id),
  )

  const result: ContinuityStoreyInput[] = []

  for (const storey of storeys) {
    const { elementIds, spatialNodeIds } = spatialByStorey.get(storey.id) ?? {
      elementIds: new Set<number>(),
      spatialNodeIds: new Set<number>(),
    }

    const obstructions: ContinuityObstructionInput[] = []
    for (const expressId of [...elementIds].sort((a, b) => a - b)) {
      const kind = obstructionKindOf(expressId)
      if (kind === null) continue
      const footprint = extractElementPlanFootprint(api, webIfcModelId, expressId)
      if (footprint === null) {
        diagnostics.push(
          `${kind} ${expressId} on storey ${storey.id} has no usable geometry and was skipped.`,
        )
        continue
      }
      obstructions.push({ id: `${kind}:${expressId}`, kind, footprint })
    }

    const voids: ContinuityVoidInput[] = []
    for (const relation of voidRelations) {
      if (!elementIds.has(relation.hostId)) continue
      const footprint = extractElementPlanFootprint(api, webIfcModelId, relation.openingId)
      if (footprint === null) {
        diagnostics.push(
          `opening ${relation.openingId} (host ${relation.hostId}) on storey ${storey.id} has no usable geometry and was skipped.`,
        )
        continue
      }
      const hostKind = obstructionKindOf(relation.hostId)
      voids.push({
        id: `opening:${relation.openingId}`,
        kind: hostKind === 'slab' ? 'slab-opening' : 'void',
        footprint,
        // Scopes the carve to the host element (see ContinuityVoidInput.hostId);
        // a host that is not an obstruction kind (e.g. a roof) carves nothing.
        hostId: hostKind === null ? `element:${relation.hostId}` : `${hostKind}:${relation.hostId}`,
      })
    }

    const spaces: ContinuitySpaceInput[] = []
    for (const expressId of [...spaceIds].sort((a, b) => a - b)) {
      if (!spatialNodeIds.has(expressId)) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, expressId, false) as any
      const name: string =
        line?.LongName?.value ?? line?.Name?.value ?? `Space ${expressId}`
      spaces.push({
        id: `space:${expressId}`,
        name,
        // Null footprints stay in the list; the domain layer reports
        // shaft-named spaces without geometry in its diagnostics.
        footprint: extractElementPlanFootprint(api, webIfcModelId, expressId),
      })
    }

    result.push({
      storeyId: storey.id,
      storeyName: storey.name,
      elevation: storey.elevation,
      obstructions,
      voids,
      spaces,
    })

    await options.onStoreyProgress?.(result.length, storeys.length)
  }

  return { storeys: result, diagnostics }
}
