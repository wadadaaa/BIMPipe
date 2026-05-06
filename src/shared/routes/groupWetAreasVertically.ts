import type { StoreyId } from '@/domain/types'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'

export interface DetectedWetArea {
  id: string
  storeyId: StoreyId
  centroid: { x: number; z: number }
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  confidence?: number
}

export interface VerticalGroupingOptions {
  minOverlapRatio: number
  maxCentroidDistanceMm: number
  minPairScoreToGroup: number
}

export interface VerticalWetGroupMember {
  areaId: string
  storeyId: StoreyId
  overlapRatio: number
  centroidDistanceMm: number
  confidence: number
  eligibleForNewRisers: boolean
}

export interface VerticalWetGroup {
  groupId: string
  members: VerticalWetGroupMember[]
  confidence: number
  reasons: string[]
}

const DEFAULT_OPTIONS: VerticalGroupingOptions = {
  minOverlapRatio: 0.2,
  maxCentroidDistanceMm: 2000,
  minPairScoreToGroup: 0.35,
}

export function groupWetAreasVertically(
  wetAreas: DetectedWetArea[],
  aggregation: StoreyDetectionAggregation,
  options: Partial<VerticalGroupingOptions> = {},
): VerticalWetGroup[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const sorted = [...wetAreas].sort((a, b) => a.id.localeCompare(b.id))
  const taken = new Set<string>()
  const eligibleByStorey = new Map(aggregation.floors.map((f) => [f.storeyId, f.eligibleForNewRisers]))
  const groups: VerticalWetGroup[] = []
  const storeys = orderedStoreysByElevation(sorted, aggregation)

  for (const base of sorted) {
    if (taken.has(base.id)) continue

    const members: VerticalWetGroupMember[] = [
      toMember(base, 1, 0, base.confidence ?? 1, eligibleByStorey),
    ]

    for (const storeyId of storeys) {
      if (storeyId === base.storeyId) continue

      const candidates = sorted.filter((area) => area.storeyId === storeyId && !taken.has(area.id))
      const best = pickBestCandidate(base, candidates, resolved)
      if (!best) continue

      members.push(
        toMember(
          best.candidate,
          best.overlapRatio,
          best.centroidDistanceMm,
          best.confidence,
          eligibleByStorey,
        ),
      )
    }

    const sortedMembers = [...members].sort((a, b) => a.areaId.localeCompare(b.areaId))
    for (const member of sortedMembers) taken.add(member.areaId)

    groups.push({
      groupId: buildStableGroupId(sortedMembers),
      members: sortedMembers,
      confidence: average(sortedMembers.map((m) => m.confidence)),
      reasons: [
        `overlap >= ${resolved.minOverlapRatio}`,
        `centroidDistance <= ${resolved.maxCentroidDistanceMm}mm`,
        `pairScore >= ${resolved.minPairScoreToGroup}`,
      ],
    })
  }

  return groups.sort((a, b) => a.groupId.localeCompare(b.groupId))
}

function pickBestCandidate(
  base: DetectedWetArea,
  candidates: DetectedWetArea[],
  options: VerticalGroupingOptions,
): ReturnType<typeof scorePair> | null {
  const ranked = candidates
    .map((candidate) => scorePair(base, candidate, options))
    .filter(
      (score) =>
        score.overlapRatio >= options.minOverlapRatio &&
        score.centroidDistanceMm <= options.maxCentroidDistanceMm &&
        score.confidence >= options.minPairScoreToGroup,
    )
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      if (b.overlapRatio !== a.overlapRatio) return b.overlapRatio - a.overlapRatio
      if (a.centroidDistanceMm !== b.centroidDistanceMm) return a.centroidDistanceMm - b.centroidDistanceMm
      return a.candidate.id.localeCompare(b.candidate.id)
    })

  return ranked[0] ?? null
}

function orderedStoreysByElevation(
  areas: DetectedWetArea[],
  aggregation: StoreyDetectionAggregation,
): StoreyId[] {
  const areaStoreys = new Set(areas.map((a) => a.storeyId))
  const floorOrder = new Map(aggregation.floors.map((floor, index) => [floor.storeyId, index]))

  return [...areaStoreys].sort((a, b) => {
    const aOrder = floorOrder.get(a)
    const bOrder = floorOrder.get(b)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a - b
  })
}

function toMember(
  area: DetectedWetArea,
  overlapRatio: number,
  centroidDistanceMm: number,
  confidence: number,
  eligibleByStorey: Map<StoreyId, boolean>,
): VerticalWetGroupMember {
  return {
    areaId: area.id,
    storeyId: area.storeyId,
    overlapRatio,
    centroidDistanceMm,
    confidence,
    eligibleForNewRisers: eligibleByStorey.get(area.storeyId) ?? false,
  }
}

function buildStableGroupId(members: VerticalWetGroupMember[]): string {
  const ids = members.map((m) => `${m.storeyId}:${m.areaId}`).sort((a, b) => a.localeCompare(b))
  return `vwg:${ids.join('|')}`
}

function scorePair(base: DetectedWetArea, candidate: DetectedWetArea, options: VerticalGroupingOptions) {
  const overlapRatio = overlap(base.bounds, candidate.bounds)
  const centroidDistanceMm = Math.hypot(base.centroid.x - candidate.centroid.x, base.centroid.z - candidate.centroid.z)
  const overlapScore = clamp01(overlapRatio / Math.max(options.minOverlapRatio, 0.000_001))
  const distanceScore = clamp01(1 - centroidDistanceMm / Math.max(options.maxCentroidDistanceMm, 0.000_001))
  const intrinsic = candidate.confidence ?? 1
  const confidence = overlapScore * 0.6 + distanceScore * 0.3 + intrinsic * 0.1
  return { candidate, overlapRatio, centroidDistanceMm, confidence }
}

function overlap(a: DetectedWetArea['bounds'], b: DetectedWetArea['bounds']): number {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const iz = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ))
  const intersection = ix * iz
  if (intersection <= 0) return 0

  const areaA = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxZ - a.minZ)
  const areaB = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxZ - b.minZ)
  const union = areaA + areaB - intersection
  return union > 0 ? intersection / union : 0
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
