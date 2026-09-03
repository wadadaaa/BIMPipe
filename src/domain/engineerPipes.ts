/**
 * Engineer plumbing baseline: types for the pipe network extracted from an
 * engineer-authored plumbing IFC, plus pure grouping of vertical pipe segments
 * into riser stacks.
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

export type EngineerEndpointSource = 'extrusion-axis' | 'mesh-bounds'

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

/** System name prefixes whose vertical runs count as engineer risers. */
export const ENGINEER_RISER_SYSTEM_PREFIXES: readonly string[] = ['SW-GRV', 'VNT']

/** Minimum outer diameter for a vertical run to count as a riser. */
export const ENGINEER_RISER_MIN_DIAMETER_MM = 110

/**
 * A segment is vertical when its axis is within this angle of the source
 * Z-axis (IFC models are Z-up).
 */
export const ENGINEER_RISER_VERTICAL_TOLERANCE_DEG = 5

/**
 * Vertical segments whose plan (XY) midpoints are within this distance are
 * grouped into the same riser stack. mm/m constant pair per repo convention.
 */
export const ENGINEER_RISER_XY_GROUPING_TOLERANCE_MM = 250
export const ENGINEER_RISER_XY_GROUPING_TOLERANCE_M = 0.25

export interface EngineerRiserStack {
  /** Deterministic ID: `engineer-riser-<n>` after sorting stacks by (xM, yM). */
  id: string
  /** Mean plan X of member segment midpoints, in metres (source frame). */
  xM: number
  /** Mean plan Y of member segment midpoints, in metres (source frame). */
  yM: number
  /** Distinct storeys the stack spans, sorted by elevation ascending. */
  storeys: Array<{ id: StoreyId; name: string | null }>
  /** Largest member outer diameter in millimetres. */
  diameterMm: number
  /** Member segment express IDs, sorted ascending. */
  segmentExpressIds: number[]
}

export interface GroupEngineerRiserOptions {
  systemPrefixes?: readonly string[]
  minDiameterMm?: number
  verticalToleranceDeg?: number
  xyGroupingToleranceM?: number
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
}

/**
 * Groups the network's riser-eligible vertical segments (system prefix in
 * `systemPrefixes`, diameter >= `minDiameterMm`, axis within
 * `verticalToleranceDeg` of vertical) into riser stacks by XY proximity of
 * their plan midpoints (single-linkage within `xyGroupingToleranceM`).
 *
 * Deterministic: same network input yields identical stack IDs, positions,
 * and ordering. Stacks are sorted by (xM, yM, smallest member expressId).
 */
export function groupEngineerRiserStacks(
  network: EngineerPipeNetwork,
  options: GroupEngineerRiserOptions = {},
): EngineerRiserStack[] {
  const systemPrefixes = options.systemPrefixes ?? ENGINEER_RISER_SYSTEM_PREFIXES
  const minDiameterMm = options.minDiameterMm ?? ENGINEER_RISER_MIN_DIAMETER_MM
  const verticalToleranceDeg = options.verticalToleranceDeg ?? ENGINEER_RISER_VERTICAL_TOLERANCE_DEG
  const toleranceM = options.xyGroupingToleranceM ?? ENGINEER_RISER_XY_GROUPING_TOLERANCE_M
  // Small epsilon so converted diameters like 109.99999999999999 mm still qualify.
  const diameterEpsilonMm = 1e-6

  const candidates: RiserCandidate[] = network.segments
    .filter(
      (segment) =>
        matchesAnyPrefix(segment.systemName, systemPrefixes) &&
        segment.outerDiameterMm !== null &&
        segment.outerDiameterMm >= minDiameterMm - diameterEpsilonMm &&
        isVerticalEngineerSegment(segment, verticalToleranceDeg),
    )
    .map((segment) => ({
      segment,
      xM: ((segment.start!.x + segment.end!.x) / 2) * network.metersPerSourceUnit,
      yM: ((segment.start!.y + segment.end!.y) / 2) * network.metersPerSourceUnit,
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

  const toleranceSq = toleranceM * toleranceM
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

  const storeyById = new Map(network.storeys.map((storey) => [storey.id, storey]))

  const stacks = [...clusters.values()].map((members) => {
    const xM = members.reduce((sum, member) => sum + member.xM, 0) / members.length
    const yM = members.reduce((sum, member) => sum + member.yM, 0) / members.length

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

    const diameterMm = Math.max(...members.map((member) => member.segment.outerDiameterMm!))
    const segmentExpressIds = members
      .map((member) => member.segment.expressId)
      .sort((a, b) => a - b)

    return { xM, yM, storeys, diameterMm, segmentExpressIds }
  })

  stacks.sort((a, b) => {
    if (a.xM !== b.xM) return a.xM - b.xM
    if (a.yM !== b.yM) return a.yM - b.yM
    return a.segmentExpressIds[0] - b.segmentExpressIds[0]
  })

  return stacks.map((stack, index) => ({ id: `engineer-riser-${index + 1}`, ...stack }))
}
