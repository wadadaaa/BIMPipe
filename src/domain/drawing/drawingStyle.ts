/**
 * Graphic language of the sanitary plan renderer.
 *
 * Every dimension here is millimetres ON PAPER, independent of the drawing
 * scale, except pipe bands, which are true-scale (diameter / scale) like a
 * Revit "medium detail" two-line pipe. The values were read off a reference
 * sanitary sheet drawn at 1:100 on A1 (rasterised at 220 dpi):
 *
 * - Architecture is a light-grey underlay: walls filled `#e7e7e2` with a fine
 *   diagonal cross-hatch and a mid-grey outline; nothing architectural is
 *   black. The WC is drawn as the sheet's plumbing fixture (dark-green
 *   hairline, no fill); every other fixture as the architect's underlay
 *   (pale-teal hairline, light-grey fill).
 * - Pipes are double-line bands at true scale: light green fill with a very
 *   dark green edge for gravity sanitary, dark olive for vent. Ø110 at 1:100
 *   is a 1.1 mm band; Ø50 is clamped to a legible minimum.
 * - Labels (black Arial-like sans, condensed to 0.8 of the natural width the
 *   way a Revit text type with width factor 0.8 prints): "ø110 mm" in 3.5 mm
 *   text with the system code ("SW-GRV") in 2.4 mm text 1.6 mm beneath it on
 *   one side of the run; the slope "2.0%" in 3.5 mm text on the other side
 *   with a thin flow arrow under it. All text is rotated along the run and
 *   reads left→right / bottom→top. (S1: digit cap height measured 22 px on
 *   the sheet vs 19 px in ours at 3.0 mm; "ø50 mm" 85 px wide vs 90 px.)
 * - Stacks are a small disc (2.1 mm, whatever the stack ø) in the system fill
 *   with a ring and hairline crosshairs in the system's dark edge colour, not
 *   black; the stack tag sits in a stadium (pill) bubble — "ø160 mm (1.14ק)",
 *   no fill so the underlay shows through — joined by a thin leader ending in
 *   a filled arrowhead.
 * - Wall sleeves are a pale-yellow rectangle spanning the wall thickness with
 *   a heavy black outline and one tick across the run, drawn under the pipe.
 * - A free run end closes with a short socket a little proud of the band; a
 *   pipe entering a fitting body gets a joint line across it.
 *
 * Scale conversion: px = mm × dpi / 25.4; plan metres → mm on paper = 1000 / scale.
 */

export const DRAWING_FONT_FAMILY = "Arial, Helvetica, 'Liberation Sans', sans-serif"

/** Nominal sheet the mm-on-paper values were calibrated against. */
export const REFERENCE_SHEET_SCALE = 100

export const SHEET_STYLE = {
  background: '#ffffff',
  /** Blank margin around the plan bounds (paper mm). */
  marginMm: 14,
  /** Height reserved under the plan for the view title (paper mm). */
  titleStripMm: 16,
} as const

/** Architecture underlay. */
export const UNDERLAY_STYLE = {
  // Sampled: outline #a6a6a6 ≈ 0.4 mm, fill #e7e7e2, crisp cross-hatch
  // #bdbdba at ~1.4 mm paper spacing — a poché that reads as "wall" yet still
  // recedes behind the green pipework.
  wallFill: '#e7e7e2',
  wallOutline: '#a6a6a6',
  wallOutlineMm: 0.4,
  wallHatchStroke: '#bdbdba',
  wallHatchStrokeMm: 0.13,
  /** Spacing between hatch lines on paper (a drafting pattern, scale-independent). */
  wallHatchSpacingMm: 1.4,
  columnFill: '#c4c4c4',
  columnOutline: '#9a9a9a',
  columnOutlineMm: 0.35,
  slabOpeningStroke: '#a6a6a6',
  slabOpeningStrokeMm: 0.25,
  slabOpeningDashMm: [1.6, 1.0] as readonly [number, number],
  shaftCandidateStroke: '#c4c4c4',
  shaftCandidateStrokeMm: 0.18,
  shaftCandidateDashMm: [0.6, 0.8] as readonly [number, number],
  // Fixtures. The sheet shows two families (S1-4, 220 dpi): the WC is the
  // PLUMBING fixture family — a dark-green hairline (#004000, ~1 px ≈ 0.12 mm)
  // with a white interior — while basins, sinks, showers and baths are the
  // ARCHITECT's underlay: pale-teal hairline (sampled #b2d8d8) with a
  // light-grey fill (#ebebeb) and the plumbing layer adding only the trap.
  // The model carries one merged fixture per appliance, so the WC takes the
  // plumbing look and every other kind the architect look. (G4 iteration 1
  // named pale-teal-only WCs as the biggest gap; S1-4 named grey-filled
  // dark-green basins as "placeholder glyphs".)
  fixtureStroke: '#004000',
  fixtureStrokeMm: 0.12,
  fixtureFill: 'none',
  architectFixtureStroke: '#b2d8d8',
  architectFixtureFill: '#ebebeb',
} as const

export interface PipeSystemStyle {
  readonly fill: string
  readonly edge: string
  /** System code printed under the diameter label. */
  readonly code: string
}

/** Pipe bands per system, colours sampled from the reference sheet. */
export const PIPE_SYSTEM_STYLE: Readonly<Record<'sanitary' | 'vent', PipeSystemStyle>> = {
  sanitary: { fill: '#92d050', edge: '#004000', code: 'SW-GRV' },
  vent: { fill: '#4f6228', edge: '#1f2a0a', code: 'VNT' },
}

export const PIPE_STYLE = {
  /**
   * Edge line of a band (paper mm), the same for every run. The sheet's pipes
   * read as double lines: one dark hairline on each side of a lighter fill,
   * drawn ON the true-scale outline (S1-2, 220 dpi): ø50 = 1 + 4 + 1 px,
   * ø63 = 1 + 3 + 2 px, ø110 = 1 + 8 + 1 px dark/green/dark — ~1 px edges
   * (0.12 mm) whichever the diameter, and the fill keeps nearly the whole
   * true-scale width. Edges inside the band (as before) rendered 2 px dark
   * each side and a ø50 fill of 2 px — the "thin dark line" a critic named.
   */
  edgeMm: 0.12,
  /** Bands never get thinner than this on paper. */
  minBandMm: 0.6,
  /** Diameter assumed for a run whose ø is unknown, by role. */
  fallbackDiameterMm: { branch: 50, collector: 110 } as const,
  /**
   * Fittings are subtle on the sheet (S1, measured at 220 dpi): a joint is a
   * dark line ACROSS the band — 2 px ≈ 0.23 mm thick, no wider than the band
   * itself (a ø110 band measures 12 px at a socket and 12 px beside it) — and an
   * elbow is a rounded outer corner of the band, never a collar or box wider
   * than the run. So a free end closes the band with an end line, a pipe end
   * entering a fitting body gets the same line across it (the sheet marks
   * every pipe-to-fitting port this way) and a two-run corner gets a
   * quarter-round of the band's own width; nothing is added at tees and stack
   * entries, where the through run's edge already reads as the joint.
   */
  jointLineMm: 0.23,
  /**
   * A free run end (the fixture connection) closes with a short socket, not a
   * bare line: on the sheet (S1-5, 220 dpi) the WC connector is 14 px wide on an
   * 11 px band — about 0.17 mm proud of the band each side — and ~9 px ≈ 1.0 mm
   * long, outlined and crossed by a line at each end.
   */
  socketFlareMm: 0.17,
  socketLengthMm: 1.0,
  /** Endpoints closer than this in plan are the same junction (metres). */
  junctionToleranceM: 0.002,
} as const

/**
 * Band width on paper at a nominal 1:50 sheet, by nominal diameter. True
 * scale (ø / 50) — listed explicitly so the mapping is reviewable; other
 * diameters fall back to the same formula.
 */
export const PIPE_BAND_WIDTH_MM_AT_1_50: Readonly<Record<number, number>> = {
  32: 0.7,
  40: 0.8,
  50: 1.0,
  63: 1.26,
  75: 1.5,
  90: 1.8,
  110: 2.2,
  125: 2.5,
  160: 3.2,
  200: 4.0,
}

/** Band width on paper for a diameter at a given scale (mm). */
export function pipeBandWidthMm(diameterMm: number, scale: number): number {
  const at50 = PIPE_BAND_WIDTH_MM_AT_1_50[diameterMm] ?? diameterMm / 50
  return Math.max(PIPE_STYLE.minBandMm, (at50 * 50) / scale)
}

export const TEXT_STYLE = {
  colour: '#000000',
  // Sheet digits: cap height 22 px = 2.54 mm → 3.5 mm Arial; code 15 px = 1.7 mm → 2.4 mm.
  /** "ø110 mm" */
  diameterMm: 3.5,
  /** "2.0%" */
  slopeMm: 3.5,
  /** "SW-GRV" under the diameter. */
  systemCodeMm: 2.4,
  /** Clear gap between the diameter baseline and the system code's cap line (sheet ≈ 15 px). */
  codeLineGapMm: 1.6,
  /** Stack tag inside the pill. */
  tagMm: 3.5,
  titleMm: 5.0,
  scaleMm: 3.5,
  /** Gap between the band edge and the nearest text baseline / cap line. */
  labelGapMm: 1.0,
  /** Average glyph advance as a fraction of the font size (Arial digits/lowercase). */
  glyphAdvanceEm: 0.56,
  /**
   * Horizontal condensing applied to every label glyph (Revit "width factor"):
   * the sheet's "ø50 mm" at 3.5 mm is 85 px wide where natural Arial would be
   * ~105 px; "SW-GRV" 67 px vs ~78 px.
   */
  widthFactor: 0.8,
  /** Cap height as a fraction of the font size. */
  capHeightEm: 0.72,
  /**
   * Run labels sit on an opaque white mask so they stay legible over the
   * architectural underlay (the sheet's text has background masking on).
   */
  maskFill: '#ffffff',
  maskPaddingEm: 0.12,
} as const

export const SLOPE_ARROW_STYLE = {
  stroke: '#000000',
  strokeMm: 0.18,
  /** Arrow shaft length on paper. */
  lengthMm: 6,
  headLengthMm: 1.6,
  headWidthMm: 0.9,
  /** Gap between the slope text baseline and the arrow shaft. */
  gapMm: 0.6,
} as const

export const STACK_STYLE = {
  /**
   * Riser symbol as measured on the sheet (220 dpi): outer diameter 18 px =
   * 2.1 mm for every stack (ø110 and ø160 alike — a symbol, not true scale),
   * ring 2 px ≈ 0.23 mm in the system's dark edge colour (sampled #004000,
   * the same green as the pipe edges — not black), crosshair a 1 px hairline
   * of the same green spanning 35 px = 4.0 mm through the centre.
   */
  symbolDiameterMm: 2.1,
  outlineMm: 0.23,
  crosshairLengthMm: 4.0,
  crosshairMm: 0.12,
  /**
   * Vent stack symbol (R3): an OPEN circle (white) with a centre dot in the
   * vent colour instead of the sanitary stack's solid fill, so a vent is told
   * apart from a sanitary stack at a glance even in greyscale; the dot radius
   * is this fraction of the circle radius.
   */
  ventOpenFill: '#ffffff',
  ventDotFactor: 0.38,
  /**
   * Which systems print their code in the tag pill. The sheet tags a sanitary
   * riser as "ø110 mm (1.13ק)" — no code, no storey range — so sanitary pills
   * copy that verbatim. The sheet has no vent-riser tag to copy; a vent pill
   * keeps "VNT " so the text, not only the symbol, tells the two apart.
   */
  tagSystemCode: { sanitary: false, vent: true } as Readonly<Record<'sanitary' | 'vent', boolean>>,
  /**
   * Tag pill: 1 px ≈ 0.13 mm outline, NO fill (the wall hatch shows through
   * the sheet's pills), 45 px = 5.2 mm tall around the 3.5 mm text.
   */
  pillStroke: '#000000',
  pillStrokeMm: 0.13,
  pillFill: 'none',
  pillPaddingXMm: 1.2,
  pillPaddingYMm: 1.3,
  /** Pill anchor offset from the stack centre (paper mm, up-right by default). */
  pillOffsetXMm: 7,
  pillOffsetYMm: 6,
  leaderStroke: '#000000',
  leaderMm: 0.13,
  leaderHeadLengthMm: 1.4,
  leaderHeadWidthMm: 0.8,
} as const

/**
 * Wall penetration (sleeve). The sheet's interior wall-sleeve family (S1-5,
 * 220 dpi, on a ø110 run of 10 px): a black box 16 px ≈ 1.85 mm across — about
 * 1.6 × the band — running the wall thickness, heavy outline (3–4 px ≈
 * 0.35 mm), pale-yellow fill showing in the margin around the band, the band
 * itself drawn ON TOP so the pipe reads through, and one tick across the run
 * at the wall centre, 28 px ≈ 3.2 mm long, 2 px ≈ 0.23 mm. So the box goes
 * UNDER the pipes and carries no X. (A critic named the previous yellow X-box
 * drawn over the pipe as the biggest gap: it hid the run and read as a valve.)
 */
export const SLEEVE_STYLE = {
  fill: '#ffff80',
  outline: '#000000',
  outlineMm: 0.35,
  /** Sleeve width across the pipe = max(minWidthMm, band × widthFactor). */
  widthFactor: 1.6,
  minWidthMm: 1.6,
  /** Length along the pipe when the crossing length is unknown (metres in plan). */
  fallbackLengthM: 0.2,
  tickLengthMm: 3.2,
  tickMm: 0.23,
} as const

/** Default plan footprints (metres) for fixture symbols without a footprint. */
export const FIXTURE_DEFAULT_SIZE_M: Readonly<
  Record<
    'toilet' | 'basin' | 'sink' | 'urinal' | 'shower' | 'bath' | 'bidet' | 'floor-drain' | 'other',
    { readonly widthM: number; readonly depthM: number }
  >
> = {
  toilet: { widthM: 0.38, depthM: 0.7 },
  basin: { widthM: 0.5, depthM: 0.42 },
  sink: { widthM: 0.8, depthM: 0.5 },
  urinal: { widthM: 0.35, depthM: 0.35 },
  shower: { widthM: 0.9, depthM: 0.9 },
  bath: { widthM: 1.7, depthM: 0.75 },
  bidet: { widthM: 0.36, depthM: 0.55 },
  'floor-drain': { widthM: 0.12, depthM: 0.12 },
  other: { widthM: 0.4, depthM: 0.4 },
}

export const TITLE_STYLE = {
  ruleStroke: '#000000',
  ruleMm: 0.35,
  bubbleDiameterMm: 8,
  bubbleStrokeMm: 0.25,
} as const

/** Millimetres on paper → pixels. */
export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / 25.4
}

/** Plan metres → millimetres on paper at a scale (1:scale). */
export function metresToPaperMm(metres: number, scale: number): number {
  return (metres * 1000) / scale
}
