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
  const placed: Quad[] = []

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
  const fittings = deriveFittings(pipes, model.risers, frame)
  // Sleeves sit UNDER the bands: the pipe reads through the box.
  parts.push(`<g id="sleeves">`)
  for (const sleeve of sortById(sleeves)) parts.push(renderSleeve(sleeve, frame))
  parts.push(`</g>`)
  // Elbow quarter-rounds sit UNDER the bands: only the outer corner shows.
  parts.push(`<g id="elbows">${fittings.elbows}</g>`)
  // Fitting bodies first (one outline around all the pieces of a body), then
  // the runs, whose square ends cover the port side of a body.
  parts.push(`<g id="fitting-bodies">${renderFittingBodies(pipes.filter((pipe) => pipe.fitting), frame)}</g>`)
  parts.push(`<g id="pipes">`)
  for (const pipe of pipes) if (!pipe.fitting) parts.push(renderPipeBand(pipe, frame))
  parts.push(`</g>`)
  parts.push(`<g id="fittings">${fittings.jointLines}</g>`)

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
  const labelBoxes: Quad[] = []
  parts.push(`<g id="pipe-labels" fill="${TEXT_STYLE.colour}">`)
  // One label per straight line: collinear, connected pieces of one run (a
  // collector cut at every tee) are labelled once, as on the sheet.
  for (const chain of labelChains(pipes)) {
    const pipe = chainRun(chain)
    const members = new Set(chain.map((piece) => piece.id))
    // Bands of other runs block the label, except the stretch of a connected
    // run right at the junction (tee, elbow, collector): a short branch label
    // may overhang its own junction the way the sheet's fixture-connection
    // labels do, but never run across the rest of another pipe.
    const junctionReach = frame.mm(JUNCTION_LABEL_REACH_MM)
    const otherBands = pipes.flatMap((other) => {
      if (members.has(other.id)) return []
      const boxes = bandBoxesByPipe.get(other.id) ?? []
      const junctions = junctionPoints(pipe, other).map((point) => frame.toSvg(point))
      if (junctions.length === 0) return boxes
      return boxes.filter((box) => !junctions.some((j) => containsPoint(box, j) || distanceToQuadCentre(box, j) <= junctionReach))
    })
    const label = renderPipeLabel(pipe, frame, [...placed, ...otherBands], labelBoxes)
    if (label !== null) {
      parts.push(label.svg)
      placed.push(label.box)
      labelBoxes.push(label.box)
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
  // WC: plumbing family (dark hairline, white). Others: architect underlay.
  const plumbing = fixture.kind === 'toilet'
  const stroke =
    `fill="${plumbing ? UNDERLAY_STYLE.fixtureFill : UNDERLAY_STYLE.architectFixtureFill}" ` +
    `stroke="${plumbing ? UNDERLAY_STYLE.fixtureStroke : UNDERLAY_STYLE.architectFixtureStroke}" ` +
    `stroke-width="${fmt(frame.mm(UNDERLAY_STYLE.fixtureStrokeMm))}"`
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
  const rect = (x: number, y: number, rw: number, rh: number, rx = 0, extra = '') =>
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(rw)}" height="${fmt(rh)}"${rx > 0 ? ` rx="${fmt(rx)}"` : ''}${extra}/>`
  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"/>`
  const circle = (cx: number, cy: number, r: number) => `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"/>`
  switch (kind) {
    case 'toilet': {
      // The sheet's WC (plumbing fixture family, S1-3 at 220 dpi: 57 × 33 px
      // for a 0.66 × 0.38 m WC): a rounded cistern box ~0.21 of the length,
      // then a bullet-shaped bowl — full width at the round front, narrowing to
      // ~0.72 of the width where it meets the cistern — drawn as a double
      // outline (rim ≈ 2 px ≈ 0.06 of the width); the group's fill is none.
      const cisternD = d * 0.21
      const yBack = -d / 2 + cisternD
      const rim = w * 0.06
      const bowl = (halfW: number, halfBack: number, back: number, front: number) => {
        const r = halfW
        const yc = front - r
        return `<path d="M${fmt(-halfBack)} ${fmt(back)}L${fmt(-halfW)} ${fmt(yc)}A${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(halfW)} ${fmt(yc)}L${fmt(halfBack)} ${fmt(back)}Z"/>`
      }
      return (
        rect(-w * 0.45, -d / 2, w * 0.9, cisternD, cisternD * 0.15) +
        bowl(w / 2, w * 0.36, yBack, d / 2) +
        bowl(w / 2 - rim, w * 0.36 - rim, yBack + rim, d / 2 - rim)
      )
    }
    case 'bidet': {
      return ellipse(0, 0, w / 2, d / 2) + ellipse(0, d * 0.05, w * 0.34, d * 0.34)
    }
    case 'basin':
      // Sheet (architect underlay): rounded counter with an oval bowl nearly
      // as wide as the counter, and a small drain circle.
      return (
        rect(-w / 2, -d / 2, w, d, w * 0.15) +
        ellipse(0, d * 0.02, w * 0.4, d * 0.34) +
        circle(0, -d * 0.06, w * 0.04)
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

/**
 * Band metrics in px: `band` is the true-scale width (the outline the edge
 * hairlines are centred on), `edge` the hairline weight. The dark stroke is
 * `band + edge` wide and the fill `band - edge`, so each edge straddles the
 * true-scale outline the way the sheet's does.
 */
function pipeBandPx(pipe: DrawingPipeRun, frame: Frame): { band: number; edge: number; outer: number; inner: number } {
  const band = frame.mm(pipeBandWidthMm(pipeDiameterMm(pipe), frame.scale))
  const edge = frame.mm(PIPE_STYLE.edgeMm)
  return { band, edge, outer: band + edge, inner: Math.max(band * 0.4, band - edge) }
}

function pipeLineAttrs(pipe: DrawingPipeRun, frame: Frame): string | null {
  const a = frame.toSvg(pipe.start)
  const b = frame.toSvg(pipe.end)
  if (!(Math.hypot(b.x - a.x, b.y - a.y) > 0)) return null
  return `x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"`
}

function renderPipeBand(pipe: DrawingPipeRun, frame: Frame): string {
  const line = pipeLineAttrs(pipe, frame)
  if (line === null) return ''
  const style = PIPE_SYSTEM_STYLE[pipe.system]
  const { outer, inner } = pipeBandPx(pipe, frame)
  return [
    `<g data-pipe="${escapeXml(pipe.id)}" data-role="${pipe.role}" stroke-linecap="butt">`,
    `<line ${line} stroke="${style.edge}" stroke-width="${fmt(outer)}"/>`,
    `<line ${line} stroke="${style.fill}" stroke-width="${fmt(inner)}"/>`,
    `</g>`,
  ].join('')
}

/**
 * Fitting-body connectors (`fitting: true`) are drawn as ONE body: every
 * piece's dark edge first, then every piece's fill, round-capped, so the fill
 * union hides the seams between the pieces and only the outer outline shows —
 * the sheet's elbow reads as a smooth mitred body, not a string of beads
 * (S1-2: the per-piece edge+fill order left dark arcs inside each corner).
 */
function renderFittingBodies(pieces: readonly DrawingPipeRun[], frame: Frame): string {
  const edges: string[] = []
  const fills: string[] = []
  for (const pipe of pieces) {
    const line = pipeLineAttrs(pipe, frame)
    if (line === null) continue
    const style = PIPE_SYSTEM_STYLE[pipe.system]
    const { outer, inner } = pipeBandPx(pipe, frame)
    edges.push(`<line ${line} stroke="${style.edge}" stroke-width="${fmt(outer)}"/>`)
    fills.push(
      `<line ${line} stroke="${style.fill}" stroke-width="${fmt(inner)}" data-pipe="${escapeXml(pipe.id)}" data-role="${pipe.role}" data-fitting="true"/>`,
    )
  }
  if (edges.length === 0) return ''
  return `<g stroke-linecap="round">${edges.join('')}${fills.join('')}</g>`
}

/**
 * Fitting marks derived from run geometry, so adapters need not model them:
 *
 * - a free run end (fixture connection) closes the band with a dark line
 *   across it, the way the sheet's pipe outlines are closed;
 * - a run end entering a fitting body (a port) gets the same line across the
 *   run's band — the sheet marks every pipe-to-fitting joint this way;
 * - an elbow — exactly two run ends meeting where no other run passes — gets
 *   a disc of the band's own width under the bands, so the outer corner reads
 *   as a quarter-round instead of a mitre notch;
 * - tees and stack entries get nothing: the through run's edge (or the stack
 *   disc) already reads as the joint.
 *
 * Fitting-body connectors (`fitting: true`) are drawn as one round-capped body
 * (`renderFittingBodies`), so their own ends emit no mark.
 */
function deriveFittings(
  pipes: readonly DrawingPipeRun[],
  risers: readonly DrawingRiser[],
  frame: Frame,
): { elbows: string; jointLines: string } {
  const tol = PIPE_STYLE.junctionToleranceM
  type RunEnd = { pipe: DrawingPipeRun; point: DrawingPointM; angleDeg: number }
  const keyOf = (point: DrawingPointM) => `${Math.round(point.xM / tol)}|${Math.round(point.yM / tol)}`
  const endsByPoint = new Map<string, RunEnd[]>()
  for (const pipe of pipes) {
    const dx = pipe.end.xM - pipe.start.xM
    const dy = pipe.end.yM - pipe.start.yM
    if (!(Math.hypot(dx, dy) > 0)) continue
    for (const [point, sign] of [
      [pipe.start, 1],
      [pipe.end, -1],
    ] as const) {
      // Direction from the run end back along the run (SVG angle, y down).
      const angleDeg = (Math.atan2(-dy * sign, dx * sign) * 180) / Math.PI
      const key = keyOf(point)
      const list = endsByPoint.get(key) ?? []
      list.push({ pipe, point, angleDeg })
      endsByPoint.set(key, list)
    }
  }

  const elbows: string[] = []
  const jointLines: string[] = []
  const endTransform = (end: RunEnd) => {
    const c = frame.toSvg(end.point)
    return `transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(end.angleDeg)})"`
  }
  const jointLine = (end: RunEnd, kind: 'end' | 'port') => {
    const style = PIPE_SYSTEM_STYLE[end.pipe.system]
    const half = pipeBandPx(end.pipe, frame).outer / 2
    return `<line x1="0" y1="${fmt(-half)}" x2="0" y2="${fmt(half)}" ${endTransform(end)} stroke="${style.edge}" stroke-width="${fmt(frame.mm(PIPE_STYLE.jointLineMm))}" data-joint="${kind}"/>`
  }
  // Free end: a socket a little proud of the band, closed by a line at each
  // end (the outline's far side and the joint line at the inner one).
  const socket = (end: RunEnd) => {
    const style = PIPE_SYSTEM_STYLE[end.pipe.system]
    const { outer, edge } = pipeBandPx(end.pipe, frame)
    const half = outer / 2 + frame.mm(PIPE_STYLE.socketFlareMm)
    const length = frame.mm(PIPE_STYLE.socketLengthMm)
    return (
      `<rect x="0" y="${fmt(-half)}" width="${fmt(length)}" height="${fmt(half * 2)}" ${endTransform(end)} fill="${style.fill}" stroke="${style.edge}" stroke-width="${fmt(edge)}" data-socket="end"/>` +
      `<line x1="${fmt(length)}" y1="${fmt(-half)}" x2="${fmt(length)}" y2="${fmt(half)}" ${endTransform(end)} stroke="${style.edge}" stroke-width="${fmt(frame.mm(PIPE_STYLE.jointLineMm))}" data-joint="end"/>`
    )
  }
  for (const key of [...endsByPoint.keys()].sort()) {
    const ends = endsByPoint.get(key) as RunEnd[]
    const point = ends[0].point
    const touchesStack = risers.some((riser) => Math.hypot(riser.centre.xM - point.xM, riser.centre.yM - point.yM) <= tol)
    const passingRun = pipes.some(
      (other) => !ends.some((end) => end.pipe.id === other.id) && distanceToSegmentM(point, other) <= tol,
    )
    if (touchesStack || passingRun) continue
    const runEnds = ends.filter((end) => !end.pipe.fitting)
    const bodyEnds = ends.length - runEnds.length
    if (ends.length === 1) {
      if (runEnds.length === 1) jointLines.push(socket(runEnds[0]))
    } else if (bodyEnds > 0) {
      // Port(s) of a fitting body: mark each run entering it.
      for (const end of runEnds) jointLines.push(jointLine(end, 'port'))
    } else if (ends.length === 2) {
      // Corner of the narrower run (the branch turns into the collector).
      const narrow = ends.map((end) => end.pipe).sort((a, b) => pipeBandPx(a, frame).band - pipeBandPx(b, frame).band)[0]
      const { band, edge } = pipeBandPx(narrow, frame)
      const style = PIPE_SYSTEM_STYLE[narrow.system]
      const c = frame.toSvg(point)
      // Stroke centred on the true-scale outline, like the band's edges.
      elbows.push(
        `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(band / 2)}" fill="${style.fill}" stroke="${style.edge}" stroke-width="${fmt(edge)}"/>`,
      )
    }
  }
  return { elbows: elbows.join(''), jointLines: jointLines.join('') }
}

/** Points where an end of either run lies on the other run (tee, elbow, wye). */
function junctionPoints(a: DrawingPipeRun, b: DrawingPipeRun): DrawingPointM[] {
  const tol = PIPE_STYLE.junctionToleranceM
  const points: DrawingPointM[] = []
  for (const end of [a.start, a.end]) if (distanceToSegmentM(end, b) <= tol) points.push(end)
  for (const end of [b.start, b.end]) if (distanceToSegmentM(end, a) <= tol) points.push(end)
  return points
}

function distanceToQuadCentre(quad: Quad, point: Pt): number {
  const cx = (quad.minX + quad.maxX) / 2
  const cy = (quad.minY + quad.maxY) / 2
  return Math.hypot(point.x - cx, point.y - cy)
}

function distanceToSegmentM(point: DrawingPointM, run: DrawingPipeRun): number {
  const dx = run.end.xM - run.start.xM
  const dy = run.end.yM - run.start.yM
  const lengthSq = dx * dx + dy * dy
  if (!(lengthSq > 0)) return Math.hypot(point.xM - run.start.xM, point.yM - run.start.yM)
  const t = Math.max(0, Math.min(1, ((point.xM - run.start.xM) * dx + (point.yM - run.start.yM) * dy) / lengthSq))
  return Math.hypot(point.xM - (run.start.xM + dx * t), point.yM - (run.start.yM + dy * t))
}

// ---------------------------------------------------------------------------
// Pipe labels

interface Placed {
  readonly svg: string
  readonly box: Quad
}

const LABEL_T_CANDIDATES = [0.5, 0.35, 0.65, 0.22, 0.78] as const
/** Runs shorter than this in plan carry no label; a stub cannot host three text lines. */
const MIN_LABELLED_RUN_M = 0.25
/** A branch label may be up to this many times longer than its run. */
const MAX_LABEL_OVERHANG = 1.3
/** How far along a connected run (from the junction) a label may overhang it (paper mm). */
const JUNCTION_LABEL_REACH_MM = 7

/** Two run directions within this angle are collinear for labelling (degrees). */
const CHAIN_ANGLE_TOLERANCE_DEG = 1

/**
 * Groups runs into label chains: pieces of one straight line that touch end to
 * end and carry the same system, ø and slope (a collector cut at each tee, a
 * branch split at a sleeve, the first piece before the first tee whatever its
 * role). The sheet labels such a line once. Order is the pipes' order (chains
 * keep the position of their first piece), so output stays deterministic.
 */
function labelChains(pipes: readonly DrawingPipeRun[]): DrawingPipeRun[][] {
  const tol = PIPE_STYLE.junctionToleranceM
  const runs = pipes.filter((pipe) => !pipe.fitting && Math.hypot(pipe.end.xM - pipe.start.xM, pipe.end.yM - pipe.start.yM) > 0)
  const parent = new Map<string, string>(runs.map((run) => [run.id, run.id]))
  const find = (id: string): string => {
    const p = parent.get(id) as string
    if (p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const touches = (a: DrawingPipeRun, b: DrawingPipeRun) =>
    [a.start, a.end].some((p) => [b.start, b.end].some((q) => Math.hypot(p.xM - q.xM, p.yM - q.yM) <= tol))
  const sameLine = (a: DrawingPipeRun, b: DrawingPipeRun) => {
    const angleA = Math.atan2(a.end.yM - a.start.yM, a.end.xM - a.start.xM)
    const angleB = Math.atan2(b.end.yM - b.start.yM, b.end.xM - b.start.xM)
    let delta = Math.abs(angleA - angleB) % Math.PI
    delta = Math.min(delta, Math.PI - delta)
    if (delta > (CHAIN_ANGLE_TOLERANCE_DEG * Math.PI) / 180) return false
    // b's far end must lie on a's line (not only share the junction point).
    const ux = Math.cos(angleA)
    const uy = Math.sin(angleA)
    return [b.start, b.end].every((p) => Math.abs((p.xM - a.start.xM) * uy - (p.yM - a.start.yM) * ux) <= tol)
  }
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]
      const b = runs[j]
      if (a.system !== b.system || a.diameterMm !== b.diameterMm || a.slopePercent !== b.slopePercent) continue
      if (!touches(a, b) || !sameLine(a, b)) continue
      parent.set(find(b.id), find(a.id))
    }
  }
  const chains = new Map<string, DrawingPipeRun[]>()
  for (const run of runs) {
    const root = find(run.id)
    const chain = chains.get(root) ?? []
    chain.push(run)
    chains.set(root, chain)
  }
  return [...chains.values()]
}

/**
 * The straight line a chain covers, as one run carrying the first piece's
 * identity; a collector anywhere in the chain makes the line a collector.
 */
function chainRun(chain: readonly DrawingPipeRun[]): DrawingPipeRun {
  const first = chain[0]
  if (chain.length === 1) return first
  const role = chain.some((piece) => piece.role === 'collector') ? 'collector' : first.role
  const ux = first.end.xM - first.start.xM
  const uy = first.end.yM - first.start.yM
  const along = (p: DrawingPointM) => (p.xM - first.start.xM) * ux + (p.yM - first.start.yM) * uy
  const points = chain.flatMap((piece) => [piece.start, piece.end])
  let start = first.start
  let end = first.end
  for (const p of points) {
    if (along(p) < along(start)) start = p
    if (along(p) > along(end)) end = p
  }
  return { ...first, role, start, end }
}

function renderPipeLabel(
  pipe: DrawingPipeRun,
  frame: Frame,
  placed: readonly Quad[],
  labelBoxes: readonly Quad[],
): Placed | null {
  if (pipe.fitting) return null // a fitting body carries no run label
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

  const halfBand = pipeBandPx(pipe, frame).outer / 2
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
    if (diameterText === null) {
      const baseline = side < 0 ? -(halfBand + gap) : halfBand + gap + cap(codePx)
      return { extent: side < 0 ? -baseline + cap(codePx) : baseline, svg: textAt(style.code, codePx, baseline) }
    }
    // Reading order on the sheet is always "ø110 mm" over "SW-GRV", whichever
    // side of the run the block sits on: above the run the code is the line
    // nearest the band, below it the diameter is.
    const lineGap = frame.mm(TEXT_STYLE.codeLineGapMm)
    if (side < 0) {
      const codeBaseline = -(halfBand + gap)
      const diameterBaseline = codeBaseline - cap(codePx) - lineGap
      return {
        extent: -diameterBaseline + cap(diameterPx),
        svg: textAt(diameterText, diameterPx, diameterBaseline) + textAt(style.code, codePx, codeBaseline),
      }
    }
    const diameterBaseline = halfBand + gap + cap(diameterPx)
    const codeBaseline = diameterBaseline + lineGap + cap(codePx)
    return {
      extent: codeBaseline,
      svg: textAt(diameterText, diameterPx, diameterBaseline) + textAt(style.code, codePx, codeBaseline),
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
    return { cx, cy, svg: layout.svg, box: orientedBox(cx, cy, ux, uy, nx, ny, halfWidth, layout.above, layout.below) }
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
    // No free spot: a collector keeps its label at the default place as long
    // as that does not print over another label (collinear collector pieces
    // sharing one line are labelled once); a branch stays unlabelled.
    if (pipe.role !== 'collector') return null
    const fallback = candidateAt(layouts[0], LABEL_T_CANDIDATES[0])
    if (labelBoxes.some((other) => overlaps(fallback.box, other))) return null
    chosen = fallback
  }

  const svg = `<g transform="translate(${fmt(chosen.cx)} ${fmt(chosen.cy)}) rotate(${fmt(angleDeg)})" data-label-for="${escapeXml(pipe.id)}">${chosen.svg}</g>`
  return { svg, box: chosen.box }
}

function textAt(content: string, fontPx: number, y: number): string {
  const pad = fontPx * TEXT_STYLE.maskPaddingEm
  const w = textWidthPx(content, fontPx) + 2 * pad
  const h = fontPx * TEXT_STYLE.capHeightEm + 2 * pad
  return (
    `<rect x="${fmt(-w / 2)}" y="${fmt(y - h + pad)}" width="${fmt(w)}" height="${fmt(h)}" fill="${TEXT_STYLE.maskFill}" stroke="none"/>` +
    condensedText(0, y, fontPx, content, 'text-anchor="middle"')
  )
}

/**
 * A text element condensed horizontally by the sheet's width factor about its
 * anchor x: the glyphs are scaled, the baseline is not.
 */
function condensedText(x: number, y: number, fontPx: number, content: string, attributes: string): string {
  const k = TEXT_STYLE.widthFactor
  return `<text x="${fmt(x / k)}" y="${fmt(y)}" font-size="${fmt(fontPx)}" transform="scale(${fmt(k)} 1)" ${attributes}>${escapeXml(content)}</text>`
}

interface Pt {
  readonly x: number
  readonly y: number
}

/** Convex quadrilateral obstacle with a cached bounding box for the quick reject. */
interface Quad {
  readonly pts: readonly [Pt, Pt, Pt, Pt]
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function quadFromPoints(pts: readonly [Pt, Pt, Pt, Pt]): Quad {
  return {
    pts,
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

function quadFromAabb(minX: number, minY: number, maxX: number, maxY: number): Quad {
  return quadFromPoints([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ])
}

/** Oriented box centred at (cx,cy) spanning ±halfWidth along u and [-above, +below] across it. */
function orientedBox(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  nx: number,
  ny: number,
  halfWidth: number,
  above: number,
  below: number,
): Quad {
  // perp < 0 is "above" → move along +n (n points up on the sheet).
  const at = (along: number, perp: number): Pt => ({ x: cx + ux * along - nx * perp, y: cy + uy * along - ny * perp })
  return quadFromPoints([at(-halfWidth, -above), at(halfWidth, -above), at(halfWidth, below), at(-halfWidth, below)])
}

/** Oriented box of the rotated fixture symbol. */
function fixtureBox(fixture: DrawingFixture, frame: Frame): Quad {
  const { widthM, depthM } = fixtureSizeM(fixture)
  // Plan CCW rotation → SVG (y down) clockwise; the box is symmetric so the sign only matters for consistency.
  const theta = (-fixture.rotationDeg * Math.PI) / 180
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const c = frame.toSvg(fixture.centre)
  const hw = (widthM * frame.pxPerM) / 2
  const hd = (depthM * frame.pxPerM) / 2
  return orientedBox(c.x, c.y, ux, uy, uy, -ux, hw, hd, hd)
}

/** A run as a chain of oriented boxes so a label near one end is not blocked by the far end. */
function pipeBoxes(pipe: DrawingPipeRun, frame: Frame): Quad[] {
  const a = frame.toSvg(pipe.start)
  const b = frame.toSvg(pipe.end)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > 0)) return []
  const half = pipeBandPx(pipe, frame).outer / 2
  const ux = (b.x - a.x) / length
  const uy = (b.y - a.y) / length
  const chunks = Math.max(1, Math.ceil(length / frame.mm(8)))
  const step = length / chunks
  const boxes: Quad[] = []
  for (let i = 0; i < chunks; i++) {
    const mid = step * (i + 0.5)
    boxes.push(orientedBox(a.x + ux * mid, a.y + uy * mid, ux, uy, uy, -ux, step / 2, half, half))
  }
  return boxes
}

function insideSheet(box: Quad, frame: Frame): boolean {
  const bottom = frame.heightPx - frame.mm(SHEET_STYLE.titleStripMm) - frame.marginPx / 2
  return box.minX >= 0 && box.minY >= 0 && box.maxX <= frame.widthPx && box.maxY <= bottom
}

function containsPoint(quad: Quad, point: Pt): boolean {
  if (point.x < quad.minX || point.x > quad.maxX || point.y < quad.minY || point.y > quad.maxY) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad.pts[i]
    const b = quad.pts[(i + 1) % 4]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Separating-axis test for two convex quads (touching edges do not count as overlap). */
function overlaps(a: Quad, b: Quad): boolean {
  if (a.minX >= b.maxX || a.maxX <= b.minX || a.minY >= b.maxY || a.maxY <= b.minY) return false
  for (const quad of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = quad.pts[i]
      const q = quad.pts[(i + 1) % 4]
      const axisX = -(q.y - p.y)
      const axisY = q.x - p.x
      const project = (pts: readonly Pt[]) => {
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (const pt of pts) {
          const d = pt.x * axisX + pt.y * axisY
          if (d < min) min = d
          if (d > max) max = d
        }
        return { min, max }
      }
      const pa = project(a.pts)
      const pb = project(b.pts)
      if (pa.max <= pb.min || pb.max <= pa.min) return false
    }
  }
  return true
}

function textWidthPx(content: string, fontPx: number): number {
  return content.length * fontPx * TEXT_STYLE.glyphAdvanceEm * TEXT_STYLE.widthFactor
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

/**
 * The sheet's wall sleeve: a heavy black box the wall thickness long and wider
 * than the band, pale-yellow inside, with one tick across the run at the wall
 * centre. Drawn UNDER the pipes, so the band shows through and only the yellow
 * margin and the outline read as the sleeve.
 */
function renderSleeve(sleeve: DrawingSleeve, frame: Frame): string {
  const centre = frame.toSvg(sleeve.at)
  const stroke = frame.mm(SLEEVE_STYLE.outlineMm)
  const bandMm = pipeBandWidthMm(sleeve.pipeDiameterMm ?? PIPE_STYLE.fallbackDiameterMm.branch, frame.scale)
  const width = frame.mm(Math.max(SLEEVE_STYLE.minWidthMm, bandMm * SLEEVE_STYLE.widthFactor))
  const length = (sleeve.lengthM ?? SLEEVE_STYLE.fallbackLengthM) * frame.pxPerM
  const tick = frame.mm(SLEEVE_STYLE.tickLengthMm) / 2
  // Plan CCW angle → SVG clockwise rotation (y down).
  const rotation = -sleeve.directionDeg
  return (
    `<g transform="translate(${fmt(centre.x)} ${fmt(centre.y)}) rotate(${fmt(rotation)})" data-sleeve="${escapeXml(sleeve.id)}" stroke="${SLEEVE_STYLE.outline}">` +
    `<rect x="${fmt(-length / 2)}" y="${fmt(-width / 2)}" width="${fmt(length)}" height="${fmt(width)}" fill="${SLEEVE_STYLE.fill}" stroke-width="${fmt(stroke)}"/>` +
    `<line x1="0" y1="${fmt(-tick)}" x2="0" y2="${fmt(tick)}" stroke-width="${fmt(frame.mm(SLEEVE_STYLE.tickMm))}"/>` +
    `</g>`
  )
}

// ---------------------------------------------------------------------------
// Stacks

/** Outer radius of the riser symbol on paper (a symbol, the same for every ø). */
function stackRadiusPx(frame: Frame): number {
  return frame.mm(STACK_STYLE.symbolDiameterMm) / 2
}

function renderStackSymbol(riser: DrawingRiser, frame: Frame): Placed {
  const c = frame.toSvg(riser.centre)
  const outline = frame.mm(STACK_STYLE.outlineMm)
  // The ring is drawn inside the symbol diameter.
  const r = stackRadiusPx(frame) - outline / 2
  const cross = frame.mm(STACK_STYLE.crosshairLengthMm) / 2
  const style = PIPE_SYSTEM_STYLE[riser.system]
  // Sanitary: solid disc in the system colour. Vent: open (white) circle with
  // a centre dot in the vent colour — a different symbol, not only a colour.
  // Ring and crosshair are the system's dark edge green, as on the sheet.
  const vent = riser.system === 'vent'
  const disc = `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}" fill="${vent ? STACK_STYLE.ventOpenFill : style.fill}" stroke="${style.edge}" stroke-width="${fmt(outline)}"/>`
  const dot = vent ? `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r * STACK_STYLE.ventDotFactor)}" fill="${style.fill}"/>` : ''
  const svg =
    `<g data-stack="${escapeXml(riser.id)}" data-system="${riser.system}">` +
    `<path d="M${fmt(c.x - cross)} ${fmt(c.y)}H${fmt(c.x + cross)}M${fmt(c.x)} ${fmt(c.y - cross)}V${fmt(c.y + cross)}" stroke="${style.edge}" stroke-width="${fmt(frame.mm(STACK_STYLE.crosshairMm))}"/>` +
    disc +
    dot +
    `</g>`
  return { svg, box: quadFromAabb(c.x - cross, c.y - cross, c.x + cross, c.y + cross) }
}

/** Pill text: diameter and sheet tag — "ø110 mm (1.4ק)"; vents lead with their code, "VNT ø110 mm (1.4ק)". */
export function formatStackTagText(riser: Pick<DrawingRiser, 'system' | 'diameterMm' | 'tag'>): string {
  const code = STACK_STYLE.tagSystemCode[riser.system] ? `${PIPE_SYSTEM_STYLE[riser.system].code} ` : ''
  return riser.diameterMm === null ? `${code}(${riser.tag})` : `${code}${formatDiameter(riser.diameterMm)} (${riser.tag})`
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

/**
 * Stack tag: the sheet's stadium pill with the diameter and the floor tag,
 * nothing else — the storeys a stack spans (`spansStoreyLabels`) stay in the
 * model for the panels and are not printed on the drawing.
 */
function renderStackTag(riser: DrawingRiser, frame: Frame, placed: readonly Quad[]): Placed {
  const c = frame.toSvg(riser.centre)
  const r = stackRadiusPx(frame)
  const fontPx = frame.mm(TEXT_STYLE.tagMm)
  const cap = fontPx * TEXT_STYLE.capHeightEm
  const content = formatStackTagText(riser)
  const padX = frame.mm(STACK_STYLE.pillPaddingXMm)
  const padY = frame.mm(STACK_STYLE.pillPaddingYMm)
  const pillW = textWidthPx(content, fontPx) + 2 * padX
  const pillH = cap + 2 * padY

  // Up-right by default, then the other quadrants; a pill must stay on the
  // sheet and prefers not to overlap anything already placed.
  const candidates = TAG_DISTANCE_FACTORS.flatMap((factor) =>
    TAG_OFFSETS.map(([sx, sy]) => {
      const px = c.x + sx * frame.mm(STACK_STYLE.pillOffsetXMm) * factor + (sx * pillW) / 2
      const py = c.y + sy * frame.mm(STACK_STYLE.pillOffsetYMm) * factor
      const box = quadFromAabb(px - pillW / 2, py - pillH / 2, px + pillW / 2, py + pillH / 2)
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
    condensedText(centreX, centreY + cap / 2, fontPx, content, 'text-anchor="middle" direction="ltr" unicode-bidi="bidi-override"') +
    `</g>`
  return { svg, box: pill }
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
