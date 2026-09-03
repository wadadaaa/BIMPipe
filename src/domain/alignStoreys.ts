import type { StoreyId } from './types'
import { toMeters, type LengthUnit } from '@/shared/lengthUnits'

/**
 * Cross-file storey alignment by ABSOLUTE elevation (W4).
 *
 * Different IFC files of the same project measure storey elevations against
 * different anchors (e.g. the architecture file's building sits 2365 cm above
 * the plumbing file's zero). The comparable quantity is the absolute
 * elevation: raw `IfcBuildingStorey.Elevation` plus the file's IfcBuilding
 * placement world Z, converted to metres via the file's own declared unit.
 *
 * This module is pure: callers resolve units (`resolveModelLengthUnit`) and
 * placements (`readBuildingPlacementSourcePoint`) and pass raw values in.
 */

/** Two storeys are the same physical level when their absolute elevations differ by at most this. */
export const STOREY_ALIGNMENT_TOLERANCE_MM = 150
export const STOREY_ALIGNMENT_TOLERANCE_M = STOREY_ALIGNMENT_TOLERANCE_MM / 1000

/**
 * Building placements are treated as one shared plan origin when their
 * horizontal distance stays within this. Beyond it the mapping still runs,
 * but with an explicit origin-mismatch warning (never a silent misalignment).
 */
export const SHARED_ORIGIN_XY_TOLERANCE_MM = 500
export const SHARED_ORIGIN_XY_TOLERANCE_M = SHARED_ORIGIN_XY_TOLERANCE_MM / 1000

export interface AlignmentStoreyInput {
  id: StoreyId
  name: string
  /** Raw IfcBuildingStorey.Elevation in the file's declared unit. */
  elevation: number
}

export interface AlignmentModelInput {
  fileName: string
  /** Declared length unit; null (undeclared/unsupported) blocks alignment explicitly. */
  lengthUnit: LengthUnit | null
  storeys: AlignmentStoreyInput[]
  /**
   * IfcBuilding placement resolved to WORLD coordinates (site chain included),
   * in the file's declared unit, IFC Z-up. null = missing/unresolvable, which
   * blocks alignment explicitly.
   */
  buildingPlacement: { x: number; y: number; z: number } | null
}

export interface AlignedStoreyEntry {
  storeyId: StoreyId
  storeyName: string
  absoluteElevationM: number
}

export interface AlignedStoreyPair {
  host: AlignedStoreyEntry
  linked: AlignedStoreyEntry
  /** Signed linked-minus-host elevation difference, rounded to 0.1 mm. */
  deltaMm: number
}

export type OriginAgreementStatus = 'shared' | 'mismatch' | 'unknown'

export interface OriginAgreement {
  status: OriginAgreementStatus
  /** Horizontal distance between the two building placements in mm; null when unknown. */
  distanceMm: number | null
  /** Explicit user-facing warning when the placements disagree beyond tolerance. */
  warning: string | null
}

export interface StoreyAlignment {
  hostFileName: string
  linkedFileName: string
  status: 'aligned' | 'blocked'
  /** Why the alignment could not run; null when status is 'aligned'. */
  blockedReason: string | null
  toleranceMm: number
  /** Matched pairs sorted by host absolute elevation, bottom to top. */
  pairs: AlignedStoreyPair[]
  /** Host storeys with no linked counterpart, sorted by absolute elevation. */
  unmappedHost: AlignedStoreyEntry[]
  /** Linked storeys with no host counterpart, sorted by absolute elevation. */
  unmappedLinked: AlignedStoreyEntry[]
  originAgreement: OriginAgreement
}

/**
 * Aligns one linked file's storeys against the host file's storeys.
 *
 * Matching is greedy on the smallest absolute-elevation difference: all
 * within-tolerance candidate pairs are ranked by |delta|, then by host and
 * linked elevation (deterministic for identical input), and each storey is
 * used at most once. Unmatched storeys are reported explicitly on both sides.
 */
export function alignStoreysByElevation(
  host: AlignmentModelInput,
  linked: AlignmentModelInput,
): StoreyAlignment {
  const blockedReason = findBlockedReason(host) ?? findBlockedReason(linked)
  if (blockedReason !== null) {
    return {
      hostFileName: host.fileName,
      linkedFileName: linked.fileName,
      status: 'blocked',
      blockedReason,
      toleranceMm: STOREY_ALIGNMENT_TOLERANCE_MM,
      pairs: [],
      unmappedHost: [],
      unmappedLinked: [],
      originAgreement: { status: 'unknown', distanceMm: null, warning: null },
    }
  }

  const hostEntries = toAbsoluteEntries(host)
  const linkedEntries = toAbsoluteEntries(linked)

  // Rank every within-tolerance candidate pair; ties resolve by elevation so
  // the same inputs always produce the same mapping.
  const candidates: Array<{ hostIndex: number; linkedIndex: number; deltaM: number }> = []
  for (let h = 0; h < hostEntries.length; h++) {
    for (let l = 0; l < linkedEntries.length; l++) {
      const deltaM = linkedEntries[l].absoluteElevationM - hostEntries[h].absoluteElevationM
      // Compare at the same 0.1 mm resolution the deltas are reported in, so
      // float noise cannot flip an exact-boundary match.
      if (Math.abs(roundToTenthMm(deltaM)) <= STOREY_ALIGNMENT_TOLERANCE_MM) {
        candidates.push({ hostIndex: h, linkedIndex: l, deltaM })
      }
    }
  }
  candidates.sort((a, b) => {
    const absDelta = Math.abs(a.deltaM) - Math.abs(b.deltaM)
    if (absDelta !== 0) return absDelta
    const hostElevation =
      hostEntries[a.hostIndex].absoluteElevationM - hostEntries[b.hostIndex].absoluteElevationM
    if (hostElevation !== 0) return hostElevation
    return linkedEntries[a.linkedIndex].absoluteElevationM - linkedEntries[b.linkedIndex].absoluteElevationM
  })

  const usedHost = new Set<number>()
  const usedLinked = new Set<number>()
  const pairs: AlignedStoreyPair[] = []
  for (const candidate of candidates) {
    if (usedHost.has(candidate.hostIndex) || usedLinked.has(candidate.linkedIndex)) continue
    usedHost.add(candidate.hostIndex)
    usedLinked.add(candidate.linkedIndex)
    pairs.push({
      host: hostEntries[candidate.hostIndex],
      linked: linkedEntries[candidate.linkedIndex],
      deltaMm: roundToTenthMm(candidate.deltaM),
    })
  }
  pairs.sort((a, b) => a.host.absoluteElevationM - b.host.absoluteElevationM)

  return {
    hostFileName: host.fileName,
    linkedFileName: linked.fileName,
    status: 'aligned',
    blockedReason: null,
    toleranceMm: STOREY_ALIGNMENT_TOLERANCE_MM,
    pairs,
    unmappedHost: hostEntries.filter((_, index) => !usedHost.has(index)),
    unmappedLinked: linkedEntries.filter((_, index) => !usedLinked.has(index)),
    originAgreement: compareOrigins(host, linked),
  }
}

function findBlockedReason(model: AlignmentModelInput): string | null {
  if (model.lengthUnit === null) {
    return `${model.fileName}: length unit is undeclared or unsupported; storey elevations cannot be compared across files.`
  }
  if (model.buildingPlacement === null) {
    return `${model.fileName}: IfcBuilding placement is missing or unresolvable; absolute storey elevations cannot be computed.`
  }
  return null
}

function toAbsoluteEntries(model: AlignmentModelInput): AlignedStoreyEntry[] {
  const unit = model.lengthUnit as LengthUnit
  const placementZ = model.buildingPlacement?.z ?? 0
  return model.storeys
    .map((storey) => ({
      storeyId: storey.id,
      storeyName: storey.name,
      absoluteElevationM: toMeters(storey.elevation + placementZ, unit),
    }))
    .sort((a, b) => a.absoluteElevationM - b.absoluteElevationM)
}

function compareOrigins(host: AlignmentModelInput, linked: AlignmentModelInput): OriginAgreement {
  const hostPlacement = host.buildingPlacement
  const linkedPlacement = linked.buildingPlacement
  if (hostPlacement === null || linkedPlacement === null) {
    return { status: 'unknown', distanceMm: null, warning: null }
  }

  // IFC placements are Z-up: X/Y are the horizontal plan axes.
  const distanceM = Math.hypot(
    toMeters(linkedPlacement.x, linked.lengthUnit as LengthUnit) -
      toMeters(hostPlacement.x, host.lengthUnit as LengthUnit),
    toMeters(linkedPlacement.y, linked.lengthUnit as LengthUnit) -
      toMeters(hostPlacement.y, host.lengthUnit as LengthUnit),
  )
  const distanceMm = roundToTenthMm(distanceM)

  if (distanceM <= SHARED_ORIGIN_XY_TOLERANCE_M) {
    return { status: 'shared', distanceMm, warning: null }
  }
  return {
    status: 'mismatch',
    distanceMm,
    warning:
      `Building placements of ${host.fileName} and ${linked.fileName} differ by ` +
      `${distanceMm} mm in plan (tolerance ${SHARED_ORIGIN_XY_TOLERANCE_MM} mm). ` +
      'Overlaid geometry from the linked file may be misaligned.',
  }
}

function roundToTenthMm(valueM: number): number {
  return Math.round(valueM * 10_000) / 10
}
