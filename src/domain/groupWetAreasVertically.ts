import type { PlanBounds, Storey, StoreyId } from '@/domain/types'

export interface DetectedWetArea {
  areaId: string
  storeyId: StoreyId
  planBounds: PlanBounds
}

export interface VerticalGroupingOptions {
  minOverlapRatio?: number
  maxCentroidDistanceMm?: number
  minConfidenceToGroup?: number
}

export interface VerticalWetGroupMember {
  areaId: string
  storeyId: StoreyId
  planBounds: PlanBounds
  overlapRatio: number
  centroidDistanceMm: number
  reasons: string[]
  eligibleForNewRisers: boolean
  debug?: {
    confidence: number
  }
}

export interface VerticalWetGroup {
  groupId: string
  members: VerticalWetGroupMember[]
  reasons: string[]
  debug?: {
    confidence: number
  }
}

export type StoreyEligibilityById = Map<StoreyId, boolean>

const DEFAULT_OPTIONS: Required<VerticalGroupingOptions> = {
  minOverlapRatio: 0.45,
  maxCentroidDistanceMm: 1800,
  minConfidenceToGroup: 0.5,
}

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

      const centroidDistanceMm = computeCentroidDistanceMm(base.planBounds, candidate.planBounds)
      if (centroidDistanceMm > resolved.maxCentroidDistanceMm) continue

      const confidence = computeConfidence(overlapRatio, centroidDistanceMm, resolved.maxCentroidDistanceMm)
      if (confidence < resolved.minConfidenceToGroup) continue

      const member = toCandidateMember(candidate, eligibilityByStoreyId, overlapRatio, centroidDistanceMm, confidence)
      const existing = candidateByStorey.get(candidate.storeyId)
      if (!existing || isStrongerMember(member, existing)) {
        candidateByStorey.set(candidate.storeyId, member)
      }
    }

    const members = Array.from(candidateByStorey.values()).sort((a, b) => compareByElevation(a.storeyId, b.storeyId, storeys))
    const groupId = buildGroupId(members)
    members.forEach((member) => visited.add(member.areaId))

    const nonBase = members.filter((member) => member.areaId !== base.areaId)
    const groupConfidence = nonBase.length === 0
      ? 1
      : nonBase.reduce((acc, member) => acc + (member.debug?.confidence ?? 0), 0) / nonBase.length

    groups.push({
      groupId,
      members,
      reasons: buildGroupReasons(members),
      debug: { confidence: Number(groupConfidence.toFixed(6)) },
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
    centroidDistanceMm: 0,
    reasons: ['base wet-area anchor'],
    eligibleForNewRisers: eligibilityByStoreyId.get(area.storeyId) ?? false,
    debug: { confidence: 1 },
  }
}

function toCandidateMember(
  area: DetectedWetArea,
  eligibilityByStoreyId: StoreyEligibilityById,
  overlapRatio: number,
  centroidDistanceMm: number,
  confidence: number,
): VerticalWetGroupMember {
  return {
    areaId: area.areaId,
    storeyId: area.storeyId,
    planBounds: area.planBounds,
    overlapRatio,
    centroidDistanceMm,
    reasons: [
      `plan overlap ${overlapRatio.toFixed(3)} >= threshold`,
      `centroid distance ${centroidDistanceMm.toFixed(1)}mm within tolerance`,
    ],
    eligibleForNewRisers: eligibilityByStoreyId.get(area.storeyId) ?? false,
    debug: { confidence },
  }
}

function compareByElevation(a: StoreyId, b: StoreyId, storeys: Storey[]): number {
  const storeyA = storeys.find((storey) => storey.id === a)
  const storeyB = storeys.find((storey) => storey.id === b)
  if (!storeyA || !storeyB) return a - b
  if (storeyA.elevation !== storeyB.elevation) return storeyA.elevation - storeyB.elevation
  return storeyA.id - storeyB.id
}

function isStrongerMember(candidate: VerticalWetGroupMember, incumbent: VerticalWetGroupMember): boolean {
  const c = candidate.debug?.confidence ?? 0
  const i = incumbent.debug?.confidence ?? 0
  if (c !== i) return c > i
  if (candidate.overlapRatio !== incumbent.overlapRatio) return candidate.overlapRatio > incumbent.overlapRatio
  if (candidate.centroidDistanceMm !== incumbent.centroidDistanceMm) return candidate.centroidDistanceMm < incumbent.centroidDistanceMm
  return candidate.areaId.localeCompare(incumbent.areaId) < 0
}

function buildGroupId(members: VerticalWetGroupMember[]): string {
  const signature = members.map((member) => `${member.storeyId}:${member.areaId}`).sort().join('|')
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

function computeCentroidDistanceMm(a: PlanBounds, b: PlanBounds): number {
  const centroidAX = (a.minX + a.maxX) / 2
  const centroidAZ = (a.minZ + a.maxZ) / 2
  const centroidBX = (b.minX + b.maxX) / 2
  const centroidBZ = (b.minZ + b.maxZ) / 2
  const dx = centroidAX - centroidBX
  const dz = centroidAZ - centroidBZ
  return Math.sqrt(dx * dx + dz * dz) * 1000
}

function computeConfidence(overlapRatio: number, centroidDistanceMm: number, maxDistanceMm: number): number {
  const overlapScore = Math.max(0, Math.min(1, overlapRatio))
  const distanceScore = Math.max(0, Math.min(1, 1 - centroidDistanceMm / maxDistanceMm))
  return Number((0.7 * overlapScore + 0.3 * distanceScore).toFixed(6))
}
