import { describe, expect, it } from 'vitest'
import { renderFloorDrawingPng } from './renderFloorDrawingPng'
import { buildSyntheticMiniModel } from './syntheticFloorModels'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('renderFloorDrawingPng (Node rasterizer)', () => {
  it('produces a PNG whose pixel size matches the SVG px size', () => {
    const png = renderFloorDrawingPng(buildSyntheticMiniModel(), { scale: 100, dpi: 96, showUnderlay: true, anonymize: true })
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
    // IHDR width/height are big-endian at bytes 16..24
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    // 3 m at 1:100 = 30 mm + 28 mm margins = 58 mm → 219 px at 96 dpi
    expect(width).toBe(Math.round((58 * 96) / 25.4))
    expect(height).toBeGreaterThan(width / 2)
  })
})
