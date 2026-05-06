import type { PlanBounds, Storey, StoreyId } from '@/domain/types'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'

export interface DetectedWetArea {
  areaId: string
  storeyId: StoreyId
  bounds: PlanBounds
}

export interface VerticalGroupingOptions {
  minOverlapRatio: number
  maxCentroidDistanceMeters: number
  overlapWeight: number
  distanceWeight: number
  storeys?: Storey[]
}

export interface VerticalWetGroupMember {
  areaId: string
  storeyId: StoreyId
  eligibleForNewRisers: boolean
  confidence: number
  reasons: string[]
}

export interface VerticalWetGroup {
  groupId: string
  members: VerticalWetGroupMember[]
  confidence: number
  reasons: string[]
}

interface PairEvidence {
  overlapRatio: number
  centroidDistanceMeters: number
  pairScore: number
}

const DEFAULT_OPTIONS: VerticalGroupingOptions = {
  minOverlapRatio: 0.35,
  maxCentroidDistanceMeters: 2,
  overlapWeight: 0.7,
  distanceWeight: 0.3,
}

export function groupWetAreasVertically(
  areas: DetectedWetArea[],
  aggregation: StoreyDetectionAggregation,
  options: Partial<VerticalGroupingOptions> = {},
): VerticalWetGroup[] {
  const config = { ...DEFAULT_OPTIONS, ...options }
  const floorByStoreyId = new Map(aggregation.floors.map((floor) => [floor.storeyId, floor]))

  const elevationByStoreyId = new Map((config.storeys ?? []).map((storey) => [storey.id, storey.elevation]))

  const sorted = [...areas].sort((a, b) => {
    const elevationA = elevationByStoreyId.get(a.storeyId) ?? Number.POSITIVE_INFINITY
    const elevationB = elevationByStoreyId.get(b.storeyId) ?? Number.POSITIVE_INFINITY
    if (elevationA !== elevationB) return elevationA - elevationB
    return a.areaId.localeCompare(b.areaId)
  })

  const visited = new Set<string>()
  const groups: VerticalWetGroup[] = []

  for (const base of sorted) {
    if (visited.has(base.areaId)) continue

    const perStoreyBest = new Map<StoreyId, { area: DetectedWetArea; evidence: PairEvidence }>()

    for (const candidate of sorted) {
      if (candidate.areaId === base.areaId) continue
      if (candidate.storeyId === base.storeyId) continue
      if (visited.has(candidate.areaId)) continue

      const evidence = compareAreas(base.bounds, candidate.bounds, config)
      if (evidence.overlapRatio < config.minOverlapRatio) continue
      if (evidence.centroidDistanceMeters > config.maxCentroidDistanceMeters) continue

      const prev = perStoreyBest.get(candidate.storeyId)
      if (!prev || isStrongerCandidate(candidate, evidence, prev.area, prev.evidence)) {
        perStoreyBest.set(candidate.storeyId, { area: candidate, evidence })
      }
    }

    const baseMember = buildBaseMember(base, floorByStoreyId)
    const paired = [...perStoreyBest.values()].sort((a, b) => {
      const ea = elevationByStoreyId.get(a.area.storeyId) ?? Number.POSITIVE_INFINITY
      const eb = elevationByStoreyId.get(b.area.storeyId) ?? Number.POSITIVE_INFINITY
      if (ea !== eb) return ea - eb
      return a.area.areaId.localeCompare(b.area.areaId)
    })

    const pairedMembers = paired.map(({ area, evidence }) =>
      buildPairedMember(base, area, evidence, floorByStoreyId),
    )

    const members = [baseMember, ...pairedMembers]
    const memberIds = members.map((member) => `${member.storeyId}:${member.areaId}`).sort()
    const groupId = `vwg:${memberIds.join('|')}`

    const groupConfidence =
      pairedMembers.length === 0
        ? baseMember.confidence
        : pairedMembers.reduce((sum, member) => sum + member.confidence, 0) / pairedMembers.length

    groups.push({
      groupId,
      members,
      confidence: groupConfidence,
      reasons: [
        'Deterministic V0 greedy grouping: first unvisited wet area becomes base anchor for one vertical group.',
      ],
    })

    for (const member of members) {
      visited.add(member.areaId)
    }
  }

  return groups
}

function compareAreas(base: PlanBounds, candidate: PlanBounds, options: VerticalGroupingOptions): PairEvidence {
  const overlapRatio = getMinAreaOverlapRatio(base, candidate)
  const centroidDistanceMeters = getCentroidDistanceMeters(base, candidate)
  const normalizedDistance = Math.max(0, 1 - centroidDistanceMeters / options.maxCentroidDistanceMeters)

  return {
    overlapRatio,
    centroidDistanceMeters,
    // We weight overlap above distance because room footprint agreement is a stronger vertical signal
    // than fixture drift inside the room across floors.
    pairScore: overlapRatio * options.overlapWeight + normalizedDistance * options.distanceWeight,
  }
}

function buildBaseMember(
  area: DetectedWetArea,
  floorByStoreyId: Map<StoreyId, StoreyDetectionAggregation['floors'][number]>,
): VerticalWetGroupMember {
  const floor = floorByStoreyId.get(area.storeyId)
  return {
    areaId: area.areaId,
    storeyId: area.storeyId,
    eligibleForNewRisers: floor?.eligibleForNewRisers ?? false,
    confidence: 1,
    reasons: ['Base anchor wet area for deterministic grouping.'],
  }
}

function buildPairedMember(
  base: DetectedWetArea,
  area: DetectedWetArea,
  evidence: PairEvidence,
  floorByStoreyId: Map<StoreyId, StoreyDetectionAggregation['floors'][number]>,
): VerticalWetGroupMember {
  const floor = floorByStoreyId.get(area.storeyId)
  return {
    areaId: area.areaId,
    storeyId: area.storeyId,
    eligibleForNewRisers: floor?.eligibleForNewRisers ?? false,
    confidence: evidence.pairScore,
    reasons: [
      `Passed overlap gate (${evidence.overlapRatio.toFixed(3)} >= minOverlapRatio).`,
      `Passed centroid-distance gate (${evidence.centroidDistanceMeters.toFixed(3)}m <= maxCentroidDistanceMeters).`,
      `Pair score=${evidence.pairScore.toFixed(3)} used for deterministic ranking/debug, not as a hard gate.`,
      `Paired against base ${base.areaId}.`,
    ],
  }
}

function isStrongerCandidate(
  areaA: DetectedWetArea,
  evidenceA: PairEvidence,
  areaB: DetectedWetArea,
  evidenceB: PairEvidence,
): boolean {
  if (evidenceA.pairScore !== evidenceB.pairScore) return evidenceA.pairScore > evidenceB.pairScore
  if (evidenceA.overlapRatio !== evidenceB.overlapRatio) return evidenceA.overlapRatio > evidenceB.overlapRatio
  if (evidenceA.centroidDistanceMeters !== evidenceB.centroidDistanceMeters) {
    return evidenceA.centroidDistanceMeters < evidenceB.centroidDistanceMeters
  }
  return areaA.areaId.localeCompare(areaB.areaId) < 0
}

function getMinAreaOverlapRatio(a: PlanBounds, b: PlanBounds): number {
  const overlapWidth = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const overlapDepth = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ))
  const overlapArea = overlapWidth * overlapDepth
  const areaA = (a.maxX - a.minX) * (a.maxZ - a.minZ)
  const areaB = (b.maxX - b.minX) * (b.maxZ - b.minZ)
  // Min-area baseline is preferred to IoU so a smaller wet room can still match a larger aligned shaft zone.
  const baseline = Math.min(areaA, areaB)
  return baseline > 0 ? overlapArea / baseline : 0
}

function getCentroidDistanceMeters(a: PlanBounds, b: PlanBounds): number {
  // Domain plan coordinates are x/z in IFC world units (meters), so threshold is expressed in meters too.
  const ax = (a.minX + a.maxX) / 2
  const az = (a.minZ + a.maxZ) / 2
  const bx = (b.minX + b.maxX) / 2
  const bz = (b.minZ + b.maxZ) / 2
  return Math.hypot(ax - bx, az - bz)
}
