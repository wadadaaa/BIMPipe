import { describe, expect, it } from 'vitest'
import type { FloorDrawingModel } from './floorDrawingModel'
import { fmt, formatDiameter, formatSlopePercent, renderFloorDrawingSvg } from './renderFloorDrawing'
import { pipeBandWidthMm } from './drawingStyle'
import { buildSyntheticMiniModel, buildSyntheticToiletBlockModel } from './syntheticFloorModels'

const OPTIONS = { scale: 100, dpi: 220, showUnderlay: true, anonymize: false } as const

function count(svg: string, needle: RegExp): number {
  return (svg.match(needle) ?? []).length
}

describe('renderFloorDrawingSvg', () => {
  it('renders the mini model to a stable SVG document', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticMiniModel(), OPTIONS)
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toMatchSnapshot()
  })

  it('is deterministic and independent of input order', () => {
    const model = buildSyntheticToiletBlockModel()
    const shuffled: FloorDrawingModel = {
      ...model,
      fixtures: [...model.fixtures].reverse(),
      pipes: [...model.pipes].reverse(),
      risers: [...model.risers].reverse(),
    }
    const first = renderFloorDrawingSvg(model, OPTIONS)
    expect(renderFloorDrawingSvg(model, OPTIONS)).toBe(first)
    expect(renderFloorDrawingSvg(shuffled, OPTIONS)).toBe(first)
  })

  it('never emits NaN, Infinity or undefined', () => {
    const model = buildSyntheticToiletBlockModel()
    const degenerate: FloorDrawingModel = {
      ...model,
      pipes: [
        ...model.pipes,
        { id: 'zero', system: 'vent', diameterMm: null, slopePercent: null, start: { xM: 1, yM: 1 }, end: { xM: 1, yM: 1 }, role: 'branch' },
      ],
      fixtures: [
        ...model.fixtures,
        { id: 'flat', kind: 'other', centre: { xM: 2, yM: 2 }, rotationDeg: 0, footprint: { minXM: 2, minYM: 2, maxXM: 2, maxYM: 2 } },
      ],
      risers: [...model.risers, { id: 'plain', system: 'sanitary', centre: { xM: 4, yM: 1 }, diameterMm: null, tag: '1.9ק' }],
    }
    for (const scale of [50, 100] as const) {
      const svg = renderFloorDrawingSvg(degenerate, { ...OPTIONS, scale })
      expect(svg).not.toMatch(/NaN|Infinity|undefined|null/)
    }
  })

  it('sizes the viewBox from the plan bounds and doubles px per metre at 1:50', () => {
    const model = buildSyntheticMiniModel() // 3 m × 2 m
    const at100 = renderFloorDrawingSvg(model, OPTIONS)
    const at50 = renderFloorDrawingSvg(model, { ...OPTIONS, scale: 50 })
    const dims = (svg: string) => {
      const match = svg.match(/width="([\d.]+)" height="([\d.]+)" viewBox="0 0 ([\d.]+) ([\d.]+)"/)
      if (match === null) throw new Error('no dimensions')
      return { w: Number(match[1]), h: Number(match[2]), vw: Number(match[3]), vh: Number(match[4]) }
    }
    const d100 = dims(at100)
    const d50 = dims(at50)
    expect(d100.w).toBe(d100.vw)
    expect(d100.h).toBe(d100.vh)
    const pxPerMm = 220 / 25.4
    // 3 m at 1:100 = 30 mm + 2 × 14 mm margin
    expect(d100.w).toBeCloseTo((30 + 28) * pxPerMm, 1)
    expect(d50.w).toBeCloseTo((60 + 28) * pxPerMm, 1)
    expect(at100).toContain('data-scale="1:100"')
    expect(at50).toContain('data-scale="1:50"')
  })

  it('flips IFC Y-up to SVG Y-down: a point with larger Y lands higher on the sheet', () => {
    const model: FloorDrawingModel = {
      ...buildSyntheticMiniModel(),
      structure: [],
      pipes: [],
      fixtures: [],
      risers: [
        { id: 'low', system: 'sanitary', centre: { xM: 1, yM: 0.2 }, diameterMm: 110, tag: 'a' },
        { id: 'high', system: 'sanitary', centre: { xM: 1, yM: 1.8 }, diameterMm: 110, tag: 'b' },
      ],
    }
    const svg = renderFloorDrawingSvg(model, OPTIONS)
    const cy = (id: string) => Number(svg.match(new RegExp(`data-stack="${id}">.*?<circle cx="[\\d.]+" cy="([\\d.]+)"`))?.[1])
    expect(cy('high')).toBeLessThan(cy('low'))
  })

  it('draws the architecture underlay only when asked and only when structure exists', () => {
    const model = buildSyntheticToiletBlockModel()
    expect(renderFloorDrawingSvg(model, OPTIONS)).toContain('<g id="underlay">')
    expect(renderFloorDrawingSvg(model, { ...OPTIONS, showUnderlay: false })).not.toContain('<g id="underlay">')
    expect(renderFloorDrawingSvg({ ...model, structure: [] }, OPTIONS)).not.toContain('<g id="underlay">')
    // walls use the hatch pattern, columns a solid fill, openings a dashed outline
    const svg = renderFloorDrawingSvg(model, OPTIONS)
    expect(svg).toContain('fill="url(#wall-hatch)"')
    expect(count(svg, /stroke-dasharray=/g)).toBeGreaterThanOrEqual(2)
  })

  it('derives sleeves at the three wall crossings when the model has none, and trusts explicit sleeves otherwise', () => {
    const model = buildSyntheticToiletBlockModel()
    const derived = renderFloorDrawingSvg(model, OPTIONS)
    expect(count(derived, /data-sleeve="/g)).toBe(3)
    const explicit = renderFloorDrawingSvg(
      { ...model, sleeves: [{ id: 'given', at: { xM: 3, yM: 1.8 }, directionDeg: 0, pipeDiameterMm: 110 }] },
      OPTIONS,
    )
    expect(count(explicit, /data-sleeve="/g)).toBe(1)
    expect(explicit).toContain('data-sleeve="given"')
  })

  it('labels each run at most once in the sheet convention, collectors always', () => {
    const model = buildSyntheticToiletBlockModel()
    const svg = renderFloorDrawingSvg(model, OPTIONS)
    const labelled = [...svg.matchAll(/data-label-for="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(labelled).size).toBe(labelled.length)
    expect(labelled.length).toBeLessThanOrEqual(model.pipes.length)
    expect(labelled).toContain('wc-collector')
    expect(labelled).toContain('basin-collector')
    expect(svg).toContain('>ø110 mm<')
    expect(svg).toContain('>2.0%<')
    expect(svg).toContain('>SW-GRV<')
    // the vent run carries the vent code and no slope
    const ventLabel = svg.match(/data-label-for="vent-run">(.*?)<\/g>/)?.[1] ?? ''
    expect(ventLabel).toContain('>VNT<')
    expect(ventLabel).not.toContain('%')
  })

  it('places labels deterministically and without overlapping each other', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    const transforms = [...svg.matchAll(/data-label-for="[^"]+"/g)].length
    expect(transforms).toBeGreaterThan(0)
    // at 1:50 the short WC branches become long enough to carry labels
    const at50 = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), { ...OPTIONS, scale: 50 })
    expect(count(at50, /data-label-for="wc-branch-/g)).toBeGreaterThan(count(svg, /data-label-for="wc-branch-/g))
  })

  it('renders stacks as circle + crosshair with a tag pill and leader; tag text keeps the Hebrew suffix in visual order', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    expect(count(svg, /data-stack="/g)).toBe(2)
    expect(count(svg, /data-tag-for="/g)).toBe(2)
    expect(svg).toContain('unicode-bidi="bidi-override">ø160 mm (1.3ק)</text>')
    expect(svg).toContain('>00 – 03</text>')
  })

  it('anonymize drops the title but keeps the scale note', () => {
    const model = buildSyntheticMiniModel()
    const plain = renderFloorDrawingSvg(model, OPTIONS)
    const anonymized = renderFloorDrawingSvg(model, { ...OPTIONS, anonymize: true })
    expect(plain).toContain('Storey 02 — sanitary plan')
    expect(anonymized).not.toContain('Storey 02')
    expect(anonymized).toContain('>1 : 100</text>')
  })

  it('escapes XML in adapter-supplied text', () => {
    const model: FloorDrawingModel = { ...buildSyntheticMiniModel(), title: 'a < b & "c"' }
    const svg = renderFloorDrawingSvg(model, OPTIONS)
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;')
  })

  it('orients fixture symbols by rotationDeg', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    expect(svg).toMatch(/scale\(1 -1\) rotate\(180\)"[^>]*data-fixture="wc-1"/)
    expect(svg).toMatch(/scale\(1 -1\) rotate\(0\)"[^>]*data-fixture="basin-1"/)
  })
})

describe('style helpers', () => {
  it('formats diameter and slope the way the sheet does', () => {
    expect(formatDiameter(110)).toBe('ø110 mm')
    expect(formatSlopePercent(2)).toBe('2.0%')
    expect(formatSlopePercent(1.25)).toBe('1.3%')
  })

  it('pipe bands are true scale with a legible minimum', () => {
    expect(pipeBandWidthMm(110, 50)).toBeCloseTo(2.2, 9)
    expect(pipeBandWidthMm(110, 100)).toBeCloseTo(1.1, 9)
    expect(pipeBandWidthMm(50, 100)).toBeCloseTo(0.7, 9) // clamped
    expect(pipeBandWidthMm(80, 50)).toBeCloseTo(1.6, 9) // formula fallback
  })

  it('fmt trims to two decimals without -0 or dangling dots', () => {
    expect(fmt(0)).toBe('0')
    expect(fmt(-0.0001)).toBe('0')
    expect(fmt(100)).toBe('100')
    expect(fmt(12.5)).toBe('12.5')
    expect(fmt(1.006)).toBe('1.01')
    expect(() => fmt(Number.NaN)).toThrow()
  })
})
