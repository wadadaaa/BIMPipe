import type { VerticalWetGroup, VerticalWetGroupMember } from './groupWetAreasVertically'
import type { Storey, StoreyId } from './types'

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
  storeyId: StoreyId
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

interface ServingGroupResolution {
  kind: 'self' | 'stronger' | 'ambiguous'
  groupId?: string
}

export interface DecideRiserStrategyOptions {
  storeys?: Storey[]
}

export function decideRiserStrategyPerToiletRoom(
  groups: VerticalWetGroup[],
  options: DecideRiserStrategyOptions = {},
): RiserStrategyDecision[] {
  const storeyById = buildStoreyById(options.storeys)
  const sortedGroups = [...groups].sort((a, b) => a.groupId.localeCompare(b.groupId))
  const profiles = buildProfiles(sortedGroups)
  const overlappingByArea = buildOverlappingByArea(sortedGroups)

  const decisions: RiserStrategyDecision[] = []
  for (const group of sortedGroups) {
    const sortedMembers = sortMembers(group.members, storeyById)
    const eligibleMembers = sortedMembers.filter((member) => member.eligibleForNewRisers)
    const highestEligibleStoreyId = eligibleMembers.length > 0 ? maxEligibleStoreyId(group, storeyById) : null
    const primaryEligibleAreaId = eligibleMembers[0]?.areaId
    const primaryServingGroup = primaryEligibleAreaId
      ? resolveServingGroupForArea(primaryEligibleAreaId, group, overlappingByArea, profiles)
      : undefined

    for (const member of sortedMembers) {
      const overlaps = (overlappingByArea.get(member.areaId) ?? []).sort((a, b) => a.groupId.localeCompare(b.groupId))
      const strongerGroups = overlaps
        .filter((candidate) => isStrongerGroup(candidate, group, profiles))
        .sort((a, b) => compareGroupStrength(a, b, profiles))
      const topStronger = strongerGroups[0]
      const secondStronger = strongerGroups[1]
      const reasons: string[] = []

      let decision: RiserStrategyDecision

      if (!member.eligibleForNewRisers) {
        if (highestEligibleStoreyId !== null && compareStoreysByElevation(member.storeyId, highestEligibleStoreyId, storeyById) > 0) {
          if (primaryServingGroup?.kind === 'ambiguous' || !primaryServingGroup?.groupId) {
            reasons.push('penthouse serving group is ambiguous; coordination required')
            decision = createDecision(group, member, RISER_STRATEGY_DECISION.COORDINATION_REQUIRED, reasons, overlaps)
          } else {
            reasons.push('non-eligible member is above highest eligible storey in this group')
            decision = createDecision(group, member, RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER, reasons, overlaps, {
              servedByGroupId: primaryServingGroup.groupId,
            })
          }
        } else {
          reasons.push('storey is not eligible for new risers')
          decision = createDecision(group, member, RISER_STRATEGY_DECISION.EXCLUDED_FLOOR, reasons, overlaps)
        }
      } else if (topStronger && secondStronger && hasEqualStrength(topStronger, secondStronger, profiles)) {
        reasons.push('multiple stronger overlapping groups have equal strength; coordination required')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COORDINATION_REQUIRED, reasons, overlaps)
      } else if (topStronger) {
        reasons.push('covered by stronger overlapping group to avoid duplicate riser')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, reasons, overlaps, {
          coveredByGroupId: topStronger.groupId,
        })
      } else if (primaryEligibleAreaId === member.areaId) {
        reasons.push('eligible primary member receives riser placement for this group')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.RISER_PLACED, reasons, overlaps)
      } else if (primaryServingGroup?.kind === 'ambiguous' || !primaryServingGroup?.groupId) {
        reasons.push('primary eligible member has ambiguous serving group; coordination required')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COORDINATION_REQUIRED, reasons, overlaps)
      } else if (primaryServingGroup.groupId === group.groupId) {
        reasons.push('eligible non-primary member is covered by riser placed for this group')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, reasons, overlaps, {
          coveredByGroupId: group.groupId,
        })
      } else {
        reasons.push('eligible non-primary member inherits coverage from the stronger group serving this group primary member')
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP, reasons, overlaps, {
          coveredByGroupId: primaryServingGroup.groupId,
        })
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

function maxEligibleStoreyId(group: VerticalWetGroup, storeyById: Map<StoreyId, Storey>): StoreyId {
  return [...group.members]
    .filter((m) => m.eligibleForNewRisers)
    .sort((a, b) => compareStoreysByElevation(a.storeyId, b.storeyId, storeyById))
    .at(-1)!.storeyId
}

function sortMembers(members: VerticalWetGroupMember[], storeyById: Map<StoreyId, Storey>): VerticalWetGroupMember[] {
  return [...members].sort((a, b) => {
    const storeyCompare = compareStoreysByElevation(a.storeyId, b.storeyId, storeyById)
    if (storeyCompare !== 0) return storeyCompare
    return a.areaId.localeCompare(b.areaId)
  })
}

function isStrongerGroup(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): boolean {
  if (a.groupId === b.groupId) return false
  return compareGroupStrength(a, b, profiles) < 0
}

function hasEqualStrength(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): boolean {
  const pa = profiles.get(a.groupId)
  const pb = profiles.get(b.groupId)
  if (!pa || !pb) return false
  return pa.eligibleCount === pb.eligibleCount
    && pa.group.members.length === pb.group.members.length
    && pa.confidence === pb.confidence
}

function resolveServingGroupForArea(
  areaId: string,
  baseGroup: VerticalWetGroup,
  overlappingByArea: Map<string, VerticalWetGroup[]>,
  profiles: Map<string, GroupProfile>,
): ServingGroupResolution {
  const overlaps = (overlappingByArea.get(areaId) ?? []).filter((group) => group.groupId !== baseGroup.groupId)
  const stronger = overlaps
    .filter((group) => isStrongerGroup(group, baseGroup, profiles))
    .sort((a, b) => compareGroupStrength(a, b, profiles))
  const top = stronger[0]
  const second = stronger[1]
  if (top && second && hasEqualStrength(top, second, profiles)) return { kind: 'ambiguous' }
  if (top) return { kind: 'stronger', groupId: top.groupId }
  return { kind: 'self', groupId: baseGroup.groupId }
}

function compareStoreysByElevation(a: StoreyId, b: StoreyId, storeyById: Map<StoreyId, Storey>): number {
  if (storeyById.size === 0) return a - b
  const sa = storeyById.get(a)
  const sb = storeyById.get(b)
  if (!sa || !sb) return a - b
  if (sa.elevation !== sb.elevation) return sa.elevation - sb.elevation
  return sa.id - sb.id
}

function buildStoreyById(storeys?: Storey[]): Map<StoreyId, Storey> {
  return new Map((storeys ?? []).map((storey) => [storey.id, storey]))
}

function compareGroupStrength(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): number {
  const pa = profiles.get(a.groupId)
  const pb = profiles.get(b.groupId)
  if (!pa || !pb) return a.groupId.localeCompare(b.groupId)

  if (pa.eligibleCount !== pb.eligibleCount) return pb.eligibleCount - pa.eligibleCount
  if (pa.group.members.length !== pb.group.members.length) return pb.group.members.length - pa.group.members.length
  if (pa.confidence !== pb.confidence) return pb.confidence - pa.confidence

  // Deterministic tie-break to keep equal-strength comparisons total-ordered.
  return a.groupId.localeCompare(b.groupId)
}

function buildDecisionId(groupId: string, member: VerticalWetGroupMember): string {
  return `riser-decision:${groupId}:${member.storeyId}:${member.areaId}`
}
