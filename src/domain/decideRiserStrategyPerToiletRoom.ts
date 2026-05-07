import type { VerticalWetGroup, VerticalWetGroupMember } from './groupWetAreasVertically'
import type { Storey, StoreyId } from './types'

export const RISER_STRATEGY_DECISION = {
  RISER_PLACED: 'RISER_PLACED',
  COVERED_BY_EXISTING_RISER_GROUP: 'COVERED_BY_EXISTING_RISER_GROUP',
  COVERED_BY_EXCEPTION_RULE: 'COVERED_BY_EXCEPTION_RULE',
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
  /** Group whose riser covers this area. It may not have an explicit member for this area/storey when coverage is inherited through the base group's primary member. */
  coveredByGroupId?: string
  /** Exception rule that explicitly says this area should not receive a newly generated riser. */
  coveredByExceptionRuleId?: string
  /** Group whose riser serves this penthouse area through the vertical shaft. */
  servedByGroupId?: string
  reasons: string[]
  debug: {
    confidence: number
    overlapGroupIds: string[]
  }
}

/**
 * Explicitly suppresses new riser generation for matching toilet-room members.
 * Selector fields use AND semantics: when more than one selector is present,
 * groupIds, areaIds, and storeyIds must all match for the rule to apply.
 * Rules with no selectors, including empty selector arrays, match nothing.
 */
export interface RiserCoverageExceptionRule {
  ruleId: string
  groupIds?: string[]
  areaIds?: string[]
  storeyIds?: StoreyId[]
  reason?: string
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
  exceptionRules?: RiserCoverageExceptionRule[]
}

const CONFIDENCE_EPSILON = 1e-9

export function decideRiserStrategyPerToiletRoom(
  groups: VerticalWetGroup[],
  options: DecideRiserStrategyOptions = {},
): RiserStrategyDecision[] {
  const storeyById = buildStoreyById(options.storeys)
  const sortedExceptionRules = [...(options.exceptionRules ?? [])].sort((a, b) => a.ruleId.localeCompare(b.ruleId))
  const sortedGroups = [...groups].sort((a, b) => a.groupId.localeCompare(b.groupId))
  const profiles = buildProfiles(sortedGroups)
  const overlappingByArea = buildOverlappingByArea(sortedGroups)

  const decisions: RiserStrategyDecision[] = []
  for (const group of sortedGroups) {
    const sortedMembers = sortMembers(group.members, storeyById)
    const eligibleMembers = sortedMembers.filter((member) => member.eligibleForNewRisers)
    const highestEligibleStoreyId = eligibleMembers.length > 0 ? maxEligibleStoreyId(group, storeyById) : null
    const primaryEligibleMember = eligibleMembers[0]
    const primaryEligibleAreaId = primaryEligibleMember?.areaId
    const primaryServingGroup = primaryEligibleAreaId
      ? resolveServingGroupForArea(primaryEligibleAreaId, group, overlappingByArea, profiles)
      : undefined
    const primaryExceptionRule = primaryEligibleMember
      ? findCoveringExceptionRule(group, primaryEligibleMember, sortedExceptionRules)
      : undefined

    for (const member of sortedMembers) {
      const overlaps = overlappingByArea.get(member.areaId) ?? []
      const strongerGroups = overlaps
        .filter((candidate) => isStrongerGroup(candidate, group, profiles))
        .sort((a, b) => compareGroupStrength(a, b, profiles))
      const topStronger = strongerGroups[0]
      const secondStronger = strongerGroups[1]
      const exceptionRule = findCoveringExceptionRule(group, member, sortedExceptionRules)
      const reasons: string[] = []

      let decision: RiserStrategyDecision

      // Explicit exception rules intentionally take precedence over group-strength coverage.
      if (member.eligibleForNewRisers && exceptionRule) {
        reasons.push(exceptionRule.reason ?? `covered by exception rule ${exceptionRule.ruleId}`)
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE, reasons, overlaps, {
          coveredByExceptionRuleId: exceptionRule.ruleId,
        })
      } else if (!member.eligibleForNewRisers) {
        if (highestEligibleStoreyId !== null && compareStoreysByElevation(member.storeyId, highestEligibleStoreyId, storeyById) > 0) {
          const penthouseExceptionRule = exceptionRule ?? primaryExceptionRule

          if (penthouseExceptionRule) {
            const penthouseReason = penthouseExceptionRule.reason
              ? `inherits exception coverage from primary member: ${penthouseExceptionRule.reason}`
              : `penthouse is served by exception rule ${penthouseExceptionRule.ruleId}`
            reasons.push(penthouseReason)
            decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE, reasons, overlaps, {
              coveredByExceptionRuleId: penthouseExceptionRule.ruleId,
            })
          } else if (primaryServingGroup?.kind === 'ambiguous' || !primaryServingGroup?.groupId) {
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
      } else if (primaryEligibleAreaId !== member.areaId && primaryExceptionRule) {
        const inheritedReason = primaryExceptionRule.reason
          ? `inherits exception coverage from primary member: ${primaryExceptionRule.reason}`
          : `eligible non-primary member inherits exception coverage from primary member rule ${primaryExceptionRule.ruleId}`
        reasons.push(inheritedReason)
        decision = createDecision(group, member, RISER_STRATEGY_DECISION.COVERED_BY_EXCEPTION_RULE, reasons, overlaps, {
          coveredByExceptionRuleId: primaryExceptionRule.ruleId,
        })
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
        reasons.push(`eligible non-primary member inherits coverage from stronger group ${primaryServingGroup.groupId} serving this group primary member`)
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
  refs?: { coveredByGroupId?: string, coveredByExceptionRuleId?: string, servedByGroupId?: string },
): RiserStrategyDecision {
  return {
    decisionId: buildDecisionId(group.groupId, member),
    groupId: group.groupId,
    areaId: member.areaId,
    storeyId: member.storeyId,
    decision: type,
    coveredByGroupId: refs?.coveredByGroupId,
    coveredByExceptionRuleId: refs?.coveredByExceptionRuleId,
    servedByGroupId: refs?.servedByGroupId,
    reasons,
    debug: {
      confidence: group.debug.confidence,
      overlapGroupIds: overlaps.map((g) => g.groupId).filter((groupId) => groupId !== group.groupId),
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
  const eligibleMembers = [...group.members]
    .filter((m) => m.eligibleForNewRisers)
    .sort((a, b) => compareStoreysByElevation(a.storeyId, b.storeyId, storeyById))
  if (eligibleMembers.length === 0) {
    throw new Error(`Cannot resolve highest eligible storey for group ${group.groupId} without eligible members`)
  }
  return eligibleMembers[eligibleMembers.length - 1].storeyId
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
  const pa = getProfile(a.groupId, profiles)
  const pb = getProfile(b.groupId, profiles)
  return pa.eligibleCount === pb.eligibleCount
    && pa.group.members.length === pb.group.members.length
    && Math.abs(pa.confidence - pb.confidence) < CONFIDENCE_EPSILON
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
  const sa = storeyById.get(a)
  const sb = storeyById.get(b)
  if (!sa && !sb) return a - b
  if (!sa || !sb) {
    const missing = [!sa ? a : null, !sb ? b : null].filter((id): id is StoreyId => id !== null)
    throw new Error(`Missing storey metadata for storey id(s): ${missing.join(', ')}`)
  }
  if (sa.elevation !== sb.elevation) return sa.elevation - sb.elevation
  return sa.id - sb.id
}

function buildStoreyById(storeys?: Storey[]): Map<StoreyId, Storey> {
  return new Map((storeys ?? []).map((storey) => [storey.id, storey]))
}

function compareGroupStrength(a: VerticalWetGroup, b: VerticalWetGroup, profiles: Map<string, GroupProfile>): number {
  const pa = getProfile(a.groupId, profiles)
  const pb = getProfile(b.groupId, profiles)

  if (pa.eligibleCount !== pb.eligibleCount) return pb.eligibleCount - pa.eligibleCount
  // Larger vertical/wet-area coverage is treated as stronger, including ineligible members.
  if (pa.group.members.length !== pb.group.members.length) return pb.group.members.length - pa.group.members.length
  if (Math.abs(pa.confidence - pb.confidence) >= CONFIDENCE_EPSILON) return pb.confidence - pa.confidence

  return a.groupId.localeCompare(b.groupId)
}

function getProfile(groupId: string, profiles: Map<string, GroupProfile>): GroupProfile {
  const profile = profiles.get(groupId)
  if (!profile) throw new Error(`Missing group profile for ${groupId}`)
  return profile
}

function findCoveringExceptionRule(
  group: VerticalWetGroup,
  member: VerticalWetGroupMember,
  rules: RiserCoverageExceptionRule[],
): RiserCoverageExceptionRule | undefined {
  // Multiple matching rules are resolved deterministically by the caller's ruleId sort.
  return rules.find((rule) => exceptionRuleCoversMember(rule, group, member))
}

function exceptionRuleCoversMember(
  rule: RiserCoverageExceptionRule,
  group: VerticalWetGroup,
  member: VerticalWetGroupMember,
): boolean {
  const hasSelector = Boolean(rule.groupIds?.length || rule.areaIds?.length || rule.storeyIds?.length)
  if (!hasSelector) return false

  const groupMatches = !rule.groupIds?.length || rule.groupIds.includes(group.groupId)
  const areaMatches = !rule.areaIds?.length || rule.areaIds.includes(member.areaId)
  const storeyMatches = !rule.storeyIds?.length || rule.storeyIds.includes(member.storeyId)

  return groupMatches && areaMatches && storeyMatches
}

function buildDecisionId(groupId: string, member: VerticalWetGroupMember): string {
  return `riser-decision|${groupId}|${member.storeyId}|${member.areaId}`
}
