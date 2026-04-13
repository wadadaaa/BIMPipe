import { describe, expect, it, vi } from 'vitest'
import { exportFullIfcWithRisers } from './exportFullIfcWithRisers'
import type { Riser } from '@/domain/types'
import type { IfcAPI } from 'web-ifc'

vi.mock('web-ifc', () => ({
  IFCAXIS2PLACEMENT3D: 1,
  IFCBUILDINGELEMENTPROXY: 2,
  IFCCARTESIANPOINT: 3,
  IFCIDENTIFIER: 4,
  IFCLABEL: 5,
  IFCLOCALPLACEMENT: 6,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 7,
}))

function makeIdVector(values: number[]) {
  return {
    size: () => values.length,
    get: (index: number) => values[index],
  }
}

describe('exportFullIfcWithRisers', () => {
  it('preserves stable stack labels while appending risers to the full source IFC', async () => {
    const containmentById = new Map([
      [201, { expressID: 201, type: 7, RelatedElements: [], RelatingStructure: { type: 5, value: 2 } }],
      [202, { expressID: 202, type: 7, RelatedElements: [], RelatingStructure: { type: 5, value: 3 } }],
    ])

    const api = {
      OpenModel: vi.fn(() => 77),
      CloseModel: vi.fn(),
      GetModelSchema: vi.fn(() => 'IFC4'),
      SaveModel: vi.fn(() => new Uint8Array([9, 8, 7])),
      CreateIFCGloballyUniqueId: vi
        .fn()
        .mockReturnValueOnce('guid-1')
        .mockReturnValueOnce('guid-2')
        .mockReturnValueOnce('guid-3')
        .mockReturnValueOnce('guid-4'),
      CreateIfcType: vi.fn((modelId: number, type: number, value: string) => ({
        modelId,
        type,
        value,
      })),
      CreateIfcEntity: vi.fn((modelId: number, type: number, ...args: unknown[]) => ({
        modelId,
        type,
        args,
      })),
      WriteLine: vi.fn(),
      GetLineIDsWithType: vi.fn((_modelId: number, type: number) => {
        if (type === 7) return makeIdVector([201, 202])
        return makeIdVector([])
      }),
      GetLine: vi.fn((_modelId: number, expressId: number) => {
        if (expressId === 2) return { OwnerHistory: { type: 5, value: 99 } }
        return containmentById.get(expressId) ?? null
      }),
    } as unknown as IfcAPI

    const risers: Riser[] = [
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R12', storeyId: 2, position: { x: 10, y: 612, z: 20 } },
      { id: 'b-2', stackId: 'stack-b', stackLabel: 'R7', storeyId: 2, position: { x: 30, y: 612, z: 40 } },
      { id: 'a-3', stackId: 'stack-a', stackLabel: 'R12', storeyId: 3, position: { x: 10, y: 918, z: 20 } },
      { id: 'b-3', stackId: 'stack-b', stackLabel: 'R7', storeyId: 3, position: { x: 30, y: 918, z: 40 } },
    ]

    const result = await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 2, risers)

    expect(result).toEqual(new Uint8Array([9, 8, 7]))

    const identifierValues = (api.CreateIfcType as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => call[1] === 4)
      .map((call) => call[2])

    expect(identifierValues).toEqual(['R12', 'R7', 'R12', 'R7'])
    expect(identifierValues).not.toContain('R1')
    expect(identifierValues).not.toContain('R2')
  })
})
