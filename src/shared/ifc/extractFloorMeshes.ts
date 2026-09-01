import * as THREE from 'three'
import type { IfcAPI } from 'web-ifc'
import type { StoreyId } from '@/domain/types'
import {
  createArtifactAwareBoundsAccumulator,
  IDENTITY_MODEL_FRAME,
  type ArtifactAwareBoundsAccumulator,
  type ModelFrame,
} from '@/shared/frame/modelFrame'

export interface FloorMeshes {
  group: THREE.Group
  /**
   * Local-frame bounds (source coordinates minus the model-frame origin).
   * This is what the viewer consumes for camera fitting and the plan plane.
   */
  boundingBox: THREE.Box3
  /**
   * Source-frame bounds (viewer metres, Y-up, no origin subtraction). Domain
   * logic (riser suggestion plan bounds, export debug bounds) reads this one so
   * it never mixes frames with fixture/riser positions.
   */
  sourceBoundingBox: THREE.Box3
}

/**
 * Extracts Three.js geometry for all elements directly contained in the given storey.
 *
 * web-ifc emits geometry in metres with Y up (IFC X→X, IFC Y (north)→-Z,
 * IFC Z (elevation)→Y), so a camera looking straight down the Three.js Y axis
 * sees a correct floor plan.
 *
 * Vertices are transformed to world space in double precision and the model
 * frame origin is subtracted *before* the coordinates are stored in Float32
 * buffers. For far-from-origin models (shared/survey coordinates, hundreds of
 * kilometres) this is what preserves renderer precision; with the identity
 * frame the numbers are unchanged and near-origin models behave exactly as
 * before.
 */
export async function extractFloorMeshes(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
  frame: ModelFrame = IDENTITY_MODEL_FRAME,
): Promise<FloorMeshes> {
  const { IFCSPACE, IFCSLAB } = await import('web-ifc')

  // Exclude types that produce large horizontal fills when viewed from above:
  //   IFCSPACE — logical room volumes (not physical construction)
  //   IFCSLAB  — floor/ceiling plates that cover the entire footprint
  const excludedIds = new Set<number>()
  for (const typeConst of [IFCSPACE, IFCSLAB]) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConst)
    for (let i = 0; i < ids.size(); i++) excludedIds.add(ids.get(i))
  }

  const elementIds = (await collectStoreyContainedElementIds(api, webIfcModelId, storeyId)).filter(
    (elementId) => !excludedIds.has(elementId),
  )

  return streamElementMeshes(api, webIfcModelId, elementIds, frame)
}

/**
 * Element types rendered as the 2D architecture underlay. Walls and columns
 * give the plan its outline; spaces and slabs are excluded for the same
 * viewed-from-above reasons as in {@link extractFloorMeshes}.
 */
const UNDERLAY_TYPE_NAMES = ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCOLUMN'] as const

/**
 * Extracts wall/column geometry of one storey of a LINKED model for the 2D
 * underlay. Only the elements contained in that single storey are tessellated
 * (full-model tessellation of a large architecture file is minutes-level).
 *
 * `frame` must be the HOST model's frame so the underlay shares the host's
 * local rendering origin — both buildings sit at the same shared coordinates,
 * so subtracting the same origin lines the plans up.
 */
export async function extractStoreyUnderlayMeshes(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
  frame: ModelFrame = IDENTITY_MODEL_FRAME,
): Promise<FloorMeshes> {
  const ifc = await import('web-ifc')

  const includedIds = new Set<number>()
  for (const typeName of UNDERLAY_TYPE_NAMES) {
    const ids = api.GetLineIDsWithType(webIfcModelId, ifc[typeName])
    for (let i = 0; i < ids.size(); i++) includedIds.add(ids.get(i))
  }

  const elementIds = (await collectStoreyContainedElementIds(api, webIfcModelId, storeyId)).filter(
    (elementId) => includedIds.has(elementId),
  )

  return streamElementMeshes(api, webIfcModelId, elementIds, frame)
}

/** Express IDs of elements directly contained in the storey (IfcRelContainedInSpatialStructure). */
async function collectStoreyContainedElementIds(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<number[]> {
  const { IFCRELCONTAINEDINSPATIALSTRUCTURE } = await import('web-ifc')

  const relIds = api.GetLineIDsWithType(webIfcModelId, IFCRELCONTAINEDINSPATIALSTRUCTURE)
  const elementIds: number[] = []
  for (let i = 0; i < relIds.size(); i++) {
    // flatten=false: entity references come back as { type: 5, value: expressID }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rel = api.GetLine(webIfcModelId, relIds.get(i), false) as any
    // RelatingStructure is an entity ref: { type: 5, value: expressID }
    const relStoreyId: number | undefined =
      rel.RelatingStructure?.value ?? rel.RelatingStructure?.expressID
    if (relStoreyId !== storeyId) continue
    const related = rel.RelatedElements
    if (!Array.isArray(related)) continue
    for (const el of related) {
      // Each element is also an entity ref: { type: 5, value: expressID }
      const elId: number | undefined = el?.value ?? el?.expressID
      if (typeof elId === 'number') elementIds.push(elId)
    }
  }
  return elementIds
}

/** Streams the given elements' geometry into a local-frame Three.js group. */
function streamElementMeshes(
  api: IfcAPI,
  webIfcModelId: number,
  elementIds: number[],
  frame: ModelFrame,
): FloorMeshes {
  const group = new THREE.Group()
  // Source-frame bounds accumulated in double precision across all meshes.
  // Origin-artifact strays ((0,0,0)-adjacent vertices in otherwise
  // far-from-origin geometry) are excluded from the bounds so they cannot
  // poison camera fitting or the origin centroid.
  const sourceBounds = createArtifactAwareBoundsAccumulator()

  if (elementIds.length > 0) {
    api.StreamMeshes(webIfcModelId, elementIds, (mesh) => {
      const expressID: number = mesh.expressID
      const numGeoms = mesh.geometries.size()

      for (let i = 0; i < numGeoms; i++) {
        const placed = mesh.geometries.get(i)
        const geomData = api.GetGeometry(webIfcModelId, placed.geometryExpressID)

        const rawVerts = api.GetVertexArray(
          geomData.GetVertexData(),
          geomData.GetVertexDataSize(),
        )
        const rawIndices = api.GetIndexArray(
          geomData.GetIndexData(),
          geomData.GetIndexDataSize(),
        )

        geomData.delete() // free WASM heap

        if (rawVerts.length === 0) continue

        const localized = buildLocalFrameGeometry(
          rawVerts,
          rawIndices,
          placed.flatTransformation,
          frame,
          sourceBounds,
        )
        if (localized === null) continue

        const bufGeo = new THREE.BufferGeometry()
        bufGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(localized.positions, 3),
        )
        bufGeo.setIndex(new THREE.BufferAttribute(localized.indices, 1))

        const { color } = placed
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(color.x, color.y, color.z),
          transparent: color.w < 1,
          opacity: color.w,
          side: THREE.DoubleSide,
        })

        // World transform is baked into the (origin-subtracted) positions in
        // double precision, so the mesh itself carries the identity transform.
        const threeMesh = new THREE.Mesh(bufGeo, material)
        threeMesh.userData = { expressID } // for future raycaster selection

        group.add(threeMesh)
      }
    })
  }

  const sourceBoundingBox = boundsToBox3(sourceBounds.result())
  const boundingBox = sourceBoundingBox.isEmpty()
    ? new THREE.Box3()
    : new THREE.Box3(
        new THREE.Vector3(
          sourceBoundingBox.min.x - frame.origin.x,
          sourceBoundingBox.min.y - frame.origin.y,
          sourceBoundingBox.min.z - frame.origin.z,
        ),
        new THREE.Vector3(
          sourceBoundingBox.max.x - frame.origin.x,
          sourceBoundingBox.max.y - frame.origin.y,
          sourceBoundingBox.max.z - frame.origin.z,
        ),
      )

  return { group, boundingBox, sourceBoundingBox }
}

interface LocalFrameGeometry {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * Transforms raw web-ifc vertices (stride 6: x, y, z, nx, ny, nz) through the
 * column-major placement matrix in double precision, subtracts the model-frame
 * origin, and accumulates the source-frame bounds.
 */
function buildLocalFrameGeometry(
  rawVerts: Float32Array,
  rawIndices: Uint32Array,
  t: number[] | Float32Array | Float64Array,
  frame: ModelFrame,
  sourceBounds: ArtifactAwareBoundsAccumulator,
): LocalFrameGeometry | null {
  const vertexCount = rawVerts.length / 6
  if (vertexCount === 0) return null

  const positions = new Float32Array(vertexCount * 3)

  for (let j = 0; j < vertexCount; j++) {
    const lx = rawVerts[j * 6]
    const ly = rawVerts[j * 6 + 1]
    const lz = rawVerts[j * 6 + 2]
    // Column-major 4×4 transform: col0=[0..3], col1=[4..7], col2=[8..11], col3=[12..15]
    const wx = t[0] * lx + t[4] * ly + t[8] * lz + t[12]
    const wy = t[1] * lx + t[5] * ly + t[9] * lz + t[13]
    const wz = t[2] * lx + t[6] * ly + t[10] * lz + t[14]

    sourceBounds.add(wx, wy, wz)

    positions[j * 3] = wx - frame.origin.x
    positions[j * 3 + 1] = wy - frame.origin.y
    positions[j * 3 + 2] = wz - frame.origin.z
  }

  return { positions, indices: new Uint32Array(rawIndices) }
}

function boundsToBox3(bounds: ReturnType<ArtifactAwareBoundsAccumulator['result']>): THREE.Box3 {
  if (bounds === null) return new THREE.Box3()
  return new THREE.Box3(
    new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ),
    new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
  )
}
