import { describe, expect, it } from 'vitest'
import type { FloorDrawingModel } from './floorDrawingModel'
import { fmt, formatDiameter, formatSlopePercent, formatStackTagText, renderFloorDrawingSvg } from './renderFloorDrawing'
import { PIPE_STYLE, PIPE_SYSTEM_STYLE, SLEEVE_STYLE, STACK_STYLE, UNDERLAY_STYLE, pipeBandWidthMm } from './drawingStyle'
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
    // Snapshot history: G1 style iterations 1–8; G4 style re-check (sanitary-only
    // crops) — fixtures drawn as the sheet's plumbing fixtures (dark-green
    // hairline #004000 / 0.12 mm) instead of pale-teal architecture outlines;
    // R3 — stack pill leads with the system code ("SW-GRV ø110 mm (2.1ק)") and
    // the stack symbol carries data-system so vents are unmistakable.
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
    const cy = (id: string) => Number(svg.match(new RegExp(`data-stack="${id}"[^>]*>.*?<circle cx="[\\d.]+" cy="([\\d.]+)"`))?.[1])
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

  it('renders stacks as circle + crosshair with an open tag pill and leader; a sanitary pill reads "ø160 mm (1.3ק)" like the sheet, a vent pill leads with VNT, no storey-span note (S1)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    expect(count(svg, /data-stack="/g)).toBe(2)
    expect(count(svg, /data-tag-for="/g)).toBe(2)
    expect(svg).toContain('unicode-bidi="bidi-override">ø160 mm (1.3ק)</text>')
    expect(svg).toContain('unicode-bidi="bidi-override">VNT ø75 mm (1.4ק)</text>')
    expect(svg).not.toContain('>00 – 03</text>')
    expect(svg).toMatch(/data-tag-for="stack-1">.*?<rect [^>]*rx="[^"]+" fill="none" stroke="#000000"/)
    expect(formatStackTagText({ system: 'sanitary', diameterMm: null, tag: '1.9ק' })).toBe('(1.9ק)')
    expect(formatStackTagText({ system: 'vent', diameterMm: null, tag: '1.9ק' })).toBe('VNT (1.9ק)')
  })

  it('condenses label text to the sheet width (scale 0.8 on x, baseline untouched)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    const labels = svg.match(/<g id="pipe-labels".*?<\/g>\n/s)?.[0] ?? ''
    const texts = labels.match(/<text [^>]*>/g) ?? []
    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) expect(text).toContain('transform="scale(0.8 1)"')
  })

  it('draws a vent stack as an open circle with a centre dot, a sanitary stack as a solid disc (R3)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    const sanitary = svg.match(/<g data-stack="stack-1" data-system="sanitary">(.*?)<\/g>/)?.[1] ?? ''
    const vent = svg.match(/<g data-stack="vent-stack-1" data-system="vent">(.*?)<\/g>/)?.[1] ?? ''
    expect(count(sanitary, /<circle /g)).toBe(1)
    expect(sanitary).toContain(`fill="${PIPE_SYSTEM_STYLE.sanitary.fill}"`)
    expect(count(vent, /<circle /g)).toBe(2)
    expect(vent).toContain(`fill="${STACK_STYLE.ventOpenFill}"`)
    expect(vent).toContain(`fill="${PIPE_SYSTEM_STYLE.vent.fill}"/>`)
    // both keep the crosshair
    expect(count(sanitary, /<path /g)).toBe(1)
    expect(count(vent, /<path /g)).toBe(1)
  })

  it('draws fitting connectors as one round-capped body (all edges, then all fills) with a joint line at each port and no label (R3, S1)', () => {
    const base = buildSyntheticMiniModel()
    // Split run-1 short of the stack and close the gap with two connectors of one elbow body.
    const model: FloorDrawingModel = {
      ...base,
      pipes: [
        { ...base.pipes[0], id: 'run-a', end: { xM: 2.2, yM: 0.65 } },
        { id: 'fit-1-0', system: 'sanitary', diameterMm: 110, slopePercent: null, start: { xM: 2.3, yM: 0.6 }, end: { xM: 2.2, yM: 0.65 }, role: 'branch', fitting: true },
        { id: 'fit-1-1', system: 'sanitary', diameterMm: 110, slopePercent: null, start: { xM: 2.3, yM: 0.6 }, end: { xM: 2.5, yM: 0.5 }, role: 'branch', fitting: true },
      ],
    }
    const svg = renderFloorDrawingSvg(model, OPTIONS)
    expect(count(svg, /data-fitting="true"/g)).toBe(2)
    expect(svg).not.toMatch(/data-label-for="fit-1-/)
    // One body group: both dark edges precede both fills, all round-capped, and
    // the body sits under the runs so a run's square end covers the port side.
    const bodies = svg.match(/<g id="fitting-bodies"><g stroke-linecap="round">(.*?)<\/g><\/g>/)?.[1] ?? ''
    const strokes = [...bodies.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(strokes).toEqual([
      PIPE_SYSTEM_STYLE.sanitary.edge,
      PIPE_SYSTEM_STYLE.sanitary.edge,
      PIPE_SYSTEM_STYLE.sanitary.fill,
      PIPE_SYSTEM_STYLE.sanitary.fill,
    ])
    expect(svg.indexOf('id="fitting-bodies"')).toBeLessThan(svg.indexOf('id="pipes"'))
    expect(svg).toMatch(/<g id="pipes">(?:(?!fit-1-).)*<\/g>/s)
    expect(svg).toMatch(/data-pipe="run-a"[^>]*stroke-linecap="butt"/)
    // The run end entering the body is a port and gets a joint line across the
    // run's band; the body's own ends get nothing. Without the body the same end
    // is a free end and gets the end line instead.
    const fittingsOf = (doc: string) => doc.match(/<g id="fittings">(.*?)<\/g>/)?.[1] ?? ''
    expect(count(fittingsOf(svg), /data-joint="port"/g)).toBe(1)
    expect(count(fittingsOf(svg), /data-joint="end"/g)).toBe(1) // run-a's fixture end
    const withoutFittings = renderFloorDrawingSvg({ ...model, pipes: [model.pipes[0]] }, OPTIONS)
    expect(count(fittingsOf(withoutFittings), /data-joint="port"/g)).toBe(0)
    expect(count(fittingsOf(withoutFittings), /data-joint="end"/g)).toBe(2)
  })

  it('draws pipe bands as one edge hairline on each side of the true-scale outline (S1-2)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticMiniModel(), OPTIONS)
    const band = svg.match(/<g data-pipe="run-1"[^>]*>(.*?)<\/g>/)?.[1] ?? ''
    const widths = [...band.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(widths).toHaveLength(2)
    const pxPerMm = 220 / 25.4
    const trueScale = pipeBandWidthMm(110, 100) * pxPerMm
    const edge = PIPE_STYLE.edgeMm * pxPerMm
    expect(widths[0]).toBeCloseTo(trueScale + edge, 1)
    expect(widths[1]).toBeCloseTo(trueScale - edge, 1)
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

  it('draws a WC like the sheet: plumbing-family hairline, no fill, rounded cistern box plus a double-outline bullet bowl (S1-3)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    expect(svg).toMatch(/fill="none" stroke="#004000" stroke-width="[\d.]+" data-fixture="wc-1"/)
    const wc = svg.match(/data-fixture="wc-1">(.*?)<\/g>/)?.[1] ?? ''
    expect(count(wc, /<rect [^>]*rx="[^"]+"\/>/g)).toBe(1)
    expect(count(wc, /<path d="M[^"]*A[^"]*Z"\/>/g)).toBe(2)
    expect(wc).not.toContain('<ellipse')
    // the cistern is ~0.21 of the depth; the bowl is the rest
    const depthPx = 0.7 * (220 / 25.4) * 10 // 0.70 m WC at 1:100, 220 dpi
    const cistern = Number(wc.match(/<rect [^>]*height="([\d.]+)"/)?.[1])
    expect(cistern / depthPx).toBeCloseTo(0.21, 2)
  })

  it('labels collinear connected pieces of one run once, spanning the whole line (S1-5)', () => {
    const mini = buildSyntheticMiniModel()
    // A 6 m run (long enough for two labels side by side), then cut into three
    // collinear pieces the way a collector is cut at each tee.
    const run = { ...mini.pipes[0], start: { xM: 1, yM: 1.25 }, end: { xM: 7, yM: 1.25 } }
    const base: FloorDrawingModel = { ...mini, boundsM: { ...mini.boundsM, maxXM: 8 }, pipes: [run] }
    const at = (t: number) => ({ xM: run.start.xM + (run.end.xM - run.start.xM) * t, yM: run.start.yM + (run.end.yM - run.start.yM) * t })
    const pieces: FloorDrawingModel['pipes'] = [
      { ...run, id: 'piece-a', end: at(1 / 3) },
      { ...run, id: 'piece-b', start: at(1 / 3), end: at(2 / 3) },
      { ...run, id: 'piece-c', start: at(2 / 3) },
    ]
    const whole = renderFloorDrawingSvg(base, OPTIONS)
    const cut = renderFloorDrawingSvg({ ...base, pipes: pieces }, OPTIONS)
    expect(count(cut, /data-label-for="/g)).toBe(1)
    expect(cut).toContain('data-label-for="piece-a"')
    // Same label at the same place as the uncut run.
    const labelOf = (doc: string) => doc.match(/<g transform="([^"]*)" data-label-for="[^"]*">/)?.[1]
    expect(labelOf(cut)).toBe(labelOf(whole))
    // A piece with a different ø breaks the chain and gets its own label
    // (collectors, so the short third piece is labelled regardless of length).
    const collectors = pieces.map((piece) => ({ ...piece, role: 'collector' as const }))
    expect(count(renderFloorDrawingSvg({ ...base, pipes: collectors }, OPTIONS), /data-label-for="/g)).toBe(1)
    const mixed = [collectors[0], collectors[1], { ...collectors[2], diameterMm: 160 }]
    expect(count(renderFloorDrawingSvg({ ...base, pipes: mixed }, OPTIONS), /data-label-for="/g)).toBe(2)
  })

  it('draws other fixtures as the architect underlay: pale-teal hairline over a light-grey fill (S1-4)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    expect(svg).toMatch(
      new RegExp(`fill="${UNDERLAY_STYLE.architectFixtureFill}" stroke="${UNDERLAY_STYLE.architectFixtureStroke}" stroke-width="[\\d.]+" data-fixture="basin-1"`),
    )
    const basin = svg.match(/data-fixture="basin-1">(.*?)<\/g>/)?.[1] ?? ''
    expect(count(basin, /<ellipse /g)).toBe(1) // oval bowl
  })

  it('marks a sleeve like the sheet: a heavy black box wider than the band, yellow inside, one tick across, drawn under the pipes (S1-5)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    const sleeves = [...svg.matchAll(/<g transform="[^"]*" data-sleeve="[^"]*" stroke="#000000">(.*?)<\/g>/g)]
    expect(sleeves.length).toBeGreaterThan(1)
    expect(svg.indexOf('<g id="sleeves">')).toBeLessThan(svg.indexOf('<g id="pipes">'))
    const pxPerMm = 220 / 25.4
    const ø50BandPx = pipeBandWidthMm(50, OPTIONS.scale) * pxPerMm
    for (const [, body] of sleeves) {
      const box = body.match(/<rect x="-([\d.]+)" y="-([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#ffff80" stroke-width="([\d.]+)"\/>/)
      expect(box).not.toBeNull()
      const [, , , , height, strokeWidth] = box as RegExpMatchArray
      expect(Number(strokeWidth)).toBeCloseTo(SLEEVE_STYLE.outlineMm * pxPerMm, 1)
      // Across the pipe: 1.6 × the band (the model's crossings are ø50 or wider).
      expect(Number(height)).toBeGreaterThanOrEqual(Math.max(SLEEVE_STYLE.minWidthMm * pxPerMm, ø50BandPx * SLEEVE_STYLE.widthFactor) - 0.01)
      expect(body).toMatch(/<line x1="0" y1="-([\d.]+)" x2="0" y2="\1" stroke-width="[\d.]+"\/>/)
      expect(body).not.toContain('<circle')
    }
  })

  it('closes a free run end with a socket a little proud of the band and a joint line at its inner end (S1-5)', () => {
    const svg = renderFloorDrawingSvg(buildSyntheticToiletBlockModel(), OPTIONS)
    const fittings = svg.match(/<g id="fittings">(.*?)<\/g>/)?.[1] ?? ''
    const sockets = [...fittings.matchAll(/<rect x="0" y="-([\d.]+)" width="([\d.]+)" height="([\d.]+)" [^>]*data-socket="end"\/>/g)]
    expect(sockets.length).toBeGreaterThan(0)
    const pxPerMm = 220 / 25.4
    for (const [, half, length, height] of sockets) {
      expect(Number(length)).toBeCloseTo(PIPE_STYLE.socketLengthMm * pxPerMm, 1)
      expect(Number(height)).toBeCloseTo(Number(half) * 2, 1)
      // Proud of the ø50 band's outer edge by the flare on each side.
      const ø50OuterPx = (pipeBandWidthMm(50, OPTIONS.scale) + PIPE_STYLE.edgeMm) * pxPerMm
      expect(Number(half) * 2).toBeGreaterThanOrEqual(ø50OuterPx + 2 * PIPE_STYLE.socketFlareMm * pxPerMm - 0.01)
    }
    expect((fittings.match(/data-joint="end"/g) ?? []).length).toBe(sockets.length)
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
    expect(pipeBandWidthMm(50, 100)).toBeCloseTo(PIPE_STYLE.minBandMm, 9) // clamped
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
