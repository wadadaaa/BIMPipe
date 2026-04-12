import { describe, it, expect, vi } from 'vitest'
import { parseStoreys } from './parseStoreys'
import type { IfcAPI } from 'web-ifc'

// Minimal mock of the web-ifc IfcAPI surface used by parseStoreys
function makeApi(storeyLines: Array<{ id: number; Name: string | null; LongName: string | null; Elevation: number | null }>): IfcAPI {
  const ids = {
    size: () => storeyLines.length,
    get: (i: number) => storeyLines[i].id,
  }

  return {
    GetLineIDsWithType: vi.fn().mockReturnValue(ids),
    GetLine: vi.fn((_modelId: number, expressID: number) => {
      const line = storeyLines.find((s) => s.id === expressID)!
      return {
        Name: line.Name !== null ? { value: line.Name } : null,
        LongName: line.LongName !== null ? { value: line.LongName } : null,
        Elevation: line.Elevation !== null ? { value: line.Elevation } : null,
      }
    }),
  } as unknown as IfcAPI
}

// web-ifc is dynamically imported inside parseStoreys; mock the module
vi.mock('web-ifc', () => ({
  IFCBUILDINGSTOREY: 3124254,
}))

describe('parseStoreys', () => {
  it('returns storeys sorted by elevation ascending', async () => {
    const api = makeApi([
      { id: 10, Name: 'L3', LongName: null, Elevation: 9000 },
      { id: 11, Name: 'L1', LongName: null, Elevation: 3000 },
      { id: 12, Name: 'GF', LongName: null, Elevation: 0 },
    ])

    const result = await parseStoreys(api, 0, 'model-1')
    expect(result.map((s) => s.elevation)).toEqual([0, 3000, 9000])
  })

  it('prefers LongName over Name', async () => {
    const api = makeApi([
      { id: 1, Name: 'L1', LongName: 'Level 1', Elevation: 3000 },
    ])

    const result = await parseStoreys(api, 0, 'model-1')
    expect(result[0].name).toBe('Level 1')
  })

  it('falls back to Name when LongName is null', async () => {
    const api = makeApi([
      { id: 1, Name: 'L1', LongName: null, Elevation: 3000 },
    ])

    const result = await parseStoreys(api, 0, 'model-1')
    expect(result[0].name).toBe('L1')
  })

  it('uses a placeholder name when both Name and LongName are null', async () => {
    const api = makeApi([
      { id: 42, Name: null, LongName: null, Elevation: 0 },
    ])

    const result = await parseStoreys(api, 0, 'model-1')
    expect(result[0].name).toContain('42')
  })

  it('defaults elevation to 0 when Elevation attribute is null', async () => {
    const api = makeApi([
      { id: 1, Name: 'GF', LongName: null, Elevation: null },
    ])

    const result = await parseStoreys(api, 0, 'model-1')
    expect(result[0].elevation).toBe(0)
  })

  it('returns an empty array when no storeys exist', async () => {
    const api = makeApi([])
    const result = await parseStoreys(api, 0, 'model-1')
    expect(result).toEqual([])
  })

  it('attaches the domain modelId to each storey', async () => {
    const api = makeApi([{ id: 1, Name: 'GF', LongName: null, Elevation: 0 }])
    const result = await parseStoreys(api, 0, 'my-model-id')
    expect(result[0].modelId).toBe('my-model-id')
  })
})
