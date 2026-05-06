import type { KitchenArea, PlanBounds, Storey, StoreyId } from '@/domain/types'

export interface DetectedWetArea {
  areaId: string
  storeyId: StoreyId
  planBounds: PlanBounds
}

export interface VerticalGroupingOptions {
  minOverlapRatio?: number
  maxCentroidDistanceMeters?: number
}

export interface VerticalWetGroupMember {
  areaId: string
  storeyId: StoreyId
  planBounds: PlanBounds
  overlapRatio: number
  centroidDistanceMeters: number
  eligibleForNewRisers: boolean
  debug: {
    confidence: number
    reasons: string[]
  }
}

export interface VerticalWetGroup {
  groupId: string
  members: VerticalWetGroupMember[]
  debug: {
    confidence: number
    reasons: string[]
  }
}

export type StoreyEligibilityById = Map<StoreyId, boolean>
export type StoreyEligibilitySummary = Pick<Storey, 'id'> & { eligibleForNewRisers: boolean }

const DEFAULT_OPTIONS: Required<VerticalGroupingOptions> = {
  // V0 default: require at least 45% overlap against the smaller plan footprint.
  minOverlapRatio: 0.45,
  // V0 default: allow up to 1.8m centroid drift before rejecting vertical pairing.
  maxCentroidDistanceMeters: 1.8,
}

/**
 * BIM-9 V0 uses base-anchored greedy matching:
 * each non-visited wet area becomes a base anchor, then picks at most one strongest
 * candidate per storey against that base area only (not accumulated group bounds).
 */

export function groupWetAreasVertically(
  wetAreas: DetectedWetArea[],
  storeys: Storey[],
  eligibilityByStoreyId: StoreyEligibilityById,
  options?: VerticalGroupingOptions,
): VerticalWetGroup[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const sortedAreas = [...wetAreas].sort((a, b) => a.areaId.localeCompare(b.areaId))
  const visited = new Set<string>()
  const groups: VerticalWetGroup[] = []

  for (const base of sortedAreas) {
    if (visited.has(base.areaId)) continue

    const candidateByStorey = new Map<StoreyId, VerticalWetGroupMember>()
    candidateByStorey.set(base.storeyId, toBaseMember(base, eligibilityByStoreyId))

    for (const candidate of sortedAreas) {
      if (candidate.areaId === base.areaId || visited.has(candidate.areaId)) continue

      const overlapRatio = computeOverlapRatio(base.planBounds, candidate.planBounds)
      if (overlapRatio < resolved.minOverlapRatio) continue

      const centroidDistanceMeters = computeCentroidDistanceMeters(base.planBounds, candidate.planBounds)
      if (centroidDistanceMeters > resolved.maxCentroidDistanceMeters) continue

      const confidence = computeConfidence(
        overlapRatio,
        centroidDistanceMeters,
        resolved.maxCentroidDistanceMeters,
      )

      const member = toCandidateMember(
        candidate,
        eligibilityByStoreyId,
        overlapRatio,
        centroidDistanceMeters,
        confidence,
      )
      const existing = candidateByStorey.get(candidate.storeyId)
      if (!existing || isStrongerMember(member, existing)) {
        candidateByStorey.set(candidate.storeyId, member)
      }
    }

    const members = Array.from(candidateByStorey.values()).sort((a, b) => compareByElevation(a.storeyId, b.storeyId, storeys))
    const groupId = buildGroupId(members)
    // Losing same-storey candidates are intentionally not visited here; they may later
    // anchor their own single-member group. Downstream strategy must handle overlaps.
    members.forEach((member) => visited.add(member.areaId))

    const nonBase = members.filter((member) => member.areaId !== base.areaId)
    const groupConfidence = nonBase.length === 0
      ? 1
      : nonBase.reduce((acc, member) => acc + member.debug.confidence, 0) / nonBase.length

    groups.push({
      groupId,
      members,
      debug: {
        confidence: Number(groupConfidence.toFixed(6)),
        reasons: buildGroupReasons(members),
      },
    })
  }

  return groups
}

function toBaseMember(area: DetectedWetArea, eligibilityByStoreyId: StoreyEligibilityById): VerticalWetGroupMember {
  return {
    areaId: area.areaId,
    storeyId: area.storeyId,
    planBounds: area.planBounds,
    overlapRatio: 1,
    centroidDistanceMeters: 0,
    eligibleForNewRisers: eligibilityByStoreyId.get(area.storeyId) ?? false,
    debug: {
      confidence: 1,
      reasons: ['base wet-area anchor'],
    },
  }
}

function toCandidateMember(
  area: DetectedWetArea,
  eligibilityByStoreyId: StoreyEligibilityById,
  overlapRatio: number,
  centroidDistanceMeters: number,
  confidence: number,
): VerticalWetGroupMember {
  return {
    areaId: area.areaId,
    storeyId: area.storeyId,
    planBounds: area.planBounds,
    overlapRatio,
    centroidDistanceMeters,
    debug: {
      confidence,
      reasons: [
        `plan overlap ${overlapRatio.toFixed(3)} >= threshold`,
        `centroid distance ${centroidDistanceMeters.toFixed(3)}m within tolerance`,
      ],
    },
    eligibleForNewRisers: eligibilityByStoreyId.get(area.storeyId) ?? false,
  }
}

function compareByElevation(a: StoreyId, b: StoreyId, storeys: Storey[]): number {
  const storeyA = storeys.find((storey) => storey.id === a)
  const storeyB = storeys.find((storey) => storey.id === b)
  // Missing storey metadata is invalid/rare; numeric id fallback keeps ordering deterministic.
  if (!storeyA || !storeyB) return a - b
  if (storeyA.elevation !== storeyB.elevation) return storeyA.elevation - storeyB.elevation
  return storeyA.id - storeyB.id
}

function isStrongerMember(candidate: VerticalWetGroupMember, incumbent: VerticalWetGroupMember): boolean {
  const c = candidate.debug.confidence
  const i = incumbent.debug.confidence
  if (c !== i) return c > i
  if (candidate.overlapRatio !== incumbent.overlapRatio) return candidate.overlapRatio > incumbent.overlapRatio
  if (candidate.centroidDistanceMeters !== incumbent.centroidDistanceMeters) {
    return candidate.centroidDistanceMeters < incumbent.centroidDistanceMeters
  }
  return candidate.areaId.localeCompare(incumbent.areaId) < 0
}

function buildGroupId(members: VerticalWetGroupMember[]): string {
  const signature = [...members]
    .sort((a, b) => {
      if (a.storeyId !== b.storeyId) return a.storeyId - b.storeyId
      return a.areaId.localeCompare(b.areaId)
    })
    .map((member) => `${member.storeyId}:${member.areaId}`)
    .join('|')
  return `vertical-wet-group:${signature}`
}

function buildGroupReasons(members: VerticalWetGroupMember[]): string[] {
  const eligibleCount = members.filter((member) => member.eligibleForNewRisers).length
  return [
    `grouped ${members.length} wet areas by overlap/centroid thresholds`,
    `${eligibleCount}/${members.length} members are eligible for new risers`,
  ]
}

function computeOverlapRatio(a: PlanBounds, b: PlanBounds): number {
  // V0 intentionally measures coverage against the smaller area, not IoU.
  const overlapWidth = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const overlapHeight = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ))
  const overlapArea = overlapWidth * overlapHeight
  if (overlapArea <= 0) return 0
  const areaA = Math.max(0, (a.maxX - a.minX) * (a.maxZ - a.minZ))
  const areaB = Math.max(0, (b.maxX - b.minX) * (b.maxZ - b.minZ))
  const baselineArea = Math.min(areaA, areaB)
  if (baselineArea <= 0) return 0
  return overlapArea / baselineArea
}

function computeCentroidDistanceMeters(a: PlanBounds, b: PlanBounds): number {
  const centroidAX = (a.minX + a.maxX) / 2
  const centroidAZ = (a.minZ + a.maxZ) / 2
  const centroidBX = (b.minX + b.maxX) / 2
  const centroidBZ = (b.minZ + b.maxZ) / 2
  const dx = centroidAX - centroidBX
  const dz = centroidAZ - centroidBZ
  return Math.sqrt(dx * dx + dz * dz)
}

function computeConfidence(overlapRatio: number, centroidDistanceMeters: number, maxDistanceMeters: number): number {
  const overlapScore = Math.max(0, Math.min(1, overlapRatio))
  const distanceScore = Math.max(0, Math.min(1, 1 - centroidDistanceMeters / maxDistanceMeters))
  return Number((0.7 * overlapScore + 0.3 * distanceScore).toFixed(6))
}

export function buildStoreyEligibilityById(
  floors: ReadonlyArray<StoreyEligibilitySummary>,
): StoreyEligibilityById {
  return new Map(floors.map((floor) => [floor.id, floor.eligibleForNewRisers]))
}

export function detectedWetAreaFromKitchenArea(kitchen: KitchenArea): DetectedWetArea | null {
  if (!kitchen.planBounds) return null
  return {
    areaId: `kitchen:${kitchen.expressId}`,
    storeyId: kitchen.storeyId,
    planBounds: kitchen.planBounds,
  }
}
