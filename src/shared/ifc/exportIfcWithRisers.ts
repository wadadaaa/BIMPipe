import type { IfcAPI } from 'web-ifc'
import type { Riser, StoreyId } from '@/domain/types'

type IfcHandle = { type: 5; value: number }

export async function exportIfcWithRisers(
  api: IfcAPI,
  sourceBytes: Uint8Array,
  primaryStoreyId: StoreyId,
  risers: Riser[],
): Promise<Uint8Array> {
  if (risers.length === 0) {
    throw new Error('Add or suggest risers before downloading the IFC.')
  }

  const {
    IFCAXIS2PLACEMENT3D,
    IFCBUILDINGELEMENTPROXY,
    IFCCARTESIANPOINT,
    IFCIDENTIFIER,
    IFCLABEL,
    IFCLOCALPLACEMENT,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
  } = await import('web-ifc')

  const modelId = api.OpenModel(sourceBytes.slice())

  try {
    // Resolve owner history from the primary storey (used for all new entities).
    const primaryStorey = api.GetLine(modelId, primaryStoreyId, false) as {
      OwnerHistory?: IfcHandle | null
    } | null

    if (!primaryStorey) {
      throw new Error(`Storey #${primaryStoreyId} is missing from the IFC model.`)
    }

    const ownerHistory = toHandle(primaryStorey.OwnerHistory)
    const schema = api.GetModelSchema(modelId)

    // Group risers by storeyId so each floor gets its own containment entry.
    const risersByStorey = new Map<StoreyId, Riser[]>()
    for (const riser of risers) {
      const group = risersByStorey.get(riser.storeyId) ?? []
      group.push(riser)
      risersByStorey.set(riser.storeyId, group)
    }

    for (const [storeyId, storeyRisers] of risersByStorey) {
      const riserElements = storeyRisers.map((riser, index) =>
        createRiserElement(
          api,
          modelId,
          schema,
          ownerHistory,
          riser.stackLabel.trim() || `R${index + 1}`,
          riser.position,
        ),
      )

      const containment = findStoreyContainmentRelation(
        api,
        modelId,
        IFCRELCONTAINEDINSPATIALSTRUCTURE,
        storeyId,
      )

      if (containment) {
        containment.RelatedElements = [
          ...(Array.isArray(containment.RelatedElements) ? containment.RelatedElements : []),
          ...riserElements,
        ]
        api.WriteLine(modelId, containment)
      } else {
        const relation = api.CreateIfcEntity(
          modelId,
          IFCRELCONTAINEDINSPATIALSTRUCTURE,
          api.CreateIFCGloballyUniqueId(modelId),
          ownerHistory,
          api.CreateIfcType(modelId, IFCLABEL, 'BIMPipe riser set'),
          null,
          riserElements,
          handleRef(storeyId),
        )
        api.WriteLine(modelId, relation)
      }
    }

    return api.SaveModel(modelId)
  } finally {
    api.CloseModel(modelId)
  }

  function createRiserElement(
    localApi: IfcAPI,
    modelId: number,
    schema: string,
    ownerHistory: IfcHandle | null,
    tag: string,
    position: { x: number; y: number; z: number },
  ) {
    const point = localApi.CreateIfcEntity(modelId, IFCCARTESIANPOINT, [
      position.x,
      position.y,
      position.z,
    ])
    const axisPlacement = localApi.CreateIfcEntity(modelId, IFCAXIS2PLACEMENT3D, point, null, null)
    const localPlacement = localApi.CreateIfcEntity(modelId, IFCLOCALPLACEMENT, null, axisPlacement)
    const name = localApi.CreateIfcType(modelId, IFCLABEL, `BIMPipe ${tag}`)
    const description = localApi.CreateIfcType(
      modelId,
      IFCLABEL,
      `Vertical riser marker placed by BIMPipe at (${position.x.toFixed(3)}, ${position.z.toFixed(3)})`,
    )
    const objectType = localApi.CreateIfcType(modelId, IFCLABEL, 'BIMPipeRiser')
    const identifier = localApi.CreateIfcType(modelId, IFCIDENTIFIER, tag)

    if (schema === 'IFC2X3') {
      return localApi.CreateIfcEntity(
        modelId,
        IFCBUILDINGELEMENTPROXY,
        localApi.CreateIFCGloballyUniqueId(modelId),
        ownerHistory,
        name,
        description,
        objectType,
        localPlacement,
        null,
        identifier,
        null,
      )
    }

    return localApi.CreateIfcEntity(
      modelId,
      IFCBUILDINGELEMENTPROXY,
      localApi.CreateIFCGloballyUniqueId(modelId),
      ownerHistory,
      name,
      description,
      objectType,
      localPlacement,
      null,
      identifier,
      null,
    )
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
  if ('type' in value && value.type === 5 && typeof value.value === 'number') return value
  if ('expressID' in value && typeof value.expressID === 'number') return handleRef(value.expressID)
  return null
}

function handleRef(expressId: number): IfcHandle {
  return { type: 5, value: expressId }
}
