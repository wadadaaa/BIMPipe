import type { StoreyId } from '@/domain/types'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'

export interface DetectedWetArea {
  id: string
  storeyId: StoreyId
  centroid: { x: number; z: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  source: 'toilet_cluster' | 'kitchen_area' | 'mixed'
}

export interface VerticalWetGroupMember {
  storeyId: StoreyId
  wetAreaId: string
  centroid: { x: number; z: number }
  overlapRatio: number
  centroidDistanceMm: number
  eligibleForNewRisers: boolean
}

export interface VerticalWetGroup {
  groupId: string
  members: VerticalWetGroupMember[]
  representativeCentroid: { x: number; z: number }
  confidence: number
  reasons: string[]
  hasEligibleMember: boolean
}

export interface VerticalGroupingOptions {
  minOverlapRatio: number
  maxCentroidDistanceMm: number
  minConfidenceToGroup: number
}

const DEFAULT_OPTIONS: VerticalGroupingOptions = {
  minOverlapRatio: 0.25,
  maxCentroidDistanceMm: 1800,
  minConfidenceToGroup: 0.55,
}

export function groupWetAreasVertically(
  aggregation: StoreyDetectionAggregation,
  wetAreasByStoreyId: Record<StoreyId, DetectedWetArea[]>,
  options: Partial<VerticalGroupingOptions> = {},
): VerticalWetGroup[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const eligibleByStorey = new Map(aggregation.floors.map((floor) => [floor.storeyId, floor.eligibleForNewRisers]))
  const allAreas = Object.values(wetAreasByStoreyId)
    .flat()
    .sort((a, b) => (a.storeyId === b.storeyId ? a.id.localeCompare(b.id) : a.storeyId - b.storeyId))

  const assigned = new Set<string>()
  const groups: VerticalWetGroup[] = []

  for (const baseArea of allAreas) {
    if (assigned.has(baseArea.id)) continue

    const candidateMembers: VerticalWetGroupMember[] = [
      createMember(baseArea, 1, 0, Boolean(eligibleByStorey.get(baseArea.storeyId))),
    ]
    assigned.add(baseArea.id)

    for (const probe of allAreas) {
      if (probe.id === baseArea.id || assigned.has(probe.id) || probe.storeyId === baseArea.storeyId) continue
      const evidence = computeAlignmentEvidence(baseArea, probe, resolved)
      if (evidence.confidence < resolved.minConfidenceToGroup) continue

      candidateMembers.push(
        createMember(probe, evidence.overlapRatio, evidence.centroidDistanceMm, Boolean(eligibleByStorey.get(probe.storeyId))),
      )
      assigned.add(probe.id)
    }

    const sortedMembers = candidateMembers.sort((a, b) => a.storeyId - b.storeyId || a.wetAreaId.localeCompare(b.wetAreaId))
    const representativeCentroid = averageCentroid(sortedMembers)
    const confidence = average(sortedMembers.map((member) => member.overlapRatio * 0.6 + overlapDistanceScore(member.centroidDistanceMm, resolved.maxCentroidDistanceMm) * 0.4))
    const hasEligibleMember = sortedMembers.some((member) => member.eligibleForNewRisers)

    groups.push({
      groupId: `wet-group-${groups.length + 1}`,
      members: sortedMembers,
      representativeCentroid,
      confidence: clamp01(confidence),
      reasons: buildReasons(sortedMembers, resolved),
      hasEligibleMember,
    })
  }

  return groups
}

function computeAlignmentEvidence(a: DetectedWetArea, b: DetectedWetArea, options: VerticalGroupingOptions) {
  const overlapRatio = computeOverlapRatio(a.bounds, b.bounds)
  const centroidDistanceMm = distanceMm(a.centroid, b.centroid)
  const overlapScore = overlapRatio >= options.minOverlapRatio ? overlapRatio : 0
  const distanceScore = overlapDistanceScore(centroidDistanceMm, options.maxCentroidDistanceMm)
  const confidence = overlapScore * 0.6 + distanceScore * 0.4
  return { overlapRatio, centroidDistanceMm, confidence }
}

function createMember(area: DetectedWetArea, overlapRatio: number, centroidDistanceMm: number, eligibleForNewRisers: boolean): VerticalWetGroupMember {
  return {
    storeyId: area.storeyId,
    wetAreaId: area.id,
    centroid: area.centroid,
    overlapRatio,
    centroidDistanceMm,
    eligibleForNewRisers,
  }
}

function averageCentroid(members: VerticalWetGroupMember[]) {
  const x = average(members.map((member) => member.centroid.x))
  const z = average(members.map((member) => member.centroid.z))
  return { x, z }
}

function buildReasons(members: VerticalWetGroupMember[], options: VerticalGroupingOptions): string[] {
  const avgOverlap = average(members.map((member) => member.overlapRatio))
  const avgDistance = average(members.map((member) => member.centroidDistanceMm))
  const reasons = [
    `members=${members.length}`,
    `avg_overlap=${avgOverlap.toFixed(2)} (threshold ${options.minOverlapRatio.toFixed(2)})`,
    `avg_centroid_offset_mm=${avgDistance.toFixed(0)} (tolerance ${options.maxCentroidDistanceMm.toFixed(0)})`,
  ]
  if (members.some((member) => !member.eligibleForNewRisers)) {
    reasons.push('contains floors excluded from new riser generation')
  }
  return reasons
}

function computeOverlapRatio(a: DetectedWetArea['bounds'], b: DetectedWetArea['bounds']): number {
  const intersectionMinX = Math.max(a.minX, b.minX)
  const intersectionMaxX = Math.min(a.maxX, b.maxX)
  const intersectionMinZ = Math.max(a.minZ, b.minZ)
  const intersectionMaxZ = Math.min(a.maxZ, b.maxZ)
  const intersectionWidth = Math.max(0, intersectionMaxX - intersectionMinX)
  const intersectionDepth = Math.max(0, intersectionMaxZ - intersectionMinZ)
  const intersectionArea = intersectionWidth * intersectionDepth
  if (intersectionArea <= 0) return 0
  const minArea = Math.min(area(a), area(b))
  return minArea > 0 ? intersectionArea / minArea : 0
}

function overlapDistanceScore(distanceMm: number, toleranceMm: number): number {
  if (distanceMm >= toleranceMm) return 0
  return clamp01(1 - distanceMm / toleranceMm)
}

function distanceMm(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.hypot(dx, dz) * 1000
}

function area(bounds: DetectedWetArea['bounds']): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxZ - bounds.minZ)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
