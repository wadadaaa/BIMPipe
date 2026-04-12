import type { Riser, Storey, StoreyId } from '@/domain/types'
import type { Point3D } from './planGeometry'

export function buildRiserStack(
  storeys: Storey[],
  sourceStoreyId: StoreyId,
  position: Point3D,
  stackLabel: string,
  createId: () => string = () => crypto.randomUUID(),
): Riser[] {
  const stackId = createId()

  if (storeys.length === 0) {
    return [
      {
        id: createId(),
        stackId,
        stackLabel,
        storeyId: sourceStoreyId,
        position: { ...position },
      },
    ]
  }

  const sourceStorey = storeys.find((storey) => storey.id === sourceStoreyId)
  const sourceElevation = sourceStorey?.elevation ?? position.y
  const verticalOffset = position.y - sourceElevation

  return storeys.map((storey) => ({
    id: createId(),
    stackId,
    stackLabel,
    storeyId: storey.id,
    position: {
      x: position.x,
      y: storey.elevation + verticalOffset,
      z: position.z,
    },
  }))
}

export function removeRiserStack(risers: Riser[], riserId: Riser['id']): Riser[] {
  const target = risers.find((riser) => riser.id === riserId)
  if (!target) return risers

  return risers.filter((riser) => {
    if (target.stackId) return riser.stackId !== target.stackId
    return riser.id !== riserId
  })
}
