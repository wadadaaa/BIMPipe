import type { IfcAPI } from 'web-ifc'
import type { StoreyId } from '@/domain/types'

export interface SpatialTreeElements {
  elementIds: Set<number>
  spatialNodeIds: Set<number>
}

/**
 * Collects all elements reachable from a storey through the IFC spatial tree.
 *
 * Important: fixtures are often not directly contained in the storey. They may
 * sit inside IFCSPACE objects that are aggregated under the storey. Walking the
 * spatial hierarchy gives detection access to those nested elements as well.
 */
export async function collectSpatialTreeElements(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<SpatialTreeElements> {
  const {
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    IFCRELREFERENCEDINSPATIALSTRUCTURE,
    IFCRELAGGREGATES,
  } = await import('web-ifc')

  const containedBySpatial = readStructureRelationMap(
    api,
    webIfcModelId,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    'RelatingStructure',
    'RelatedElements',
  )
  const referencedBySpatial = readStructureRelationMap(
    api,
    webIfcModelId,
    IFCRELREFERENCEDINSPATIALSTRUCTURE,
    'RelatingStructure',
    'RelatedElements',
  )
  const childrenBySpatial = readStructureRelationMap(
    api,
    webIfcModelId,
    IFCRELAGGREGATES,
    'RelatingObject',
    'RelatedObjects',
  )

  const elementIds = new Set<number>()
  const spatialNodeIds = new Set<number>()
  const queue: number[] = [storeyId]

  while (queue.length > 0) {
    const spatialId = queue.shift()!
    if (spatialNodeIds.has(spatialId)) continue
    spatialNodeIds.add(spatialId)

    for (const elementId of containedBySpatial.get(spatialId) ?? []) {
      elementIds.add(elementId)
    }
    for (const elementId of referencedBySpatial.get(spatialId) ?? []) {
      elementIds.add(elementId)
    }
    for (const childSpatialId of childrenBySpatial.get(spatialId) ?? []) {
      if (!spatialNodeIds.has(childSpatialId)) queue.push(childSpatialId)
    }
  }

  return { elementIds, spatialNodeIds }
}

type RelationRefKey = 'RelatingStructure' | 'RelatingObject'
type RelatedRefsKey = 'RelatedElements' | 'RelatedObjects'

function readStructureRelationMap(
  api: IfcAPI,
  webIfcModelId: number,
  relationType: number,
  relatingKey: RelationRefKey,
  relatedKey: RelatedRefsKey,
): Map<number, number[]> {
  const relationIds = api.GetLineIDsWithType(webIfcModelId, relationType)
  const map = new Map<number, number[]>()

  for (let i = 0; i < relationIds.size(); i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relation = api.GetLine(webIfcModelId, relationIds.get(i), false) as any
    const relatingId = relation?.[relatingKey]?.value ?? relation?.[relatingKey]?.expressID
    if (typeof relatingId !== 'number') continue

    const relatedRefs = relation?.[relatedKey]
    if (!Array.isArray(relatedRefs)) continue

    const relatedIds = map.get(relatingId) ?? []
    for (const ref of relatedRefs) {
      const relatedId = ref?.value ?? ref?.expressID
      if (typeof relatedId === 'number') relatedIds.push(relatedId)
    }
    map.set(relatingId, relatedIds)
  }

  return map
}
