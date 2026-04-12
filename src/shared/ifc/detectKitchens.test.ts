import { describe, expect, it, vi } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { detectKitchens } from './detectKitchens'

const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617
const IFCRELREFERENCEDINSPATIALSTRUCTURE = 1464116758
const IFCRELAGGREGATES = 160246688
const IFCSPACE = 3856911033

vi.mock('web-ifc', () => ({
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 3242617,
  IFCRELREFERENCEDINSPATIALSTRUCTURE: 1464116758,
  IFCRELAGGREGATES: 160246688,
  IFCSPACE: 3856911033,
}))

interface AggregateRelLine {
  relatingObjectId: number
  relatedObjectIds: number[]
}

interface SpaceLine {
  id: number
  name: string | null
  longName?: string | null
  objectType?: string | null
  description?: string | null
  position?: { x: number; y: number; z: number }
}

function makeFlatTransform(tx = 0, ty = 0, tz = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
}

const UNIT_BOX_VERTS = new Float32Array([
  -0.5, -0.5, -0.5, 0, 0, -1,
   0.5, -0.5, -0.5, 0, 0, -1,
  -0.5,  0.5, -0.5, 0, 0, -1,
   0.5,  0.5, -0.5, 0, 0, -1,
  -0.5, -0.5,  0.5, 0, 0,  1,
   0.5, -0.5,  0.5, 0, 0,  1,
  -0.5,  0.5,  0.5, 0, 0,  1,
   0.5,  0.5,  0.5, 0, 0,  1,
])

function makeApi(aggregateRels: AggregateRelLine[], spaces: SpaceLine[]): IfcAPI {
  const aggregateRelIdSet = new Set<number>()
  const aggregateRelIds = {
    size: () => aggregateRels.length,
    get: (i: number) => {
      const id = 2000 + i
      aggregateRelIdSet.add(id)
      return id
    },
  }
  const emptyIds = { size: () => 0, get: () => 0 }
  const spaceIds = {
    size: () => spaces.length,
    get: (i: number) => spaces[i].id,
  }

  return {
    GetLineIDsWithType: vi.fn((_modelId: number, type: number) => {
      if (type === IFCRELCONTAINEDINSPATIALSTRUCTURE) return emptyIds
      if (type === IFCRELREFERENCEDINSPATIALSTRUCTURE) return emptyIds
      if (type === IFCRELAGGREGATES) return aggregateRelIds
      if (type === IFCSPACE) return spaceIds
      return emptyIds
    }),
    GetLine: vi.fn((_modelId: number, expressID: number) => {
      if (aggregateRelIdSet.has(expressID)) {
        const rel = aggregateRels[expressID - 2000]
        return {
          RelatingObject: { value: rel.relatingObjectId },
          RelatedObjects: rel.relatedObjectIds.map((id) => ({ value: id })),
        }
      }

      const space = spaces.find((item) => item.id === expressID)!
      return {
        Name: space.name !== null ? { value: space.name } : null,
        LongName: space.longName ? { value: space.longName } : null,
        ObjectType: space.objectType ? { value: space.objectType } : null,
        Description: space.description ? { value: space.description } : null,
      }
    }),
    GetFlatMesh: vi.fn((_modelId: number, expressId: number) => ({
      geometries: {
        size: () => 1,
        get: () => {
          const space = spaces.find((item) => item.id === expressId)
          const position = space?.position ?? { x: expressId * 10, y: expressId * 5, z: 0 }
          return {
            geometryExpressID: expressId * 100,
            flatTransformation: makeFlatTransform(position.x, position.y, position.z),
          }
        },
      },
    })),
    GetGeometry: vi.fn(() => ({
      GetVertexData: () => 0,
      GetVertexDataSize: () => UNIT_BOX_VERTS.length,
      delete: vi.fn(),
    })),
    GetVertexArray: vi.fn(() => UNIT_BOX_VERTS),
  } as unknown as IfcAPI
}

describe('detectKitchens', () => {
  it('finds kitchen spaces aggregated under the selected storey', async () => {
    const api = makeApi(
      [{ relatingObjectId: 5, relatedObjectIds: [7001, 7002] }],
      [
        { id: 7001, name: 'Kitchen A', position: { x: 12, y: 34, z: 0 } },
        { id: 7002, name: 'Bedroom', position: { x: 56, y: 78, z: 0 } },
      ],
    )

    const result = await detectKitchens(api, 0, 5)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      expressId: 7001,
      name: 'Kitchen A',
      storeyId: 5,
      position: { x: 12, y: 34, z: 0 },
      planBounds: {
        minX: 11.5,
        maxX: 12.5,
        minZ: -0.5,
        maxZ: 0.5,
      },
    })
    expect(result[0].planCorners).toHaveLength(4)
  })

  it('matches kitchen spaces by object type and Hebrew labels', async () => {
    const api = makeApi(
      [{ relatingObjectId: 5, relatedObjectIds: [7001, 7002] }],
      [
        { id: 7001, name: 'Room 101', objectType: 'Kitchenette' },
        { id: 7002, name: 'מטבח עובדים' },
      ],
    )

    const result = await detectKitchens(api, 0, 5)

    expect(result).toHaveLength(2)
    expect(result.map((kitchen) => kitchen.expressId)).toEqual([7001, 7002])
  })

  it('ignores kitchens that belong to a different storey subtree', async () => {
    const api = makeApi(
      [
        { relatingObjectId: 5, relatedObjectIds: [7001] },
        { relatingObjectId: 6, relatedObjectIds: [7002] },
      ],
      [
        { id: 7001, name: 'Office' },
        { id: 7002, name: 'Kitchen B' },
      ],
    )

    const result = await detectKitchens(api, 0, 5)

    expect(result).toEqual([])
  })
})
