import * as THREE from 'three'
import type { IfcAPI } from 'web-ifc'
import type { StoreyId } from '@/domain/types'

export interface FloorMeshes {
  group: THREE.Group
  boundingBox: THREE.Box3
}

/**
 * Extracts Three.js geometry for all elements directly contained in the given storey.
 *
 * IFC is Z-up; Three.js is Y-up. The returned group has rotation.x = -π/2 applied
 * so that: IFC X→X, IFC Y (north)→Three.js -Z, IFC Z (elevation)→Three.js Y.
 * A camera looking straight down the Three.js Y axis therefore sees a correct floor plan.
 */
export async function extractFloorMeshes(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<FloorMeshes> {
  const { IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCSPACE, IFCSLAB } = await import('web-ifc')

  // --- 1. Resolve which element IDs belong to this storey ---
  const relIds = api.GetLineIDsWithType(
    webIfcModelId,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
  )

  // Exclude types that produce large horizontal fills when viewed from above:
  //   IFCSPACE — logical room volumes (not physical construction)
  //   IFCSLAB  — floor/ceiling plates that cover the entire footprint
  const excludedIds = new Set<number>()
  for (const typeConst of [IFCSPACE, IFCSLAB]) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConst)
    for (let i = 0; i < ids.size(); i++) excludedIds.add(ids.get(i))
  }

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
      if (typeof elId === 'number' && !excludedIds.has(elId)) elementIds.push(elId)
    }
  }


  // --- 2. Stream geometry for those elements ---
  const group = new THREE.Group()
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

        // rawVerts stride = 6: [x, y, z, nx, ny, nz]
        const vertexCount = rawVerts.length / 6
        const positions = new Float32Array(vertexCount * 3)
        for (let j = 0; j < vertexCount; j++) {
          positions[j * 3] = rawVerts[j * 6]
          positions[j * 3 + 1] = rawVerts[j * 6 + 1]
          positions[j * 3 + 2] = rawVerts[j * 6 + 2]
        }

        const bufGeo = new THREE.BufferGeometry()
        bufGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(positions, 3),
        )
        bufGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(rawIndices), 1))

        // Apply IFC placement matrix (column-major, matches THREE.Matrix4)
        const matrix = new THREE.Matrix4().fromArray(placed.flatTransformation)

        const { color } = placed
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(color.x, color.y, color.z),
          transparent: color.w < 1,
          opacity: color.w,
          side: THREE.DoubleSide,
        })

        const threeMesh = new THREE.Mesh(bufGeo, material)
        threeMesh.applyMatrix4(matrix)
        threeMesh.userData = { expressID } // for future raycaster selection

        group.add(threeMesh)
      }
    })
  }

  const boundingBox = new THREE.Box3().setFromObject(group)

  return { group, boundingBox }
}
