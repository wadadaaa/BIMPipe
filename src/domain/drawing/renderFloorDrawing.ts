import type {
  DrawingBoundsM,
  DrawingFixture,
  DrawingPipeRun,
  DrawingPointM,
  DrawingRiser,
  DrawingSleeve,
  DrawingStructureElement,
  FloorDrawingModel,
} from './floorDrawingModel'
import { deriveSleeves } from './deriveSleeves'
import {
  DRAWING_FONT_FAMILY,
  FIXTURE_DEFAULT_SIZE_M,
  PIPE_STYLE,
  PIPE_SYSTEM_STYLE,
  SHEET_STYLE,
  SLEEVE_STYLE,
  SLOPE_ARROW_STYLE,
  STACK_STYLE,
  TEXT_STYLE,
  TITLE_STYLE,
  UNDERLAY_STYLE,
  mmToPx,
  pipeBandWidthMm,
} from './drawingStyle'

export interface RenderFloorDrawingOptions {
  /** Drawing scale 1:50 or 1:100. Pipe bands are true-scale; text is paper-constant. */
  readonly scale: 50 | 100
  /** Raster density the px coordinates are expressed at (the SVG is still vector). */
  readonly dpi: number
  /** Draw the architecture underlay (walls, columns, openings). Fixtures are always drawn. */
  readonly showUnderlay: boolean
  /** Drop the title text; only the scale remains in the title strip. */
  readonly anonymize: boolean
}

/**
 * Renders one floor of the sanitary plan as an SVG document string.
 *
 * Pure and deterministic: the same model and options always produce the same
 * bytes (sorted iteration, fixed number formatting, no clock or randomness).
 * Model coordinates are metres, IFC X right / Y up; the SVG has Y down.
 */
export function renderFloorDrawingSvg(
  model: FloorDrawingModel,
  options: RenderFloorDrawingOptions,
): string {
  const frame = createFrame(model.boundsM, options)
  const parts: string[] = []
  const placed: Aabb[] = []

  const walls = model.structure.filter((element) => element.kind === 'wall')
  const sleeves = model.sleeves.length > 0 ? model.sleeves : deriveSleeves(model.pipes, walls)

  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(frame.widthPx)}" height="${fmt(frame.heightPx)}" viewBox="0 0 ${fmt(frame.widthPx)} ${fmt(frame.heightPx)}" font-family="${DRAWING_FONT_FAMILY}" data-scale="1:${options.scale}" data-dpi="${fmt(options.dpi)}">`,
  )
  parts.push(renderDefs(frame))
  parts.push(`<rect width="${fmt(frame.widthPx)}" height="${fmt(frame.heightPx)}" fill="${SHEET_STYLE.background}"/>`)

  if (options.showUnderlay && model.structure.length > 0) {
    parts.push(`<g id="underlay">`)
    for (const element of sortStructure(model.structure)) parts.push(renderStructure(element, frame))
    parts.push(`</g>`)
  }

  parts.push(`<g id="fixtures">`)
  for (const fixture of sortById(model.fixtures)) parts.push(renderFixture(fixture, frame))
  parts.push(`</g>`)

  const pipes = sortPipes(model.pipes)
  parts.push(`<g id="pipes">`)
  for (const pipe of pipes) parts.push(renderPipeBand(pipe, frame))
  parts.push(`</g>`)

  parts.push(`<g id="sleeves">`)
  for (const sleeve of sortById(sleeves)) parts.push(renderSleeve(sleeve, frame))
  parts.push(`</g>`)

  const risers = sortById(model.risers)
  parts.push(`<g id="stacks">`)
  for (const riser of risers) {
    const symbol = renderStackSymbol(riser, frame)
    parts.push(symbol.svg)
    placed.push(symbol.box)
  }
  parts.push(`</g>`)

  // Pipe labels avoid stacks, other labels and every other run's band; they may
  // sit over the light fixture underlay like the sheet does. Stack tags are
  // bigger and additionally avoid fixtures and all bands.
  const bandBoxesByPipe = new Map(pipes.map((pipe) => [pipe.id, pipeBoxes(pipe, frame)]))
  parts.push(`<g id="pipe-labels" fill="${TEXT_STYLE.colour}">`)
  for (const pipe of pipes) {
    // Bands of other runs block the label, except the chunks touching this
    // run's ends — those are its own connections (tee, elbow, stack).
    const ends = [frame.toSvg(pipe.start), frame.toSvg(pipe.end)]
    const otherBands = pipes.flatMap((other) =>
      other.id === pipe.id
        ? []
        : (bandBoxesByPipe.get(other.id) ?? []).filter((box) => !ends.some((end) => containsPoint(box, end))),
    )
    const label = renderPipeLabel(pipe, frame, [...placed, ...otherBands])
    if (label !== null) {
      parts.push(label.svg)
      placed.push(label.box)
    }
  }
  parts.push(`</g>`)

  for (const fixture of model.fixtures) placed.push(fixtureBox(fixture, frame))
  for (const boxes of bandBoxesByPipe.values()) placed.push(...boxes)

  parts.push(`<g id="stack-tags" fill="${TEXT_STYLE.colour}">`)
  for (const riser of risers) {
    const tag = renderStackTag(riser, frame, placed)
    parts.push(tag.svg)
    placed.push(tag.box)
  }
  parts.push(`</g>`)

  parts.push(renderTitleStrip(model, options, frame))
  parts.push(`</svg>`)
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Frame

interface Frame {
  readonly scale: number
  readonly dpi: number
  readonly pxPerM: number
  readonly marginPx: number
  readonly widthPx: number
  readonly heightPx: number
  readonly bounds: DrawingBoundsM
  mm(mm: number): number
  toSvg(point: DrawingPointM): { x: number; y: number }
}

function createFrame(bounds: DrawingBoundsM, options: RenderFloorDrawingOptions): Frame {
  const mm = (value: number) => mmToPx(value, options.dpi)
  const pxPerM = mm(1000 / options.scale)
  const marginPx = mm(SHEET_STYLE.marginMm)
  const spanXM = Math.max(0, bounds.maxXM - bounds.minXM)
  const spanYM = Math.max(0, bounds.maxYM - bounds.minYM)
  const widthPx = marginPx * 2 + spanXM * pxPerM
  const heightPx = marginPx * 2 + spanYM * pxPerM + mm(SHEET_STYLE.titleStripMm)
  return {
    scale: options.scale,
    dpi: options.dpi,
    pxPerM,
    marginPx,
    widthPx,
    heightPx,
    bounds,
    mm,
    toSvg: (point) => ({
      x: marginPx + (point.xM - bounds.minXM) * pxPerM,
      y: marginPx + (bounds.maxYM - point.yM) * pxPerM,
    }),
  }
}

// ---------------------------------------------------------------------------
// Defs and underlay

function renderDefs(frame: Frame): string {
  const s = frame.mm(UNDERLAY_STYLE.wallHatchSpacingMm)
  return [
    `<defs>`,
    `<pattern id="wall-hatch" patternUnits="userSpaceOnUse" width="${fmt(s)}" height="${fmt(s)}">`,
    `<rect width="${fmt(s)}" height="${fmt(s)}" fill="${UNDERLAY_STYLE.wallFill}"/>`,
    `<path d="M0 0L${fmt(s)} ${fmt(s)}M0 ${fmt(s)}L${fmt(s)} 0" stroke="${UNDERLAY_STYLE.wallHatchStroke}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.wallHatchStrokeMm))}"/>`,
    `</pattern>`,
    `</defs>`,
  ].join('')
}

const STRUCTURE_ORDER: Record<DrawingStructureElement['kind'], number> = {
  wall: 0,
  column: 1,
  'slab-opening': 2,
  'shaft-candidate': 3,
}

function sortStructure(structure: readonly DrawingStructureElement[]): DrawingStructureElement[] {
  return structure
    .map((element, index) => ({ element, index }))
    .sort((a, b) => STRUCTURE_ORDER[a.element.kind] - STRUCTURE_ORDER[b.element.kind] || a.index - b.index)
    .map(({ element }) => element)
}

function renderStructure(element: DrawingStructureElement, frame: Frame): string {
  if (element.outline.length < 3) return ''
  const d = polygonPath(element.outline, frame)
  switch (element.kind) {
    case 'wall':
      return `<path d="${d}" fill="url(#wall-hatch)" stroke="${UNDERLAY_STYLE.wallOutline}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.wallOutlineMm))}" stroke-linejoin="miter"/>`
    case 'column':
      return `<path d="${d}" fill="${UNDERLAY_STYLE.columnFill}" stroke="${UNDERLAY_STYLE.columnOutline}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.columnOutlineMm))}"/>`
    case 'slab-opening':
      return `<path d="${d}" fill="none" stroke="${UNDERLAY_STYLE.slabOpeningStroke}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.slabOpeningStrokeMm))}" stroke-dasharray="${dash(UNDERLAY_STYLE.slabOpeningDashMm, frame)}"/>`
    case 'shaft-candidate':
      return `<path d="${d}" fill="none" stroke="${UNDERLAY_STYLE.shaftCandidateStroke}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.shaftCandidateStrokeMm))}" stroke-dasharray="${dash(UNDERLAY_STYLE.shaftCandidateDashMm, frame)}"/>`
  }
}

function polygonPath(outline: readonly DrawingPointM[], frame: Frame): string {
  return (
    outline
      .map((point, index) => {
        const { x, y } = frame.toSvg(point)
        return `${index === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`
      })
      .join('') + 'Z'
  )
}

function dash(pattern: readonly [number, number], frame: Frame): string {
  return `${fmt(frame.mm(pattern[0]))} ${fmt(frame.mm(pattern[1]))}`
}

// ---------------------------------------------------------------------------
// Fixtures

/**
 * Symbol frame: origin at the fixture centre, local +x along the fixture
 * width, local +y toward the front (away from the wall). `rotationDeg` turns
 * this frame counter-clockwise in plan; 0° means the back sits toward −Y.
 */
function renderFixture(fixture: DrawingFixture, frame: Frame): string {
  const { widthM, depthM } = fixtureSizeM(fixture)
  const w = widthM * frame.pxPerM
  const d = depthM * frame.pxPerM
  const centre = frame.toSvg(fixture.centre)
  const stroke = `fill="${UNDERLAY_STYLE.fixtureFill}" stroke="${UNDERLAY_STYLE.fixtureStroke}" stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.fixtureStrokeMm))}"`
  const body = fixtureSymbol(fixture.kind, w, d)
  return `<g transform="translate(${fmt(centre.x)} ${fmt(centre.y)}) scale(1 -1) rotate(${fmt(fixture.rotationDeg)})" ${stroke} data-fixture="${escapeXml(fixture.id)}">${body}</g>`
}

function fixtureSizeM(fixture: DrawingFixture): { widthM: number; depthM: number } {
  const fallback = FIXTURE_DEFAULT_SIZE_M[fixture.kind]
  if (fixture.footprint === undefined) return fallback
  const dx = fixture.footprint.maxXM - fixture.footprint.minXM
  const dy = fixture.footprint.maxYM - fixture.footprint.minYM
  if (!(dx > 0) || !(dy > 0)) return fallback
  const theta = (fixture.rotationDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(theta))
  const s = Math.abs(Math.sin(theta))
  return { widthM: dx * c + dy * s, depthM: dx * s + dy * c }
}

function fixtureSymbol(kind: DrawingFixture['kind'], w: number, d: number): string {
  const rect = (x: number, y: number, rw: number, rh: number, rx = 0) =>
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(rw)}" height="${fmt(rh)}"${rx > 0 ? ` rx="${fmt(rx)}"` : ''}/>`
  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"/>`
  const circle = (cx: number, cy: number, r: number) => `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"/>`
  switch (kind) {
    case 'toilet': {
      const cisternD = d * 0.26
      const bowlCy = -d / 2 + cisternD + (d - cisternD) / 2
      return (
        rect(-w / 2, -d / 2, w, cisternD) +
        ellipse(0, bowlCy, w * 0.42, (d - cisternD) / 2) +
        ellipse(0, bowlCy + d * 0.03, w * 0.3, (d - cisternD) * 0.34)
      )
    }
    case 'bidet': {
      return ellipse(0, 0, w / 2, d / 2) + ellipse(0, d * 0.05, w * 0.34, d * 0.34)
    }
    case 'basin':
      return (
        rect(-w / 2, -d / 2, w, d, w * 0.15) +
        rect(-w * 0.4, -d * 0.36, w * 0.8, d * 0.7, w * 0.14) +
        circle(0, -d * 0.08, w * 0.04)
      )
    case 'sink':
      return (
        rect(-w / 2, -d / 2, w, d, w * 0.03) +
        rect(-w * 0.42, -d * 0.38, w * 0.84, d * 0.72, w * 0.05) +
        circle(w * 0.18, -d * 0.02, w * 0.035)
      )
    case 'urinal':
      return rect(-w / 2, -d / 2, w, d, w * 0.3) + ellipse(0, d * 0.05, w * 0.3, d * 0.3)
    case 'shower':
      return rect(-w / 2, -d / 2, w, d) + circle(0, 0, w * 0.06)
    case 'bath':
      return (
        rect(-w / 2, -d / 2, w, d, d * 0.12) +
        rect(-w * 0.44, -d * 0.36, w * 0.88, d * 0.72, d * 0.2) +
        circle(-w * 0.36, 0, d * 0.05)
      )
    case 'floor-drain':
      return (
        circle(0, 0, w / 2) +
        `<path d="M${fmt(-w / 2)} 0H${fmt(w / 2)}M0 ${fmt(-d / 2)}V${fmt(d / 2)}" fill="none"/>`
      )
    case 'other':
      return rect(-w / 2, -d / 2, w, d)
  }
}

// ---------------------------------------------------------------------------
// Pipes

function sortPipes(pipes: readonly DrawingPipeRun[]): DrawingPipeRun[] {
  // Branches first so collectors sit on top; stable by id within a role.
  return [...pipes].sort(
    (a, b) => roleOrder(a) - roleOrder(b) || a.id.localeCompare(b.id),
  )
}

function roleOrder(pipe: DrawingPipeRun): number {
  return pipe.role === 'collector' ? 1 : 0
}

function pipeDiameterMm(pipe: DrawingPipeRun): number {
  return pipe.diameterMm ?? PIPE_STYLE.fallbackDiameterMm[pipe.role]
}

function pipeBandPx(pipe: DrawingPipeRun, frame: Frame): { band: number; edge: number } {
  const band = frame.mm(pipeBandWidthMm(pipeDiameterMm(pipe), frame.scale))
  const edge = frame.mm(pipe.role === 'collector' ? PIPE_STYLE.collectorEdgeMm : PIPE_STYLE.edgeMm)
  return { band, edge }
}

function renderPipeBand(pipe: DrawingPipeRun, frame: Frame): string {
  const a = frame.toSvg(pipe.start)
  const b = frame.toSvg(pipe.end)
  if (!(Math.hypot(b.x - a.x, b.y - a.y) > 0)) return ''
  const style = PIPE_SYSTEM_STYLE[pipe.system]
  const { band, edge } = pipeBandPx(pipe, frame)
  const line = `x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"`
  return [
    `<g data-pipe="${escapeXml(pipe.id)}" data-role="${pipe.role}" stroke-linecap="butt">`,
    `<line ${line} stroke="${style.edge}" stroke-width="${fmt(band + 2 * edge)}"/>`,
    `<line ${line} stroke="${style.fill}" stroke-width="${fmt(band)}"/>`,
    renderFittingCuts(a, b, band, frame),
    `</g>`,
  ].join('')
}

/** Short lighter cut lines across the band near each end, as a fitting hint. */
function renderFittingCuts(
  a: { x: number; y: number },
  b: { x: number; y: number },
  band: number,
  frame: Frame,
): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const inset = frame.mm(1.2)
  if (length < inset * 3) return ''
  const ux = (b.x - a.x) / length
  const uy = (b.y - a.y) / length
  const nx = -uy
  const ny = ux
  const half = band / 2
  const cut = (px: number, py: number) =>
    `<line x1="${fmt(px + nx * half)}" y1="${fmt(py + ny * half)}" x2="${fmt(px - nx * half)}" y2="${fmt(py - ny * half)}"/>`
  return `<g stroke="${PIPE_STYLE.fittingCutStroke}" stroke-width="${fmt(frame.mm(PIPE_STYLE.fittingCutMm))}">${cut(a.x + ux * inset, a.y + uy * inset)}${cut(b.x - ux * inset, b.y - uy * inset)}</g>`
}

// ---------------------------------------------------------------------------
// Pipe labels

interface Aabb {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

interface Placed {
  readonly svg: string
  readonly box: Aabb
}

const LABEL_T_CANDIDATES = [0.5, 0.35, 0.65, 0.22, 0.78] as const
/** Runs shorter than this in plan carry no label; a stub cannot host three text lines. */
const MIN_LABELLED_RUN_M = 0.25
/** A branch label may be up to this many times longer than its run. */
const MAX_LABEL_OVERHANG = 1.6

function renderPipeLabel(pipe: DrawingPipeRun, frame: Frame, placed: readonly Aabb[]): Placed | null {
  const a = frame.toSvg(pipe.start)
  const b = frame.toSvg(pipe.end)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthPx = Math.hypot(dx, dy)
  if (!(lengthPx > 0) || Math.hypot(pipe.end.xM - pipe.start.xM, pipe.end.yM - pipe.start.yM) < MIN_LABELLED_RUN_M) {
    return null
  }

  // Reading direction: rotate so text reads left→right / bottom→top.
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  let flowSign = 1
  if (angleDeg > 90 || angleDeg <= -90) {
    angleDeg += angleDeg > 90 ? -180 : 180
    flowSign = -1
  }
  const angle = (angleDeg * Math.PI) / 180
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  // "Above" the run on the sheet in reading orientation.
  const nx = uy
  const ny = -ux

  const { band, edge } = pipeBandPx(pipe, frame)
  const halfBand = band / 2 + edge
  const gap = frame.mm(TEXT_STYLE.labelGapMm)
  const diameterPx = frame.mm(TEXT_STYLE.diameterMm)
  const codePx = frame.mm(TEXT_STYLE.systemCodeMm)
  const slopePx = frame.mm(TEXT_STYLE.slopeMm)
  const cap = (fontPx: number) => fontPx * TEXT_STYLE.capHeightEm

  const style = PIPE_SYSTEM_STYLE[pipe.system]
  const diameterText = pipe.diameterMm === null ? null : formatDiameter(pipe.diameterMm)
  const slopeText = pipe.slopePercent === null ? null : formatSlopePercent(pipe.slopePercent)
  const arrowGap = frame.mm(SLOPE_ARROW_STYLE.gapMm) + frame.mm(SLOPE_ARROW_STYLE.strokeMm)

  // Local layout: x along the run, y perpendicular, negative y = above the
  // run on the sheet. Each block is laid out from the band edge outward on a
  // given side; the default puts the slope above and the diameter below, the
  // flipped variant swaps them when the default collides.
  const slopeBlock = (side: -1 | 1) => {
    // An empty side still keeps the collision box clear of the band itself.
    if (slopeText === null) return { extent: halfBand + gap, svg: '' }
    const shaftY = side * (halfBand + gap)
    const baselineY = side < 0 ? shaftY - arrowGap : shaftY + arrowGap + cap(slopePx)
    const extent = side < 0 ? -baselineY + cap(slopePx) : baselineY
    const shaftHalf = frame.mm(SLOPE_ARROW_STYLE.lengthMm) / 2
    const headL = frame.mm(SLOPE_ARROW_STYLE.headLengthMm)
    const headW = frame.mm(SLOPE_ARROW_STYLE.headWidthMm) / 2
    const tip = flowSign * shaftHalf
    const svg =
      textAt(slopeText, slopePx, baselineY) +
      `<g stroke="${SLOPE_ARROW_STYLE.stroke}" stroke-width="${fmt(frame.mm(SLOPE_ARROW_STYLE.strokeMm))}" fill="${SLOPE_ARROW_STYLE.stroke}">` +
      `<line x1="${fmt(-tip)}" y1="${fmt(shaftY)}" x2="${fmt(tip - flowSign * headL)}" y2="${fmt(shaftY)}"/>` +
      `<path d="M${fmt(tip)} ${fmt(shaftY)}L${fmt(tip - flowSign * headL)} ${fmt(shaftY - headW)}L${fmt(tip - flowSign * headL)} ${fmt(shaftY + headW)}Z"/>` +
      `</g>`
    return { extent, svg }
  }
  const diameterBlock = (side: -1 | 1) => {
    const first = side < 0 ? -(halfBand + gap) : halfBand + gap + cap(diameterText === null ? codePx : diameterPx)
    if (diameterText === null) {
      return { extent: side < 0 ? -first + cap(codePx) : first, svg: textAt(style.code, codePx, first) }
    }
    const second = side < 0 ? first - cap(diameterPx) - gap * 0.6 : first + gap * 0.6 + cap(codePx)
    return {
      extent: side < 0 ? -second + cap(codePx) : second,
      svg: textAt(diameterText, diameterPx, first) + textAt(style.code, codePx, second),
    }
  }

  const widths = [
    textWidthPx(style.code, codePx),
    diameterText === null ? 0 : textWidthPx(diameterText, diameterPx),
    slopeText === null ? 0 : Math.max(textWidthPx(slopeText, slopePx), frame.mm(SLOPE_ARROW_STYLE.lengthMm)),
  ]
  const halfWidth = Math.max(...widths) / 2 + frame.mm(0.5)
  // A label much longer than its run cannot read as belonging to it; a modest
  // overhang is fine (the sheet does it on short fixture connections). Only
  // collectors are labelled regardless — they are the run a reader looks for.
  if (pipe.role !== 'collector' && halfWidth * 2 > lengthPx * MAX_LABEL_OVERHANG) return null

  const layouts = [false, true].map((flip) => {
    const upper = flip ? diameterBlock(-1) : slopeBlock(-1)
    const lower = flip ? slopeBlock(1) : diameterBlock(1)
    return { flip, above: upper.extent, below: lower.extent, svg: upper.svg + lower.svg }
  })

  const candidateAt = (layout: (typeof layouts)[number], t: number) => {
    const cx = a.x + dx * t
    const cy = a.y + dy * t
    return { cx, cy, svg: layout.svg, box: rotatedBox(cx, cy, ux, uy, nx, ny, halfWidth, layout.above, layout.below) }
  }
  // Default: slope above / diameter below at the midpoint. Otherwise the first
  // collision-free spot: shift along the run first, swap sides second.
  let chosen: ReturnType<typeof candidateAt> | null = null
  search: for (const layout of layouts) {
    for (const t of LABEL_T_CANDIDATES) {
      const candidate = candidateAt(layout, t)
      if (!placed.some((other) => overlaps(candidate.box, other))) {
        chosen = candidate
        break search
      }
    }
  }
  if (chosen === null) {
    // No free spot: a collector keeps its label at the default place, a branch
    // stays unlabelled rather than printing over another label.
    if (pipe.role !== 'collector') return null
    chosen = candidateAt(layouts[0], LABEL_T_CANDIDATES[0])
  }

  const svg = `<g transform="translate(${fmt(chosen.cx)} ${fmt(chosen.cy)}) rotate(${fmt(angleDeg)})" data-label-for="${escapeXml(pipe.id)}">${chosen.svg}</g>`
  return { svg, box: chosen.box }
}

function textAt(content: string, fontPx: number, y: number): string {
  return `<text x="0" y="${fmt(y)}" font-size="${fmt(fontPx)}" text-anchor="middle">${escapeXml(content)}</text>`
}

/** AABB of a rectangle centred at (cx,cy) spanning ±halfWidth along u and [-above, +below] along the down-normal. */
function rotatedBox(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  nx: number,
  ny: number,
  halfWidth: number,
  above: number,
  below: number,
): Aabb {
  const corners = [
    [-halfWidth, -above],
    [halfWidth, -above],
    [-halfWidth, below],
    [halfWidth, below],
  ].map(([along, perp]) => ({
    // perp < 0 is "above" → move along +n (n points up on the sheet).
    x: cx + ux * along - nx * perp,
    y: cy + uy * along - ny * perp,
  }))
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}

/** Axis-aligned box of the rotated fixture symbol. */
function fixtureBox(fixture: DrawingFixture, frame: Frame): Aabb {
  const { widthM, depthM } = fixtureSizeM(fixture)
  const theta = (fixture.rotationDeg * Math.PI) / 180
  const halfW = ((Math.abs(Math.cos(theta)) * widthM + Math.abs(Math.sin(theta)) * depthM) * frame.pxPerM) / 2
  const halfD = ((Math.abs(Math.sin(theta)) * widthM + Math.abs(Math.cos(theta)) * depthM) * frame.pxPerM) / 2
  const c = frame.toSvg(fixture.centre)
  return { minX: c.x - halfW, minY: c.y - halfD, maxX: c.x + halfW, maxY: c.y + halfD }
}

/** A run as a chain of small boxes so diagonal runs do not block their whole bounding box. */
function pipeBoxes(pipe: DrawingPipeRun, frame: Frame): Aabb[] {
  const a = frame.toSvg(pipe.start)
  const b = frame.toSvg(pipe.end)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > 0)) return []
  const { band, edge } = pipeBandPx(pipe, frame)
  const half = band / 2 + edge
  const chunk = Math.max(1, Math.ceil(length / frame.mm(8)))
  const boxes: Aabb[] = []
  for (let i = 0; i < chunk; i++) {
    const x0 = a.x + ((b.x - a.x) * i) / chunk
    const y0 = a.y + ((b.y - a.y) * i) / chunk
    const x1 = a.x + ((b.x - a.x) * (i + 1)) / chunk
    const y1 = a.y + ((b.y - a.y) * (i + 1)) / chunk
    boxes.push({
      minX: Math.min(x0, x1) - half,
      minY: Math.min(y0, y1) - half,
      maxX: Math.max(x0, x1) + half,
      maxY: Math.max(y0, y1) + half,
    })
  }
  return boxes
}

function insideSheet(box: Aabb, frame: Frame): boolean {
  const bottom = frame.heightPx - frame.mm(SHEET_STYLE.titleStripMm) - frame.marginPx / 2
  return box.minX >= 0 && box.minY >= 0 && box.maxX <= frame.widthPx && box.maxY <= bottom
}

function containsPoint(box: Aabb, point: { x: number; y: number }): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY
}

function overlaps(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function textWidthPx(content: string, fontPx: number): number {
  return content.length * fontPx * TEXT_STYLE.glyphAdvanceEm
}

/** "ø110 mm" — lowercase ø, one space before the unit. */
export function formatDiameter(diameterMm: number): string {
  return `ø${fmt(diameterMm)} mm`
}

/** "2.0%" — percent with one decimal, no space. */
export function formatSlopePercent(slopePercent: number): string {
  return `${slopePercent.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Sleeves

function renderSleeve(sleeve: DrawingSleeve, frame: Frame): string {
  const centre = frame.toSvg(sleeve.at)
  const bandMm = pipeBandWidthMm(sleeve.pipeDiameterMm ?? PIPE_STYLE.fallbackDiameterMm.branch, frame.scale)
  const width = frame.mm(Math.max(SLEEVE_STYLE.minWidthMm, bandMm * SLEEVE_STYLE.widthFactor))
  const length = (sleeve.lengthM ?? SLEEVE_STYLE.fallbackLengthM) * frame.pxPerM
  const stroke = frame.mm(SLEEVE_STYLE.outlineMm)
  // Plan CCW angle → SVG clockwise rotation (y down).
  const rotation = -sleeve.directionDeg
  const hl = length / 2
  const hw = width / 2
  return (
    `<g transform="translate(${fmt(centre.x)} ${fmt(centre.y)}) rotate(${fmt(rotation)})" data-sleeve="${escapeXml(sleeve.id)}">` +
    `<rect x="${fmt(-hl)}" y="${fmt(-hw)}" width="${fmt(length)}" height="${fmt(width)}" fill="${SLEEVE_STYLE.fill}" stroke="${SLEEVE_STYLE.outline}" stroke-width="${fmt(stroke)}"/>` +
    `<path d="M${fmt(-hl)} ${fmt(-hw)}L${fmt(hl)} ${fmt(hw)}M${fmt(-hl)} ${fmt(hw)}L${fmt(hl)} ${fmt(-hw)}" stroke="${SLEEVE_STYLE.outline}" stroke-width="${fmt(stroke)}"/>` +
    `</g>`
  )
}

// ---------------------------------------------------------------------------
// Stacks

function stackRadiusPx(riser: DrawingRiser, frame: Frame): number {
  const bandMm = pipeBandWidthMm(riser.diameterMm ?? PIPE_STYLE.fallbackDiameterMm.collector, frame.scale)
  return frame.mm(Math.max(STACK_STYLE.minDiameterMm, bandMm * STACK_STYLE.bandFactor)) / 2
}

function renderStackSymbol(riser: DrawingRiser, frame: Frame): Placed {
  const c = frame.toSvg(riser.centre)
  const r = stackRadiusPx(riser, frame)
  const cross = r * STACK_STYLE.crosshairFactor
  const style = PIPE_SYSTEM_STYLE[riser.system]
  const svg =
    `<g data-stack="${escapeXml(riser.id)}">` +
    `<path d="M${fmt(c.x - cross)} ${fmt(c.y)}H${fmt(c.x + cross)}M${fmt(c.x)} ${fmt(c.y - cross)}V${fmt(c.y + cross)}" stroke="${STACK_STYLE.outline}" stroke-width="${fmt(frame.mm(STACK_STYLE.crosshairMm))}"/>` +
    `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}" fill="${style.fill}" stroke="${STACK_STYLE.outline}" stroke-width="${fmt(frame.mm(STACK_STYLE.outlineMm))}"/>` +
    `</g>`
  return { svg, box: { minX: c.x - cross, minY: c.y - cross, maxX: c.x + cross, maxY: c.y + cross } }
}

const TAG_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
]
/** Leader length multipliers tried in order when the near positions are taken. */
const TAG_DISTANCE_FACTORS = [1, 2, 3.2] as const

function renderStackTag(riser: DrawingRiser, frame: Frame, placed: readonly Aabb[]): Placed {
  const c = frame.toSvg(riser.centre)
  const r = stackRadiusPx(riser, frame)
  const fontPx = frame.mm(TEXT_STYLE.tagMm)
  const cap = fontPx * TEXT_STYLE.capHeightEm
  const content = riser.diameterMm === null ? `(${riser.tag})` : `${formatDiameter(riser.diameterMm)} (${riser.tag})`
  const padX = frame.mm(STACK_STYLE.pillPaddingXMm)
  const padY = frame.mm(STACK_STYLE.pillPaddingYMm)
  const pillW = textWidthPx(content, fontPx) + 2 * padX
  const pillH = cap * 1.35 + 2 * padY
  const note = riser.spansStoreyLabels !== undefined && riser.spansStoreyLabels.length > 0 ? formatSpanNote(riser.spansStoreyLabels) : null
  const notePx = frame.mm(TEXT_STYLE.noteMm)
  const noteH = note === null ? 0 : notePx * 1.3

  // Up-right by default, then the other quadrants; a pill must stay on the
  // sheet and prefers not to overlap anything already placed.
  const candidates = TAG_DISTANCE_FACTORS.flatMap((factor) =>
    TAG_OFFSETS.map(([sx, sy]) => {
      const px = c.x + sx * frame.mm(STACK_STYLE.pillOffsetXMm) * factor + (sx * pillW) / 2
      const py = c.y + sy * frame.mm(STACK_STYLE.pillOffsetYMm) * factor
      const box: Aabb = { minX: px - pillW / 2, minY: py - pillH / 2, maxX: px + pillW / 2, maxY: py + pillH / 2 + noteH }
      return { px, py, box, inside: insideSheet(box, frame) }
    }),
  )
  const chosen =
    candidates.find((candidate) => candidate.inside && !placed.some((other) => overlaps(candidate.box, other))) ??
    candidates.find((candidate) => candidate.inside) ??
    candidates[0]
  const centreX = chosen.px
  const centreY = chosen.py
  const pill = chosen.box

  // Leader: from the pill boundary toward the stack, arrowhead on the circle.
  const leader = leaderPath(centreX, centreY, pillW / 2, pillH / 2, c.x, c.y, r, frame)

  const svg =
    `<g data-tag-for="${escapeXml(riser.id)}">` +
    leader +
    `<rect x="${fmt(centreX - pillW / 2)}" y="${fmt(centreY - pillH / 2)}" width="${fmt(pillW)}" height="${fmt(pillH)}" rx="${fmt(pillH / 2)}" fill="${STACK_STYLE.pillFill}" stroke="${STACK_STYLE.pillStroke}" stroke-width="${fmt(frame.mm(STACK_STYLE.pillStrokeMm))}"/>` +
    `<text x="${fmt(centreX)}" y="${fmt(centreY + cap / 2)}" font-size="${fmt(fontPx)}" text-anchor="middle" direction="ltr" unicode-bidi="bidi-override">${escapeXml(content)}</text>` +
    (note === null
      ? ''
      : `<text x="${fmt(centreX)}" y="${fmt(centreY + pillH / 2 + notePx)}" font-size="${fmt(notePx)}" text-anchor="middle" direction="ltr" unicode-bidi="bidi-override">${escapeXml(note)}</text>`) +
    `</g>`
  return { svg, box: pill }
}

function formatSpanNote(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0]
  return `${labels[0]} – ${labels[labels.length - 1]}`
}

function leaderPath(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  cx: number,
  cy: number,
  r: number,
  frame: Frame,
): string {
  const dx = cx - px
  const dy = cy - py
  const dist = Math.hypot(dx, dy)
  if (!(dist > 0)) return ''
  const ux = dx / dist
  const uy = dy / dist
  // Exit the pill rectangle along the line to the stack centre.
  const tx = Math.abs(ux) > 1e-9 ? halfW / Math.abs(ux) : Number.POSITIVE_INFINITY
  const ty = Math.abs(uy) > 1e-9 ? halfH / Math.abs(uy) : Number.POSITIVE_INFINITY
  const exit = Math.min(tx, ty)
  const startX = px + ux * exit
  const startY = py + uy * exit
  const endX = cx - ux * r
  const endY = cy - uy * r
  if (dist - exit - r <= 0) return ''
  const headL = frame.mm(STACK_STYLE.leaderHeadLengthMm)
  const headW = frame.mm(STACK_STYLE.leaderHeadWidthMm) / 2
  const baseX = endX - ux * headL
  const baseY = endY - uy * headL
  const nx = -uy
  const ny = ux
  return (
    `<line x1="${fmt(startX)}" y1="${fmt(startY)}" x2="${fmt(baseX)}" y2="${fmt(baseY)}" stroke="${STACK_STYLE.leaderStroke}" stroke-width="${fmt(frame.mm(STACK_STYLE.leaderMm))}"/>` +
    `<path d="M${fmt(endX)} ${fmt(endY)}L${fmt(baseX + nx * headW)} ${fmt(baseY + ny * headW)}L${fmt(baseX - nx * headW)} ${fmt(baseY - ny * headW)}Z" fill="${STACK_STYLE.leaderStroke}"/>`
  )
}

// ---------------------------------------------------------------------------
// Title strip

function renderTitleStrip(model: FloorDrawingModel, options: RenderFloorDrawingOptions, frame: Frame): string {
  const stripTop = frame.heightPx - frame.mm(SHEET_STYLE.titleStripMm) - frame.marginPx / 2
  const bubbleR = frame.mm(TITLE_STYLE.bubbleDiameterMm) / 2
  const bubbleX = frame.marginPx + bubbleR
  const bubbleY = stripTop + bubbleR
  const titlePx = frame.mm(TEXT_STYLE.titleMm)
  const scalePx = frame.mm(TEXT_STYLE.scaleMm)
  const textX = bubbleX + bubbleR + frame.mm(3)
  const ruleY = bubbleY + frame.mm(0.8)
  const ruleEnd = Math.min(frame.widthPx - frame.marginPx, textX + frame.mm(90))
  const parts = [
    `<g id="title" fill="${TEXT_STYLE.colour}">`,
    `<circle cx="${fmt(bubbleX)}" cy="${fmt(bubbleY)}" r="${fmt(bubbleR)}" fill="none" stroke="${TITLE_STYLE.ruleStroke}" stroke-width="${fmt(frame.mm(TITLE_STYLE.bubbleStrokeMm))}"/>`,
    `<text x="${fmt(bubbleX)}" y="${fmt(bubbleY + scalePx * TEXT_STYLE.capHeightEm / 2)}" font-size="${fmt(scalePx)}" text-anchor="middle">1</text>`,
  ]
  if (!options.anonymize) {
    parts.push(
      `<text x="${fmt(textX)}" y="${fmt(ruleY - frame.mm(1.2))}" font-size="${fmt(titlePx)}" direction="ltr" unicode-bidi="bidi-override">${escapeXml(model.title)}</text>`,
    )
  }
  parts.push(
    `<line x1="${fmt(textX)}" y1="${fmt(ruleY)}" x2="${fmt(ruleEnd)}" y2="${fmt(ruleY)}" stroke="${TITLE_STYLE.ruleStroke}" stroke-width="${fmt(frame.mm(TITLE_STYLE.ruleMm))}"/>`,
    `<text x="${fmt(textX)}" y="${fmt(ruleY + frame.mm(1.2) + scalePx * TEXT_STYLE.capHeightEm)}" font-size="${fmt(scalePx)}">1 : ${options.scale}</text>`,
    `</g>`,
  )
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Utilities

function sortById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

/** Fixed two-decimal formatting with trailing zeros trimmed; folds -0 into 0. */
export function fmt(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`renderFloorDrawing: non-finite number ${value}`)
  const rounded = Math.round(value * 100) / 100 + 0
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
