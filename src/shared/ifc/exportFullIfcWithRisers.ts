import type { IfcAPI } from 'web-ifc'
import type { Riser, StoreyId } from '@/domain/types'

type IfcHandle = { type: 5; value: number }

export async function exportFullIfcWithRisers(
  api: IfcAPI,
  sourceBytes: Uint8Array,
  primaryStoreyId: StoreyId,
  risers: Riser[],
): Promise<Uint8Array> {
  if (risers.length === 0) {
    throw new Error('Add or suggest risers before downloading the full IFC.')
  }

  const {
    IFCAXIS2PLACEMENT3D,
    IFCBUILDINGELEMENTPROXY,
    IFCCARTESIANPOINT,
    IFCIDENTIFIER,
    IFCLABEL,
    IFCLENGTHMEASURE,
    IFCLOCALPLACEMENT,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    IFCTEXT,
  } = await import('web-ifc')

  const modelId = api.OpenModel(sourceBytes.slice())

  try {
    const primaryStorey = api.GetLine(modelId, primaryStoreyId, false) as {
      OwnerHistory?: IfcHandle | null
    } | null

    if (!primaryStorey) {
      throw new Error(`Storey #${primaryStoreyId} is missing from the IFC model.`)
    }

    const ownerHistory = toHandle(primaryStorey.OwnerHistory)
    const schema = api.GetModelSchema(modelId)

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
    currentModelId: number,
    _currentSchema: string,
    currentOwnerHistory: IfcHandle | null,
    tag: string,
    position: { x: number; y: number; z: number },
  ): IfcHandle {
    // Write entities bottom-up so each gets an expressID before being referenced.
    const point = localApi.CreateIfcEntity(currentModelId, IFCCARTESIANPOINT, [
      localApi.CreateIfcType(currentModelId, IFCLENGTHMEASURE, position.x),
      localApi.CreateIfcType(currentModelId, IFCLENGTHMEASURE, position.y),
      localApi.CreateIfcType(currentModelId, IFCLENGTHMEASURE, position.z),
    ])
    localApi.WriteLine(currentModelId, point)

    const axisPlacement = localApi.CreateIfcEntity(
      currentModelId, IFCAXIS2PLACEMENT3D,
      handleRef(point.expressID), null, null,
    )
    localApi.WriteLine(currentModelId, axisPlacement)

    const localPlacement = localApi.CreateIfcEntity(
      currentModelId, IFCLOCALPLACEMENT,
      null, axisPlacement,
    )
    localApi.WriteLine(currentModelId, localPlacement)

    const name = localApi.CreateIfcType(currentModelId, IFCLABEL, `BIMPipe ${tag}`)
    const description = localApi.CreateIfcType(
      currentModelId,
      IFCTEXT,
      `Vertical riser marker placed by BIMPipe at (${position.x.toFixed(3)}, ${position.z.toFixed(3)})`,
    )
    const objectType = localApi.CreateIfcType(currentModelId, IFCLABEL, 'BIMPipeRiser')
    const identifier = localApi.CreateIfcType(currentModelId, IFCIDENTIFIER, tag)

    const riserElement = localApi.CreateIfcEntity(
      currentModelId,
      IFCBUILDINGELEMENTPROXY,
      localApi.CreateIFCGloballyUniqueId(currentModelId),
      currentOwnerHistory,
      name,
      description,
      objectType,
      localPlacement,
      null,
      identifier,
      null,
    )
    localApi.WriteLine(currentModelId, riserElement)

    return handleRef(riserElement.expressID)
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
  return { type: 5, value: expressId }
}
