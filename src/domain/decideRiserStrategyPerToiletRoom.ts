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
  const profiles = buildProfiles(sortedGroups)
  const overlappingByArea = buildOverlappingByArea(sortedGroups)

  const decisions: RiserStrategyDecision[] = []
  for (const group of sortedGroups) {
    const hasEligible = hasEligibleMember(group)
    const highestEligibleStoreyId = hasEligible ? maxEligibleStoreyId(group) : null

    for (const member of sortMembers(group.members)) {
      const overlaps = (overlappingByArea.get(member.areaId) ?? []).sort((a, b) => a.groupId.localeCompare(b.groupId))
      const strongerGroups = overlaps.filter((candidate) => isStrongerGroup(candidate, group, profiles))
      const topStronger = strongerGroups[0]
      const reasons: string[] = []

      let decision: RiserStrategyDecision

      if (!member.eligibleForNewRisers) {
        if (highestEligibleStoreyId !== null && member.storeyId > highestEligibleStoreyId) {
          reasons.push('non-eligible member is above highest eligible storey in this group')
          decision = createDecision(group, member, RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER, reasons, overlaps, {
            servedByGroupId: group.groupId,
          })
        } else {
          reasons.push('storey is not eligible for new risers')
          decision = createDecision(group, member, RISER_STRATEGY_DECISION.EXCLUDED_FLOOR, reasons, overlaps)
        }
      } else if (topStronger) {
        reasons.push('covered by stronger overlapping group to avoid duplicate riser')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, reasons, overlaps, {
          coveredByGroupId: topStronger.groupId,
        })
      } else if (hasEligible) {
        reasons.push('eligible member in strongest available group receives riser placement')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.RISER_PLACED, reasons, overlaps)
      } else {
        throw new Error(`Unexpected strategy state for area ${member.areaId} in group ${group.groupId}`)
      }

      decisions.push(decision)
    }
  }

  return decisions.sort((a, b) => a.decisionId.localeCompare(b.decisionId))
}

function createDecision(
  group: VerticalWetGroup,
  member: VerticalWetGroupMember,
  type: RiserStrategyDecisionType,
  reasons: string[],
  overlaps: VerticalWetGroup[],
  refs?: { coveredByGroupId?: string, servedByGroupId?: string },
): RiserStrategyDecision {
  return {
    decisionId: buildDecisionId(group.groupId, member),
    groupId: group.groupId,
    areaId: member.areaId,
    storeyId: member.storeyId,
    decision: type,
    coveredByGroupId: refs?.coveredByGroupId,
    servedByGroupId: refs?.servedByGroupId,
    reasons,
    debug: {
      confidence: member.debug.confidence,
      overlapGroupIds: overlaps.map((g) => g.groupId),
    },
  }
}

function buildProfiles(groups: VerticalWetGroup[]): Map<string, GroupProfile> {
  const profiles = new Map<string, GroupProfile>()
  for (const group of groups) {
    const eligibleCount = group.members.filter((m) => m.eligibleForNewRisers).length
    profiles.set(group.groupId, { group, eligibleCount, confidence: group.debug.confidence })
  }
  return profiles
}

function buildOverlappingByArea(groups: VerticalWetGroup[]): Map<string, VerticalWetGroup[]> {
  const overlappingByArea = new Map<string, VerticalWetGroup[]>()
  for (const group of groups) {
    for (const member of group.members) {
      const list = overlappingByArea.get(member.areaId) ?? []
      list.push(group)
      overlappingByArea.set(member.areaId, list)
    }
  }
  return overlappingByArea
}

function hasEligibleMember(group: VerticalWetGroup): boolean {
  return group.members.some((m) => m.eligibleForNewRisers)
}

function maxEligibleStoreyId(group: VerticalWetGroup): number {
  return Math.max(...group.members.filter((m) => m.eligibleForNewRisers).map((m) => m.storeyId))
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
  // Deterministic tie-break to avoid spurious coordination flags.
  return a.groupId.localeCompare(b.groupId) < 0
}

function buildDecisionId(groupId: string, member: VerticalWetGroupMember): string {
  return `riser-decision:${groupId}:${member.storeyId}:${member.areaId}`
}
