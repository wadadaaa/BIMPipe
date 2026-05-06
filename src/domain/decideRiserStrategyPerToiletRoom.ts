import type { VerticalWetGroup, VerticalWetGroupMember } from './groupWetAreasVertically'

export const RISER_STRATEGY_DECISION = {
  RISER_PLACED: 'RISER_PLACED',
  COVERED_BY_EXISTING_RISER_GROUP: 'COVERED_BY_EXISTING_RISER_GROUP',
  PENTHOUSE_SERVED_BY_EXISTING_RISER: 'PENTHOUSE_SERVED_BY_EXISTING_RISER',
  EXCLUDED_FLOOR: 'EXCLUDED_FLOOR',
  COORDINATION_REQUIRED: 'COORDINATION_REQUIRED',
} as const

export type RiserStrategyDecisionType =
  (typeof RISER_STRATEGY_DECISION)[keyof typeof RISER_STRATEGY_DECISION]

export interface RiserStrategyDecision {
  decisionId: string
  groupId: string
  areaId: string
  storeyId: number
  decision: RiserStrategyDecisionType
  coveredByGroupId?: string
  servedByGroupId?: string
  reasons: string[]
  debug: {
    confidence: number
    overlapGroupIds: string[]
  }
}

interface GroupProfile {
  group: VerticalWetGroup
  eligibleCount: number
  confidence: number
}

export function decideRiserStrategyPerToiletRoom(groups: VerticalWetGroup[]): RiserStrategyDecision[] {
  const sortedGroups = [...groups].sort((a, b) => a.groupId.localeCompare(b.groupId))
  const profiles = new Map<string, GroupProfile>()
  for (const group of sortedGroups) {
    const eligibleCount = group.members.filter((m) => m.eligibleForNewRisers).length
    profiles.set(group.groupId, { group, eligibleCount, confidence: group.debug.confidence })
  }

  const overlappingByArea = new Map<string, VerticalWetGroup[]>()
  for (const group of sortedGroups) {
    for (const member of group.members) {
      const list = overlappingByArea.get(member.areaId) ?? []
      list.push(group)
      overlappingByArea.set(member.areaId, list)
    }
  }

  const decisions: RiserStrategyDecision[] = []
  for (const group of sortedGroups) {
    const primary = choosePrimaryPlacedGroup(group, profiles)
    const placedGroupId = primary?.groupId

    for (const member of sortMembers(group.members)) {
      const overlaps = (overlappingByArea.get(member.areaId) ?? []).sort((a, b) => a.groupId.localeCompare(b.groupId))
      const overlapIds = overlaps.map((g) => g.groupId)
      const stronger = overlaps.filter((g) => isStrongerGroup(g, group, profiles))
      const topStronger = stronger[0]
      const ambiguous = stronger.length > 1 && sameStrength(stronger[0], stronger[1], profiles)

      const reasons: string[] = []
      let decision: RiserStrategyDecisionType = RISER_STRATEGY_DECISION.COORDINATION_REQUIRED
      let coveredByGroupId: string | undefined
      let servedByGroupId: string | undefined

      if (!member.eligibleForNewRisers) {
        if (placedGroupId && hasEligibleMember(group) && member.storeyId > minEligibleStoreyId(group)) {
          decision = RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER
          servedByGroupId = placedGroupId
          reasons.push('non-eligible top-floor member aligned with lower eligible placed group')
        } else {
          decision = RISER_STRATEGY_DECISION.EXCLUDED_FLOOR
          reasons.push('storey is not eligible for new risers')
        }
      } else if (topStronger) {
        if (ambiguous) {
          decision = RISER_STRATEGY_DECISION.COORDINATION_REQUIRED
          reasons.push('overlap with multiple equally strong groups requires coordination')
        } else {
          decision = RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP
          coveredByGroupId = topStronger.groupId
          reasons.push('covered by stronger overlapping group to avoid duplicate riser')
        }
      } else if (placedGroupId === group.groupId) {
        decision = RISER_STRATEGY_DECISION.RISER_PLACED
        reasons.push('eligible primary group receives riser placement')
      } else if (placedGroupId) {
        decision = RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP
        coveredByGroupId = placedGroupId
        reasons.push('member covered by riser placed for this vertical group')
      }

      decisions.push({
        decisionId: buildDecisionId(group.groupId, member),
        groupId: group.groupId,
        areaId: member.areaId,
        storeyId: member.storeyId,
        decision,
        coveredByGroupId,
        servedByGroupId,
        reasons,
        debug: {
          confidence: member.debug.confidence,
          overlapGroupIds: overlapIds,
        },
      })
    }
  }

  return decisions.sort((a, b) => a.decisionId.localeCompare(b.decisionId))
}

function choosePrimaryPlacedGroup(group: VerticalWetGroup, profiles: Map<string, GroupProfile>): VerticalWetGroup | null {
  const profile = profiles.get(group.groupId)
  if (!profile || profile.eligibleCount === 0) return null
  return group
}

function hasEligibleMember(group: VerticalWetGroup): boolean {
  return group.members.some((m) => m.eligibleForNewRisers)
}

function minEligibleStoreyId(group: VerticalWetGroup): number {
  return Math.min(...group.members.filter((m) => m.eligibleForNewRisers).map((m) => m.storeyId))
}

function sortMembers(members: VerticalWetGroupMember[]): VerticalWetGroupMember[] {
  return [...members].sort((a, b) => (a.storeyId === b.storeyId ? a.areaId.localeCompare(b.areaId) : a.storeyId - b.storeyId))
}

function isStrongerGroup(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): boolean {
  if (a.groupId === b.groupId) return false
  const pa = profiles.get(a.groupId)
  const pb = profiles.get(b.groupId)
  if (!pa || !pb) return false
  if (pa.eligibleCount !== pb.eligibleCount) return pa.eligibleCount > pb.eligibleCount
  if (pa.group.members.length !== pb.group.members.length) return pa.group.members.length > pb.group.members.length
  if (pa.confidence !== pb.confidence) return pa.confidence > pb.confidence
  return a.groupId.localeCompare(b.groupId) < 0
}

function sameStrength(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): boolean {
  const pa = profiles.get(a.groupId)
  const pb = profiles.get(b.groupId)
  if (!pa || !pb) return false
  return pa.eligibleCount === pb.eligibleCount
    && pa.group.members.length === pb.group.members.length
    && pa.confidence === pb.confidence
}

function buildDecisionId(groupId: string, member: VerticalWetGroupMember): string {
  return `riser-decision:${groupId}:${member.storeyId}:${member.areaId}`
}
