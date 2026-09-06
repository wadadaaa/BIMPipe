/**
 * Graphic language of the sanitary plan renderer.
 *
 * Every dimension here is millimetres ON PAPER, independent of the drawing
 * scale, except pipe bands, which are true-scale (diameter / scale) like a
 * Revit "medium detail" two-line pipe. The values were read off a reference
 * sanitary sheet drawn at 1:100 on A1 (rasterised at 220 dpi):
 *
 * - Architecture is a light-grey underlay: walls filled `#e7e7e2` with a fine
 *   diagonal cross-hatch and a mid-grey outline; fixtures are thin pale-teal
 *   outlines with a light-grey fill; nothing architectural is black.
 * - Pipes are double-line bands at true scale: light green fill with a very
 *   dark green edge for gravity sanitary, dark olive for vent. Ø110 at 1:100
 *   is a 1.1 mm band; Ø50 is clamped to a legible minimum.
 * - Labels (black Arial-like sans): "ø110 mm" in ~3 mm text with the system
 *   code ("SW-GRV") in ~2 mm text beneath it on one side of the run; the
 *   slope "2.0%" in ~3 mm text on the other side with a thin flow arrow under
 *   it. All text is rotated along the run and reads left→right / bottom→top.
 * - Stacks are a filled circle in the system colour with a black outline and
 *   crosshairs extending past the circle; the stack tag sits in a stadium
 *   (pill) bubble — "ø160 mm (1.14ק)" — joined by a thin leader ending in a
 *   filled arrowhead.
 * - Wall sleeves are a pale-yellow rectangle spanning the wall thickness with
 *   a black outline and an X across it.
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
  // Fixtures are pale teal outlines (#b2d8d8 sampled) on a light-grey fill.
  fixtureStroke: '#a3cbc7',
  fixtureStrokeMm: 0.16,
  fixtureFill: '#ebebeb',
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
   * Edge line of a band (paper mm). The sheet's pipes read as double lines:
   * two visible dark edges around a lighter fill, not a single solid stroke.
   */
  edgeMm: 0.14,
  /** Edge line of a collector band (paper mm) — a touch heavier than a branch. */
  collectorEdgeMm: 0.16,
  /** Bands never get thinner than this on paper. */
  minBandMm: 0.6,
  /** Diameter assumed for a run whose ø is unknown, by role. */
  fallbackDiameterMm: { branch: 50, collector: 110 } as const,
  /**
   * Fittings are subtle on the sheet: a short collar a little wider than the
   * band sitting on the branch side of a tee/elbow/stack entry (hub) or at a
   * free fixture connection (socket) — never a dot that reads as a node.
   */
  hubWidthFactor: 1.35,
  hubLengthFactor: 0.9,
  socketWidthFactor: 1.35,
  socketLengthFactor: 0.8,
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
  /** "ø110 mm" */
  diameterMm: 3.0,
  /** "2.0%" */
  slopeMm: 3.0,
  /** "SW-GRV" under the diameter. */
  systemCodeMm: 2.0,
  /** Stack tag inside the pill. */
  tagMm: 3.0,
  /** Small storey-span note under the stack tag. */
  noteMm: 1.8,
  titleMm: 5.0,
  scaleMm: 3.5,
  /** Gap between the band edge and the nearest text baseline / cap line. */
  labelGapMm: 1.0,
  /** Average glyph advance as a fraction of the font size (Arial digits/lowercase). */
  glyphAdvanceEm: 0.56,
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
  outline: '#000000',
  outlineMm: 0.25,
  /** Circle diameter = max(minDiameterMm, band × bandFactor). */
  bandFactor: 1.8,
  minDiameterMm: 2.6,
  /** Crosshair half-length as a multiple of the circle radius. */
  crosshairFactor: 1.5,
  crosshairMm: 0.18,
  /** Tag pill. */
  pillStroke: '#000000',
  pillStrokeMm: 0.18,
  pillFill: '#ffffff',
  pillPaddingXMm: 1.2,
  pillPaddingYMm: 0.6,
  /** Pill anchor offset from the stack centre (paper mm, up-right by default). */
  pillOffsetXMm: 7,
  pillOffsetYMm: 6,
  leaderStroke: '#000000',
  leaderMm: 0.13,
  leaderHeadLengthMm: 1.4,
  leaderHeadWidthMm: 0.8,
} as const

export const SLEEVE_STYLE = {
  fill: '#ffff80',
  outline: '#000000',
  outlineMm: 0.18,
  /** Sleeve width across the pipe = max(minWidthMm, band × widthFactor). */
  widthFactor: 1.8,
  minWidthMm: 1.8,
  /** Length along the pipe when the crossing length is unknown (metres in plan). */
  fallbackLengthM: 0.2,
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
