import { describe, expect, it } from 'vitest'
import type { Riser } from '@/domain/types'
import type { Storey } from '@/domain/types'
import { buildRiserStack, removeRiserStack } from './buildRiserStacks'

const STOREYS: Storey[] = [
  { id: 1, name: '01', elevation: 306, modelId: 'model-1' },
  { id: 2, name: '02', elevation: 612, modelId: 'model-1' },
  { id: 3, name: '03', elevation: 918, modelId: 'model-1' },
]

describe('buildRiserStack', () => {
  it('preserves the source-storey vertical offset across the whole stack', () => {
    let seq = 0
    const createId = () => `id-${++seq}`

    const risers = buildRiserStack(
      STOREYS,
      2,
      { x: 188216.9, y: 655, z: -652685.9 },
      'R12',
      createId,
    )

    expect(risers).toHaveLength(3)
    expect(new Set(risers.map((riser) => riser.stackId))).toEqual(new Set(['id-1']))
    expect(new Set(risers.map((riser) => riser.stackLabel))).toEqual(new Set(['R12']))
    expect(risers.map((riser) => riser.position)).toEqual([
      { x: 188216.9, y: 349, z: -652685.9 },
      { x: 188216.9, y: 655, z: -652685.9 },
      { x: 188216.9, y: 961, z: -652685.9 },
    ])
  })

  it('falls back to a single source-storey riser when storeys are unavailable', () => {
    let seq = 0
    const createId = () => `id-${++seq}`

    expect(
      buildRiserStack([], 42, { x: 10, y: 20, z: 30 }, 'R1', createId),
    ).toEqual([
      {
        id: 'id-2',
        stackId: 'id-1',
        stackLabel: 'R1',
        storeyId: 42,
        position: { x: 10, y: 20, z: 30 },
      },
    ])
  })

  it('removes the whole stack when one floor riser is deleted', () => {
    const risers: Riser[] = [
      {
        id: 'r-01',
        stackId: 'stack-a',
        stackLabel: 'R18',
        storeyId: 1,
        position: { x: 10, y: 306, z: 20 },
      },
      {
        id: 'r-02',
        stackId: 'stack-a',
        stackLabel: 'R18',
        storeyId: 2,
        position: { x: 10, y: 612, z: 20 },
      },
      {
        id: 'r-03',
        stackId: 'stack-a',
        stackLabel: 'R18',
        storeyId: 3,
        position: { x: 10, y: 918, z: 20 },
      },
      {
        id: 'other',
        stackId: 'stack-b',
        stackLabel: 'R19',
        storeyId: 2,
        position: { x: 30, y: 612, z: 40 },
      },
    ]

    expect(removeRiserStack(risers, 'r-02')).toEqual([
      {
        id: 'other',
        stackId: 'stack-b',
        stackLabel: 'R19',
        storeyId: 2,
        position: { x: 30, y: 612, z: 40 },
      },
    ])
  })
})
