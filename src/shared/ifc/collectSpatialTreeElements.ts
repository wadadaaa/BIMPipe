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
  const maps = await readSpatialRelationMaps(api, webIfcModelId)
  return walkSpatialTree(storeyId, maps)
}

/**
 * Batched variant for whole-model scans: reads the spatial relation tables
 * once and walks the tree for every requested storey. Behaviour per storey is
 * identical to {@link collectSpatialTreeElements}; only the relation-table
 * reads are shared, which matters on 40+ storey models.
 */
export async function collectSpatialTreeElementsForStoreys(
  api: IfcAPI,
  webIfcModelId: number,
  storeyIds: StoreyId[],
): Promise<Map<StoreyId, SpatialTreeElements>> {
  const maps = await readSpatialRelationMaps(api, webIfcModelId)
  return new Map(storeyIds.map((storeyId) => [storeyId, walkSpatialTree(storeyId, maps)]))
}

interface SpatialRelationMaps {
  containedBySpatial: Map<number, number[]>
  referencedBySpatial: Map<number, number[]>
  childrenBySpatial: Map<number, number[]>
}

async function readSpatialRelationMaps(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<SpatialRelationMaps> {
  const {
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    IFCRELREFERENCEDINSPATIALSTRUCTURE,
    IFCRELAGGREGATES,
  } = await import('web-ifc')

  return {
    containedBySpatial: readStructureRelationMap(
      api,
      webIfcModelId,
      IFCRELCONTAINEDINSPATIALSTRUCTURE,
      'RelatingStructure',
      'RelatedElements',
    ),
    referencedBySpatial: readStructureRelationMap(
      api,
      webIfcModelId,
      IFCRELREFERENCEDINSPATIALSTRUCTURE,
      'RelatingStructure',
      'RelatedElements',
    ),
    childrenBySpatial: readStructureRelationMap(
      api,
      webIfcModelId,
      IFCRELAGGREGATES,
      'RelatingObject',
      'RelatedObjects',
    ),
  }
}

function walkSpatialTree(
  rootId: number,
  { containedBySpatial, referencedBySpatial, childrenBySpatial }: SpatialRelationMaps,
): SpatialTreeElements {
  const elementIds = new Set<number>()
  const spatialNodeIds = new Set<number>()
  const queue: number[] = [rootId]

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
