/**
 * Engineer plumbing baseline: types for the pipe network extracted from an
 * engineer-authored plumbing IFC, plus pure classification of vertical pipe
 * segments into sanitary riser stacks, vent stacks, and stubs (see
 * `classifyEngineerRiserStacks` for the definition).
 *
 * Coordinate conventions:
 * - Segment endpoints are in SOURCE model coordinates (the IFC's own length
 *   unit and project frame, Z-up). `EngineerPipeNetwork.metersPerSourceUnit`
 *   is the explicit conversion factor (e.g. 0.01 for a centimetre model).
 * - Derived stack positions (`xM`, `yM`) and all tolerances are in metres,
 *   converted at this boundary. Diameters are always millimetres.
 *
 * This module is pure (no web-ifc); extraction lives in
 * `src/shared/ifc/extractEngineerPipeNetwork.ts` and imports these types.
 */
import type { StoreyId } from './types'

export interface EngineerStoreyRef {
  /** IFC express ID of the IfcBuildingStorey. */
  id: StoreyId
  name: string
  /** Storey elevation in SOURCE units (convert with metersPerSourceUnit). */
  elevationSource: number
}

/**
 * How a segment centreline was derived:
 * - `extrusion-axis`: IfcExtrudedAreaSolid axis through the placement chain.
 * - `distribution-ports`: the two IfcDistributionPort placements of the
 *   segment (Revit exports vertical pipes as a cut face with full-length ports).
 * - `mesh-bounds`: bounding-box centreline of the tessellated mesh (approximate).
 */
export type EngineerEndpointSource = 'extrusion-axis' | 'distribution-ports' | 'mesh-bounds'

export interface EngineerPoint3 {
  x: number
  y: number
  z: number
}

export interface EngineerPipeSegment {
  expressId: number
  name: string | null
  /**
   * `IfcElement.Tag` as written in the file; null when absent. Optional so
   * older fixtures stay valid. Revit exports write the element id here, so
   * callers must treat it as free text unless it matches a sheet-tag pattern
   * (see `neutraliseEngineerTagText` in `src/shared/drawing/riserTag.ts`).
   */
  tag?: string | null
  /** Name of the owning IfcSystem (e.g. "SW-GRV 14"); null when ungrouped. */
  systemName: string | null
  /** Containing IfcBuildingStorey express ID; null when not resolvable. */
  storeyId: StoreyId | null
  storeyName: string | null
  /** Centreline start in SOURCE coordinates; null when geometry is unavailable. */
  start: EngineerPoint3 | null
  /** Centreline end in SOURCE coordinates; null when geometry is unavailable. */
  end: EngineerPoint3 | null
  /** How the centreline was derived; null when no geometry was found. */
  endpointSource: EngineerEndpointSource | null
  /** Outer diameter in millimetres from IfcCircleProfileDef; null for other profiles. */
  outerDiameterMm: number | null
  /** Pset_FlowSegmentPipeSegment.Length in metres; null when the pset value is absent. */
  lengthM: number | null
  /** Pset_FlowSegmentPipeSegment.InvertElevation in metres; null when absent. */
  invertElevationM: number | null
}

export interface EngineerPipeNetwork {
  /** Explicit source-unit conversion (metres per one source unit). */
  metersPerSourceUnit: number
  /** All building storeys, sorted by elevation ascending. */
  storeys: EngineerStoreyRef[]
  /** Extracted segments, sorted by expressId ascending. */
  segments: EngineerPipeSegment[]
}

/**
 * System name prefixes of sanitary (soil/waste gravity) systems whose vertical
 * runs form sanitary riser stacks, and of vent systems whose vertical runs
 * form vent stacks. The two classes are grouped and counted separately —
 * a vent is never mixed into the sanitary stack count.
 */
export const ENGINEER_SANITARY_SYSTEM_PREFIXES: readonly string[] = ['SW-GRV']
export const ENGINEER_VENT_SYSTEM_PREFIXES: readonly string[] = ['VNT']

/** Union of both classes: what the extraction step filters the model by. */
export const ENGINEER_RISER_SYSTEM_PREFIXES: readonly string[] = [
  ...ENGINEER_SANITARY_SYSTEM_PREFIXES,
  ...ENGINEER_VENT_SYSTEM_PREFIXES,
]

/** Minimum outer diameter for a vertical run to be riser-eligible (both classes). */
export const ENGINEER_RISER_MIN_DIAMETER_MM = 110

/**
 * A segment is vertical when its axis is within this angle of the source
 * Z-axis (IFC models are Z-up).
 */
export const ENGINEER_RISER_VERTICAL_TOLERANCE_DEG = 5

/**
 * Vertical segments whose plan (XY) midpoints are within this distance are
 * grouped into the same XY group. mm/m constant pair per repo convention.
 */
export const ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM = 250
export const ENGINEER_RISER_XY_GROUPING_TOLERANCE_M = 0.25

/**
 * Within one XY group, member Z-ranges that overlap or are separated by at
 * most this gap chain into one vertical run (fittings, couplings and short
 * unmodelled pieces sit in the gap). Larger gaps split the group into
 * separate runs at the same XY. Approximate heuristic, documented here.
 */
export const ENGINEER_RISER_CHAIN_GAP_MM = 1000
export const ENGINEER_RISER_CHAIN_GAP_M = 1.0

/**
 * Fallback minimum vertical extent for a run to count as a stack, used only
 * when the storey list yields no pitch (fewer than two distinct elevations).
 */
export const ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_MM = 2500
export const ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M = 2.5

/** A run whose extent falls short of the threshold by ≤ this still qualifies (float noise). */
export const ENGINEER_RISER_EXTENT_EPSILON_MM = 10
export const ENGINEER_RISER_EXTENT_EPSILON_M = 0.01

/**
 * A stack intersects a storey slab band when its Z-range overlaps the band by
 * more than this length. Purely geometric: a stack passing through a storey's
 * ceiling void counts as present on that storey.
 */
export const ENGINEER_STACK_STOREY_OVERLAP_MIN_MM = 100
export const ENGINEER_STACK_STOREY_OVERLAP_MIN_M = 0.1

export type EngineerRiserSystemClass = 'sanitary' | 'vent'

export interface EngineerRiserStack {
  /**
   * Deterministic ID after sorting by (xM, yM, zMinM, smallest member expressId):
   * `engineer-riser-<n>` (sanitary stacks), `engineer-vent-<n>` (vent stacks),
   * `engineer-stub-<n>` (runs below the extent threshold, either class).
   */
  id: string
  systemClass: EngineerRiserSystemClass
  /** Mean plan X of member segment midpoints, in metres (source frame). */
  xM: number
  /** Mean plan Y of member segment midpoints, in metres (source frame). */
  yM: number
  /** Lowest member Z in metres (source frame, Z-up). */
  zMinM: number
  /** Highest member Z in metres (source frame, Z-up). */
  zMaxM: number
  /** zMaxM − zMinM: the run's total vertical extent in metres. */
  extentM: number
  /**
   * Distinct storeys the member segments are CONTAINED in (IfcRelContainedIn-
   * SpatialStructure), sorted by elevation ascending. Containment understates
   * the span when a model draws a full-height pipe on one storey; use
   * `spannedStoreyIds` for the geometric span.
   */
  storeys: Array<{ id: StoreyId; name: string | null }>
  /**
   * Storeys whose slab band the run's Z-range intersects (see
   * `storeySlabBandM`), sorted by elevation ascending.
   */
  spannedStoreyIds: StoreyId[]
  /** Largest member outer diameter in millimetres. */
  diameterMm: number
  /** Member segment express IDs, sorted ascending. */
  segmentExpressIds: number[]
}

export interface StoreySlabBandM {
  storeyId: StoreyId
  /** Storey elevation in metres. */
  bottomM: number
  /** Elevation of the next storey strictly above, or +Infinity for the top storey. */
  topM: number
}

export type MinStackExtentSource = 'storey-pitch-median' | 'fallback-constant' | 'option'

export interface EngineerRiserClassification {
  /** Sanitary runs with extent ≥ threshold, sorted by (xM, yM, zMinM). */
  sanitaryStacks: EngineerRiserStack[]
  /** Vent runs with extent ≥ threshold, sorted by (xM, yM, zMinM). */
  ventStacks: EngineerRiserStack[]
  /** Runs of either class below the threshold, sorted by (xM, yM, zMinM). */
  stubs: EngineerRiserStack[]
  /** The extent threshold actually applied, in metres. */
  minStackExtentM: number
  minStackExtentSource: MinStackExtentSource
  /** Median positive consecutive storey pitch in metres; null when not derivable. */
  storeyPitchM: number | null
}

export interface ClassifyEngineerRiserOptions {
  sanitarySystemPrefixes?: readonly string[]
  ventSystemPrefixes?: readonly string[]
  minDiameterMm?: number
  verticalToleranceDeg?: number
  xyGroupingToleranceM?: number
  chainGapM?: number
  /** Overrides the derived storey pitch as the stack extent threshold. */
  minStackExtentM?: number
  storeyOverlapMinM?: number
}

/**
 * True when the segment has endpoints and its axis is within `toleranceDeg`
 * of vertical (source Z-axis). Unit-free: uses only the endpoint delta ratio.
 */
export function isVerticalEngineerSegment(
  segment: EngineerPipeSegment,
  toleranceDeg: number = ENGINEER_RISER_VERTICAL_TOLERANCE_DEG,
): boolean {
  if (segment.start === null || segment.end === null) return false
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const dz = segment.end.z - segment.start.z
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (length === 0) return false
  const minVerticalRatio = Math.cos((toleranceDeg * Math.PI) / 180)
  return Math.abs(dz) / length >= minVerticalRatio
}

function matchesAnyPrefix(systemName: string | null, prefixes: readonly string[]): boolean {
  if (systemName === null) return false
  const normalized = systemName.trim().toUpperCase()
  return prefixes.some((prefix) => normalized.startsWith(prefix.trim().toUpperCase()))
}

interface RiserCandidate {
  segment: EngineerPipeSegment
  /** Plan midpoint in metres. */
  xM: number
  yM: number
  /** Z-range in metres. */
  zMinM: number
  zMaxM: number
}

/** A stack before it receives its class-specific ID. */
type UnidentifiedStack = Omit<EngineerRiserStack, 'id'>

/**
 * Median of the positive elevation differences between consecutive distinct
 * storey elevations, in metres. Null when fewer than two distinct elevations
 * exist. The median (not the minimum) is used so a split level or a
 * near-duplicate storey does not collapse the pitch to a few centimetres.
 */
export function deriveStoreyPitchM(
  storeys: readonly EngineerStoreyRef[],
  metersPerSourceUnit: number,
): number | null {
  const elevations = [...new Set(storeys.map((storey) => storey.elevationSource))].sort(
    (a, b) => a - b,
  )
  const pitches: number[] = []
  for (let i = 1; i < elevations.length; i++) {
    const pitch = (elevations[i] - elevations[i - 1]) * metersPerSourceUnit
    if (pitch > 0) pitches.push(pitch)
  }
  if (pitches.length === 0) return null
  pitches.sort((a, b) => a - b)
  const middle = Math.floor(pitches.length / 2)
  return pitches.length % 2 === 1 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2
}

/**
 * Slab band of a storey in metres: [elevation, elevation of the next storey
 * strictly above). The top storey's band is open-ended (+Infinity). Null when
 * the storey is not in the network's storey list.
 */
export function storeySlabBandM(
  network: Pick<EngineerPipeNetwork, 'storeys' | 'metersPerSourceUnit'>,
  storeyId: StoreyId,
): StoreySlabBandM | null {
  const storey = network.storeys.find((candidate) => candidate.id === storeyId)
  if (storey === undefined) return null
  let nextAbove = Infinity
  for (const candidate of network.storeys) {
    if (candidate.elevationSource > storey.elevationSource && candidate.elevationSource < nextAbove) {
      nextAbove = candidate.elevationSource
    }
  }
  return {
    storeyId,
    bottomM: storey.elevationSource * network.metersPerSourceUnit,
    topM: nextAbove === Infinity ? Infinity : nextAbove * network.metersPerSourceUnit,
  }
}

/**
 * True when the run's Z-range overlaps the band by more than `overlapMinM`.
 * Overlap = min(zMax, top) − max(zMin, bottom); a run ending exactly at the
 * band's bottom does not intersect it, a run starting there does.
 */
export function stackIntersectsBand(
  stack: Pick<EngineerRiserStack, 'zMinM' | 'zMaxM'>,
  band: Pick<StoreySlabBandM, 'bottomM' | 'topM'>,
  overlapMinM: number = ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
): boolean {
  const overlap = Math.min(stack.zMaxM, band.topM) - Math.max(stack.zMinM, band.bottomM)
  return overlap > overlapMinM
}

/** Stacks whose Z-range intersects the storey band; input order is preserved. */
export function stacksIntersectingBand<T extends Pick<EngineerRiserStack, 'zMinM' | 'zMaxM'>>(
  stacks: readonly T[],
  band: Pick<StoreySlabBandM, 'bottomM' | 'topM'>,
  overlapMinM: number = ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
): T[] {
  return stacks.filter((stack) => stackIntersectsBand(stack, band, overlapMinM))
}

export interface EngineerBranchSelection {
  /** Sanitary, non-vertical segments on the storey, sorted by expressId. */
  segments: EngineerPipeSegment[]
  /** Segments placed on the storey by their centreline Z-range. */
  byGeometryCount: number
  /**
   * Segments without a resolved centreline that were placed by their IFC
   * storey containment instead (the only storey signal they carry).
   */
  byContainmentCount: number
}

export interface SelectEngineerBranchSegmentsOptions {
  systemPrefixes?: readonly string[]
  verticalToleranceDeg?: number
}

/**
 * The engineer's horizontal sanitary branch population on one storey — the
 * "engineer" side of the branch-length comparison. A segment is selected when
 * its system matches a sanitary prefix, it is not a vertical run, and its
 * centreline Z-range touches the storey's slab band `[bottomM, topM)` (a
 * horizontal pipe at exactly the band bottom belongs to that storey). Segments
 * with no resolved centreline cannot be placed by Z, so they fall back to
 * their IFC storey containment and are counted separately for honesty.
 * A null band selects the whole model (no storey filter).
 *
 * Note the convention this inherits from V1's storey scope: drainage serving
 * a storey's fixtures usually hangs under that storey's slab, i.e. inside the
 * band of the storey BELOW. The band is applied literally so both sides of
 * the comparison use the same scope; interpret the ratio accordingly.
 */
export function selectEngineerBranchSegments(
  network: Pick<EngineerPipeNetwork, 'segments' | 'metersPerSourceUnit'>,
  band: StoreySlabBandM | null,
  options: SelectEngineerBranchSegmentsOptions = {},
): EngineerBranchSelection {
  const prefixes = options.systemPrefixes ?? ENGINEER_SANITARY_SYSTEM_PREFIXES
  const verticalToleranceDeg = options.verticalToleranceDeg ?? ENGINEER_RISER_VERTICAL_TOLERANCE_DEG
  const segments: EngineerPipeSegment[] = []
  let byGeometryCount = 0
  let byContainmentCount = 0
  for (const segment of network.segments) {
    if (!matchesAnyPrefix(segment.systemName, prefixes)) continue
    if (isVerticalEngineerSegment(segment, verticalToleranceDeg)) continue
    if (band === null) {
      if (segment.start === null || segment.end === null) byContainmentCount += 1
      else byGeometryCount += 1
    } else if (segment.start === null || segment.end === null) {
      if (segment.storeyId !== band.storeyId) continue
      byContainmentCount += 1
    } else {
      const zMinM = Math.min(segment.start.z, segment.end.z) * network.metersPerSourceUnit
      const zMaxM = Math.max(segment.start.z, segment.end.z) * network.metersPerSourceUnit
      if (zMaxM < band.bottomM || zMinM >= band.topM) continue
      byGeometryCount += 1
    }
    segments.push(segment)
  }
  segments.sort((a, b) => a.expressId - b.expressId)
  return { segments, byGeometryCount, byContainmentCount }
}

// ---------------------------------------------------------------------------
// Storey-scoped horizontals for the drawing adapter (G2)
// ---------------------------------------------------------------------------

/**
 * How far below a storey's slab the engineer hangs that storey's drainage.
 * A horizontal run whose Z lies in `[elev(S) − hangDepthM, elev(S))` sits in
 * the ceiling void of the storey below but serves the fixtures of S (the
 * branches drop through the slab from S). Measured on the first project's
 * storey 01: 122 of 134 horizontal SW-GRV segments serving the storey sit
 * 0–0.5 m under the slab; the constant leaves headroom for deeper beams.
 * Approximate and documented; both interpretations are counted separately
 * so the effect is always visible.
 */
export const ENGINEER_HANG_DEPTH_MM = 1200
export const ENGINEER_HANG_DEPTH_M = 1.2

/** Which storey rule placed a horizontal segment on the storey. */
export type EngineerStoreyHorizontalRule = 'in-band' | 'in-hang' | 'both'

export interface EngineerStoreyHorizontal {
  segment: EngineerPipeSegment
  /** Which band(s) the segment's Z-range touches: the storey band, the hang band, or both. */
  rule: EngineerStoreyHorizontalRule
}

export interface EngineerStoreyHorizontalSelection {
  /** Horizontal segments serving the storey, sorted by expressId. */
  horizontals: EngineerStoreyHorizontal[]
  /** Segments whose Z-range touches the storey band `[bottom, top)` (V1 literal scope). */
  inBandCount: number
  /** Segments whose Z-range touches the hang band `[bottom − hangDepthM, bottom)`. */
  inHangCount: number
  /** Segments counted in both (they cross the slab level). */
  bothCount: number
  /** Matching-system, non-vertical segments without a resolved centreline (cannot be drawn). */
  unresolvedCount: number
  hangDepthM: number
}

export interface SelectEngineerStoreyHorizontalsOptions {
  systemPrefixes?: readonly string[]
  verticalToleranceDeg?: number
  /** Overrides {@link ENGINEER_HANG_DEPTH_M}; 0 reproduces the literal band scope. */
  hangDepthM?: number
}

/**
 * The engineer's horizontal runs ON a storey for drawing purposes: matching
 * system prefix, not vertical, resolved centreline, and Z-range touching
 * `[bottom − hangDepthM, top)` — the storey band plus the ceiling void of the
 * storey below where the engineer hangs this storey's drainage. Each segment
 * records which rule admitted it so callers can print both interpretations.
 * Segments without geometry are counted, never drawn.
 */
export function selectEngineerStoreyHorizontals(
  network: Pick<EngineerPipeNetwork, 'segments' | 'metersPerSourceUnit'>,
  band: Pick<StoreySlabBandM, 'bottomM' | 'topM'>,
  options: SelectEngineerStoreyHorizontalsOptions = {},
): EngineerStoreyHorizontalSelection {
  const prefixes = options.systemPrefixes ?? ENGINEER_SANITARY_SYSTEM_PREFIXES
  const verticalToleranceDeg = options.verticalToleranceDeg ?? ENGINEER_RISER_VERTICAL_TOLERANCE_DEG
  const hangDepthM = options.hangDepthM ?? ENGINEER_HANG_DEPTH_M
  const scale = network.metersPerSourceUnit
  const hangBottomM = band.bottomM - hangDepthM

  const horizontals: EngineerStoreyHorizontal[] = []
  let inBandCount = 0
  let inHangCount = 0
  let bothCount = 0
  let unresolvedCount = 0
  for (const segment of network.segments) {
    if (!matchesAnyPrefix(segment.systemName, prefixes)) continue
    if (segment.start === null || segment.end === null) {
      unresolvedCount += 1
      continue
    }
    if (isVerticalEngineerSegment(segment, verticalToleranceDeg)) continue
    const zMinM = Math.min(segment.start.z, segment.end.z) * scale
    const zMaxM = Math.max(segment.start.z, segment.end.z) * scale
    const inBand = !(zMaxM < band.bottomM || zMinM >= band.topM)
    const inHang = hangDepthM > 0 && !(zMaxM < hangBottomM || zMinM >= band.bottomM)
    if (!inBand && !inHang) continue
    if (inBand) inBandCount += 1
    if (inHang) inHangCount += 1
    if (inBand && inHang) bothCount += 1
    horizontals.push({ segment, rule: inBand && inHang ? 'both' : inBand ? 'in-band' : 'in-hang' })
  }
  horizontals.sort((a, b) => a.segment.expressId - b.segment.expressId)
  return { horizontals, inBandCount, inHangCount, bothCount, unresolvedCount, hangDepthM }
}

// ---------------------------------------------------------------------------
// Slope (G2)
// ---------------------------------------------------------------------------

/** Vertical differences below this are data noise, not a slope. */
export const ENGINEER_SLOPE_MIN_DATA_MM = 1
export const ENGINEER_SLOPE_MIN_DATA_M = 0.001

/**
 * A run shorter than this cannot show a drainage slope at the 1 mm data
 * resolution (1 % over 100 mm = 1 mm), so a sub-millimetre fall on it is
 * "unknown" (null). On a longer run the same sub-millimetre fall means the
 * pipe is genuinely flat and 0 % is reported as a measured value.
 */
export const ENGINEER_SLOPE_MIN_RUN_MM = 100
export const ENGINEER_SLOPE_MIN_RUN_M = 0.1

/**
 * Slopes steeper than this are not drainage falls (a 45° offset piece, a
 * short drop) and are reported as outliers instead of being drawn as a slope.
 */
export const ENGINEER_SLOPE_MAX_REPORTED_PERCENT = 10

export type EngineerSlopeSource = 'invert-elevations' | 'endpoint-z'

export type EngineerSlopeResult =
  /** `flat` marks a measured 0 % (fall below 1 mm on a run ≥ {@link ENGINEER_SLOPE_MIN_RUN_M}). */
  | { slopePercent: number; source: EngineerSlopeSource; outlier: false; flat: boolean }
  /** |slope| exceeds {@link ENGINEER_SLOPE_MAX_REPORTED_PERCENT}; `rawPercent` is kept for diagnostics. */
  | { slopePercent: null; source: EngineerSlopeSource; outlier: true; rawPercent: number }
  | { slopePercent: null; source: null; outlier: false; reason: string }

/** Plan-projected (horizontal) length of a segment in metres; null without geometry. */
export function engineerSegmentHorizontalLengthM(
  segment: Pick<EngineerPipeSegment, 'start' | 'end'>,
  metersPerSourceUnit: number,
): number | null {
  if (segment.start === null || segment.end === null) return null
  const dx = (segment.end.x - segment.start.x) * metersPerSourceUnit
  const dy = (segment.end.y - segment.start.y) * metersPerSourceUnit
  return Math.sqrt(dx * dx + dy * dy)
}

function classifySlope(fallM: number, horizontalM: number, source: EngineerSlopeSource): EngineerSlopeResult {
  if (horizontalM < ENGINEER_SLOPE_MIN_DATA_M) {
    return { slopePercent: null, source: null, outlier: false, reason: 'horizontal length below 1 mm' }
  }
  if (Math.abs(fallM) < ENGINEER_SLOPE_MIN_DATA_M) {
    if (horizontalM < ENGINEER_SLOPE_MIN_RUN_M) {
      return { slopePercent: null, source: null, outlier: false, reason: 'run too short to resolve a slope at 1 mm' }
    }
    return { slopePercent: 0, source, outlier: false, flat: true }
  }
  const percent = (fallM / horizontalM) * 100
  if (Math.abs(percent) > ENGINEER_SLOPE_MAX_REPORTED_PERCENT) {
    return { slopePercent: null, source, outlier: true, rawPercent: percent }
  }
  return { slopePercent: percent, source, outlier: false, flat: false }
}

/**
 * Slope in percent from two invert elevations (metres) over a horizontal
 * length (metres): positive when the run falls from the upstream to the
 * downstream invert. Null when either value is missing or below the 1 mm data
 * resolution; outliers (> 10 %) are flagged, not returned as a slope.
 */
export function slopePercentFromInvertElevations(
  upstreamInvertM: number | null,
  downstreamInvertM: number | null,
  horizontalLengthM: number | null,
): EngineerSlopeResult {
  if (upstreamInvertM === null || downstreamInvertM === null) {
    return { slopePercent: null, source: null, outlier: false, reason: 'invert elevation missing at one end' }
  }
  if (horizontalLengthM === null) {
    return { slopePercent: null, source: null, outlier: false, reason: 'horizontal length unknown' }
  }
  return classifySlope(upstreamInvertM - downstreamInvertM, horizontalLengthM, 'invert-elevations')
}

/**
 * Slope of one segment in percent, positive when it falls from `start` to
 * `end` (negative when it rises — the caller may flip the run). Uses the two
 * pset invert elevations when the caller knows both ends' inverts, otherwise
 * the centreline endpoint Z difference over the horizontal length. Note that
 * `Pset_FlowSegmentPipeSegment` carries ONE `InvertElevation` per segment (its
 * lower end), so on a single segment the invert route needs the neighbour's
 * invert at the shared junction; without it, endpoint Z is the honest source.
 */
export function engineerSegmentSlopePercent(
  segment: Pick<EngineerPipeSegment, 'start' | 'end' | 'invertElevationM'>,
  metersPerSourceUnit: number,
  invertsM?: { startM: number | null; endM: number | null },
): EngineerSlopeResult {
  const horizontalM = engineerSegmentHorizontalLengthM(segment, metersPerSourceUnit)
  if (invertsM !== undefined && invertsM.startM !== null && invertsM.endM !== null) {
    return slopePercentFromInvertElevations(invertsM.startM, invertsM.endM, horizontalM)
  }
  if (segment.start === null || segment.end === null || horizontalM === null) {
    return { slopePercent: null, source: null, outlier: false, reason: 'no resolved centreline' }
  }
  const fallM = (segment.start.z - segment.end.z) * metersPerSourceUnit
  return classifySlope(fallM, horizontalM, 'endpoint-z')
}

// ---------------------------------------------------------------------------
// Connectivity and run roles (G2)
// ---------------------------------------------------------------------------

/**
 * Two segments are joined when an endpoint of one lies within this distance
 * of the other (its endpoints or its interior — a tee). Adjacent pipes in
 * Revit exports meet through fittings that are not pipe segments, so this
 * strict tolerance only catches direct joints; see the fitting-bridged
 * tolerance below.
 */
export const ENGINEER_JUNCTION_TOLERANCE_MM = 50
export const ENGINEER_JUNCTION_TOLERANCE_M = 0.05

/**
 * Tolerance that bridges one fitting body between two segments (a Ø110–160
 * tee/wye/bend is ≈ 150 mm end to end). Approximate and reported ALONGSIDE the
 * strict tolerance, never used for the drawn role: measured on the first
 * project's storey 01, 300 mm already marks 71 of 125 runs as collectors
 * (parallel Ø50 branches start touching each other), so wider bridging is noise.
 */
export const ENGINEER_FITTING_BRIDGE_TOLERANCE_MM = 150
export const ENGINEER_FITTING_BRIDGE_TOLERANCE_M = 0.15

export type EngineerRunRole = 'branch' | 'collector'

export interface EngineerJunction {
  /** Segment that joins `intoExpressId`. */
  fromExpressId: number
  /** Segment being joined (at an endpoint or along its interior). */
  intoExpressId: number
  /** Distance (m) from the joining endpoint to the joined segment's centreline. */
  distanceM: number
  /**
   * True when the joining endpoint is the joining segment's LOWER end (or the
   * segment is flat within 1 mm), i.e. the joining segment drains INTO the
   * joined one. Only upstream joins make a run a collector.
   */
  upstream: boolean
  /**
   * True when the join is end-to-end and the two runs are collinear (within
   * {@link ENGINEER_CONTINUATION_ANGLE_DEG}): one straight run split into
   * pieces. Continuations never count towards the collector rule.
   */
  continuation: boolean
}

/** Runs meeting end-to-end within this angle are one continued run, not a branch join. */
export const ENGINEER_CONTINUATION_ANGLE_DEG = 5

export interface EngineerRunRoles {
  roles: Map<number, EngineerRunRole>
  junctions: EngineerJunction[]
  collectorCount: number
  toleranceM: number
}

function pointToSegmentDistance(
  p: EngineerPoint3,
  a: EngineerPoint3,
  b: EngineerPoint3,
): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const lengthSq = abx * abx + aby * aby + abz * abz
  let t = 0
  if (lengthSq > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lengthSq
    t = Math.max(0, Math.min(1, t))
  }
  const cx = a.x + abx * t - p.x
  const cy = a.y + aby * t - p.y
  const cz = a.z + abz * t - p.z
  return Math.sqrt(cx * cx + cy * cy + cz * cz)
}

function distance3(a: EngineerPoint3, b: EngineerPoint3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

/** Angle in degrees between two segments' direction vectors, folded to [0, 90]. */
function segmentAngleDeg(a: Pick<EngineerPipeSegment, 'start' | 'end'>, b: Pick<EngineerPipeSegment, 'start' | 'end'>): number {
  const ax = a.end!.x - a.start!.x
  const ay = a.end!.y - a.start!.y
  const az = a.end!.z - a.start!.z
  const bx = b.end!.x - b.start!.x
  const by = b.end!.y - b.start!.y
  const bz = b.end!.z - b.start!.z
  const la = Math.sqrt(ax * ax + ay * ay + az * az)
  const lb = Math.sqrt(bx * bx + by * by + bz * bz)
  if (la === 0 || lb === 0) return 90
  const cos = Math.min(1, Math.abs(ax * bx + ay * by + az * bz) / (la * lb))
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * Classifies horizontal runs as `collector` (≥ 2 distinct upstream segments
 * drain into it, at its ends or along its interior) or `branch`, from
 * endpoint coincidence within `toleranceM` (metres; segment coordinates are
 * converted with `metersPerSourceUnit`). An end-to-end collinear join is a
 * continuation (one straight run split into pieces) and is excluded from the
 * upstream count. Deterministic: junctions are sorted by (into, from).
 */
export function classifyEngineerRunRoles(
  segments: readonly EngineerPipeSegment[],
  metersPerSourceUnit: number,
  toleranceM: number = ENGINEER_JUNCTION_TOLERANCE_M,
): EngineerRunRoles {
  const resolved = segments
    .filter((segment) => segment.start !== null && segment.end !== null)
    .sort((a, b) => a.expressId - b.expressId)
  const toleranceSource = toleranceM / metersPerSourceUnit
  const flatSource = ENGINEER_SLOPE_MIN_DATA_M / metersPerSourceUnit

  const junctions: EngineerJunction[] = []
  const upstreamJoins = new Map<number, Set<number>>()
  for (const from of resolved) {
    const start = from.start!
    const end = from.end!
    const dz = end.z - start.z
    const flat = Math.abs(dz) < flatSource
    const lowerEnd: 'start' | 'end' | 'both' = flat ? 'both' : dz < 0 ? 'end' : 'start'
    for (const into of resolved) {
      if (into.expressId === from.expressId) continue
      let best: { distanceSource: number; which: 'start' | 'end' } | null = null
      for (const which of ['start', 'end'] as const) {
        const distanceSource = pointToSegmentDistance(which === 'start' ? start : end, into.start!, into.end!)
        if (distanceSource <= toleranceSource && (best === null || distanceSource < best.distanceSource)) {
          best = { distanceSource, which }
        }
      }
      if (best === null) continue
      const upstream = lowerEnd === 'both' || lowerEnd === best.which
      const joiningPoint = best.which === 'start' ? start : end
      const endToEnd =
        distance3(joiningPoint, into.start!) <= toleranceSource || distance3(joiningPoint, into.end!) <= toleranceSource
      const continuation = endToEnd && segmentAngleDeg(from, into) <= ENGINEER_CONTINUATION_ANGLE_DEG
      junctions.push({
        fromExpressId: from.expressId,
        intoExpressId: into.expressId,
        distanceM: best.distanceSource * metersPerSourceUnit,
        upstream,
        continuation,
      })
      if (upstream && !continuation) {
        const set = upstreamJoins.get(into.expressId) ?? new Set<number>()
        set.add(from.expressId)
        upstreamJoins.set(into.expressId, set)
      }
    }
  }
  junctions.sort((a, b) => a.intoExpressId - b.intoExpressId || a.fromExpressId - b.fromExpressId)

  const roles = new Map<number, EngineerRunRole>()
  let collectorCount = 0
  for (const segment of resolved) {
    const upstreamCount = upstreamJoins.get(segment.expressId)?.size ?? 0
    const role: EngineerRunRole = upstreamCount >= 2 ? 'collector' : 'branch'
    if (role === 'collector') collectorCount += 1
    roles.set(segment.expressId, role)
  }
  return { roles, junctions, collectorCount, toleranceM }
}

function compareStacks(a: UnidentifiedStack, b: UnidentifiedStack): number {
  if (a.xM !== b.xM) return a.xM - b.xM
  if (a.yM !== b.yM) return a.yM - b.yM
  if (a.zMinM !== b.zMinM) return a.zMinM - b.zMinM
  return a.segmentExpressIds[0] - b.segmentExpressIds[0]
}

/**
 * Groups the riser-eligible vertical segments of one system class into
 * vertical runs: single-linkage XY clustering of plan midpoints within
 * `xyGroupingToleranceM`, then chaining of member Z-ranges within each XY
 * group (ranges that overlap or are ≤ `chainGapM` apart form one run).
 * Returns every run regardless of extent, sorted by (xM, yM, zMinM).
 */
function groupVerticalRuns(
  network: EngineerPipeNetwork,
  systemClass: EngineerRiserSystemClass,
  params: {
    systemPrefixes: readonly string[]
    minDiameterMm: number
    verticalToleranceDeg: number
    xyGroupingToleranceM: number
    chainGapM: number
    storeyOverlapMinM: number
  },
): UnidentifiedStack[] {
  // Small epsilon so converted diameters like 109.99999999999999 mm still qualify.
  const diameterEpsilonMm = 1e-6
  const scale = network.metersPerSourceUnit

  const candidates: RiserCandidate[] = network.segments
    .filter(
      (segment) =>
        matchesAnyPrefix(segment.systemName, params.systemPrefixes) &&
        segment.outerDiameterMm !== null &&
        segment.outerDiameterMm >= params.minDiameterMm - diameterEpsilonMm &&
        isVerticalEngineerSegment(segment, params.verticalToleranceDeg),
    )
    .map((segment) => ({
      segment,
      xM: ((segment.start!.x + segment.end!.x) / 2) * scale,
      yM: ((segment.start!.y + segment.end!.y) / 2) * scale,
      zMinM: Math.min(segment.start!.z, segment.end!.z) * scale,
      zMaxM: Math.max(segment.start!.z, segment.end!.z) * scale,
    }))
    .sort((a, b) => a.segment.expressId - b.segment.expressId)

  // Single-linkage clustering via union-find over pairs within tolerance.
  const parent = candidates.map((_, index) => index)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
  }

  const toleranceSq = params.xyGroupingToleranceM * params.xyGroupingToleranceM
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const dx = candidates[i].xM - candidates[j].xM
      const dy = candidates[i].yM - candidates[j].yM
      if (dx * dx + dy * dy <= toleranceSq) union(i, j)
    }
  }

  const clusters = new Map<number, RiserCandidate[]>()
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i)
    const members = clusters.get(root) ?? []
    members.push(candidates[i])
    clusters.set(root, members)
  }

  // Chain each XY group's Z-ranges: sort by zMin, merge overlapping/near ranges.
  const runs: RiserCandidate[][] = []
  for (const members of clusters.values()) {
    const byZ = [...members].sort(
      (a, b) => a.zMinM - b.zMinM || a.zMaxM - b.zMaxM || a.segment.expressId - b.segment.expressId,
    )
    let current: RiserCandidate[] = []
    let currentTop = -Infinity
    for (const member of byZ) {
      if (current.length > 0 && member.zMinM - currentTop > params.chainGapM) {
        runs.push(current)
        current = []
        currentTop = -Infinity
      }
      current.push(member)
      currentTop = Math.max(currentTop, member.zMaxM)
    }
    if (current.length > 0) runs.push(current)
  }

  const storeyById = new Map(network.storeys.map((storey) => [storey.id, storey]))
  const storeysByElevation = [...network.storeys].sort(
    (a, b) => a.elevationSource - b.elevationSource || a.id - b.id,
  )

  const stacks: UnidentifiedStack[] = runs.map((members) => {
    const xM = members.reduce((sum, member) => sum + member.xM, 0) / members.length
    const yM = members.reduce((sum, member) => sum + member.yM, 0) / members.length
    const zMinM = Math.min(...members.map((member) => member.zMinM))
    const zMaxM = Math.max(...members.map((member) => member.zMaxM))

    const storeyEntries = new Map<StoreyId, string | null>()
    for (const member of members) {
      if (member.segment.storeyId !== null && !storeyEntries.has(member.segment.storeyId)) {
        storeyEntries.set(member.segment.storeyId, member.segment.storeyName)
      }
    }
    const storeys = [...storeyEntries.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => {
        const elevationA = storeyById.get(a.id)?.elevationSource
        const elevationB = storeyById.get(b.id)?.elevationSource
        if (elevationA !== undefined && elevationB !== undefined && elevationA !== elevationB) {
          return elevationA - elevationB
        }
        if (elevationA === undefined && elevationB !== undefined) return 1
        if (elevationA !== undefined && elevationB === undefined) return -1
        return a.id - b.id
      })

    const spannedStoreyIds = storeysByElevation
      .filter((storey) => {
        const band = storeySlabBandM(network, storey.id)
        return band !== null && stackIntersectsBand({ zMinM, zMaxM }, band, params.storeyOverlapMinM)
      })
      .map((storey) => storey.id)

    const diameterMm = Math.max(...members.map((member) => member.segment.outerDiameterMm!))
    const segmentExpressIds = members
      .map((member) => member.segment.expressId)
      .sort((a, b) => a - b)

    return {
      systemClass,
      xM,
      yM,
      zMinM,
      zMaxM,
      extentM: zMaxM - zMinM,
      storeys,
      spannedStoreyIds,
      diameterMm,
      segmentExpressIds,
    }
  })

  return stacks.sort(compareStacks)
}

/**
 * Classifies the network's vertical riser-eligible runs into sanitary stacks,
 * vent stacks, and stubs.
 *
 * Definition: an engineer riser stack is one vertical run (XY group within
 * `ENGINEER_RISER_XY_GROUPING_TOLERANCE_M`, Z-chained within
 * `ENGINEER_RISER_CHAIN_GAP_M`) of vertical segments with diameter ≥
 * `ENGINEER_RISER_MIN_DIAMETER_MM` whose total vertical extent is at least one
 * storey pitch. The pitch is the median positive consecutive storey elevation
 * difference of the network's storey list; when that is not derivable the
 * `ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M` constant applies. Sanitary
 * (`SW-GRV`) and vent (`VNT`) runs are grouped independently and never mixed.
 * Runs below the threshold are stubs of their class.
 *
 * Deterministic: identical input yields identical IDs, positions and order.
 */
export function classifyEngineerRiserStacks(
  network: EngineerPipeNetwork,
  options: ClassifyEngineerRiserOptions = {},
): EngineerRiserClassification {
  const params = {
    minDiameterMm: options.minDiameterMm ?? ENGINEER_RISER_MIN_DIAMETER_MM,
    verticalToleranceDeg: options.verticalToleranceDeg ?? ENGINEER_RISER_VERTICAL_TOLERANCE_DEG,
    xyGroupingToleranceM: options.xyGroupingToleranceM ?? ENGINEER_RISER_XY_GROUPING_TOLERANCE_M,
    chainGapM: options.chainGapM ?? ENGINEER_RISER_CHAIN_GAP_M,
    storeyOverlapMinM: options.storeyOverlapMinM ?? ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
  }

  const storeyPitchM = deriveStoreyPitchM(network.storeys, network.metersPerSourceUnit)
  let minStackExtentM: number
  let minStackExtentSource: MinStackExtentSource
  if (options.minStackExtentM !== undefined) {
    minStackExtentM = options.minStackExtentM
    minStackExtentSource = 'option'
  } else if (storeyPitchM !== null) {
    minStackExtentM = storeyPitchM
    minStackExtentSource = 'storey-pitch-median'
  } else {
    minStackExtentM = ENGINEER_RISER_MIN_STACK_EXTENT_FALLBACK_M
    minStackExtentSource = 'fallback-constant'
  }
  const qualifies = (run: UnidentifiedStack): boolean =>
    run.extentM >= minStackExtentM - ENGINEER_RISER_EXTENT_EPSILON_M

  const sanitaryRuns = groupVerticalRuns(network, 'sanitary', {
    ...params,
    systemPrefixes: options.sanitarySystemPrefixes ?? ENGINEER_SANITARY_SYSTEM_PREFIXES,
  })
  const ventRuns = groupVerticalRuns(network, 'vent', {
    ...params,
    systemPrefixes: options.ventSystemPrefixes ?? ENGINEER_VENT_SYSTEM_PREFIXES,
  })

  const withIds = (runs: UnidentifiedStack[], prefix: string): EngineerRiserStack[] =>
    runs.map((run, index) => ({ id: `${prefix}-${index + 1}`, ...run }))

  return {
    sanitaryStacks: withIds(sanitaryRuns.filter(qualifies), 'engineer-riser'),
    ventStacks: withIds(ventRuns.filter(qualifies), 'engineer-vent'),
    stubs: withIds(
      [...sanitaryRuns, ...ventRuns].filter((run) => !qualifies(run)).sort(compareStacks),
      'engineer-stub',
    ),
    minStackExtentM,
    minStackExtentSource,
    storeyPitchM,
  }
}
