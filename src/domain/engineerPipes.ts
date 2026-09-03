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
