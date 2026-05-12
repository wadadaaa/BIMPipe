import { RISER_STRATEGY_DECISION, type RiserStrategyDecision } from './decideRiserStrategyPerToiletRoom'
import type { StoreyId } from './types'

export const RISER_COORDINATION_ISSUE_REASON_CODE = {
  SHIFTED_FIXTURE_OR_OVERLAPPING_GROUP: 'SHIFTED_FIXTURE_OR_OVERLAPPING_GROUP',
  PENTHOUSE_UNSERVED: 'PENTHOUSE_UNSERVED',
  AMBIGUOUS_SERVING_GROUP: 'AMBIGUOUS_SERVING_GROUP',
} as const

export type RiserCoordinationIssueReasonCode =
  (typeof RISER_COORDINATION_ISSUE_REASON_CODE)[keyof typeof RISER_COORDINATION_ISSUE_REASON_CODE]

export interface BuildRiserCoordinationIssuesOptions {
  storeyNameById?: Map<StoreyId, string> | Record<number, string>
  areaLabelById?: Map<string, string> | Record<string, string>
  fixtureLabelByAreaId?: Map<string, string> | Record<string, string>
}

export interface RiserCoordinationIssue {
  issueId: string
  decisionId: string
  groupId: string
  areaId: string
  storeyId: StoreyId
  storeyName?: string
  areaLabel?: string
  fixtureLabel?: string
  relatedGroupIds: string[]
  reasonCode: RiserCoordinationIssueReasonCode
  reason: string
  recommendedAction: string
  debug: {
    overlapGroupIds: string[]
    originalReasons: string[]
  }
}

export function buildRiserCoordinationIssues(
  decisions: RiserStrategyDecision[],
  options: BuildRiserCoordinationIssuesOptions = {},
): RiserCoordinationIssue[] {
  return decisions
    .filter((decision) => decision.decision === RISER_STRATEGY_DECISION.COORDINATION_REQUIRED)
    .map((decision) => {
      const reasonCode = classifyReasonCode(decision.reasons)
      const relatedGroupIds = buildRelatedGroupIds(decision)

      return {
        issueId: buildIssueId(decision, reasonCode),
        decisionId: decision.decisionId,
        groupId: decision.groupId,
        areaId: decision.areaId,
        storeyId: decision.storeyId,
        storeyName: getLookupValue(options.storeyNameById, decision.storeyId),
        areaLabel: getLookupValue(options.areaLabelById, decision.areaId),
        fixtureLabel: getLookupValue(options.fixtureLabelByAreaId, decision.areaId),
        relatedGroupIds,
        reasonCode,
        reason: reasonForCode(reasonCode),
        recommendedAction: recommendedActionForCode(reasonCode),
        debug: {
          overlapGroupIds: [...decision.debug.overlapGroupIds].sort(),
          originalReasons: [...decision.reasons],
        },
      }
    })
    .sort((a, b) => {
      const byIssueId = a.issueId.localeCompare(b.issueId)
      if (byIssueId !== 0) return byIssueId
      return a.decisionId.localeCompare(b.decisionId)
    })
}

function classifyReasonCode(reasons: string[]): RiserCoordinationIssueReasonCode {
  const normalized = reasons.map((reason) => reason.toLowerCase())

  if (normalized.some((reason) => reason.includes('penthouse'))) {
    return RISER_COORDINATION_ISSUE_REASON_CODE.PENTHOUSE_UNSERVED
  }

  if (normalized.some((reason) => reason.includes('multiple stronger overlapping groups') || reason.includes('equal strength'))) {
    return RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP
  }

  if (normalized.some((reason) => reason.includes('ambiguous') || reason.includes('overlap') || reason.includes('duplicate riser'))) {
    return RISER_COORDINATION_ISSUE_REASON_CODE.SHIFTED_FIXTURE_OR_OVERLAPPING_GROUP
  }

  return RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP
}

function buildRelatedGroupIds(decision: RiserStrategyDecision): string[] {
  const all = [decision.coveredByGroupId, decision.servedByGroupId, ...decision.debug.overlapGroupIds]
    .filter((groupId): groupId is string => Boolean(groupId))
  return Array.from(new Set(all)).sort()
}

function buildIssueId(
  decision: Pick<RiserStrategyDecision, 'storeyId' | 'groupId' | 'areaId'>,
  reasonCode: RiserCoordinationIssueReasonCode,
): string {
  return `riser-coordination|${decision.storeyId}|${decision.groupId}|${decision.areaId}|${reasonCode}`
}

function reasonForCode(reasonCode: RiserCoordinationIssueReasonCode): string {
  switch (reasonCode) {
    case RISER_COORDINATION_ISSUE_REASON_CODE.SHIFTED_FIXTURE_OR_OVERLAPPING_GROUP:
      return 'Eligible wet-room candidate conflicts with overlapping or shifted fixture conditions that may duplicate risers.'
    case RISER_COORDINATION_ISSUE_REASON_CODE.PENTHOUSE_UNSERVED:
      return 'Penthouse or top non-eligible member cannot be confidently served by a lower-floor riser group.'
    case RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP:
    default:
      return 'Multiple serving-group interpretations are possible and require explicit coordination.'
  }
}

function recommendedActionForCode(reasonCode: RiserCoordinationIssueReasonCode): string {
  switch (reasonCode) {
    case RISER_COORDINATION_ISSUE_REASON_CODE.SHIFTED_FIXTURE_OR_OVERLAPPING_GROUP:
      return 'Review shifted fixture / overlapping wet-room group and decide whether to reuse the existing riser group or create a manual exception.'
    case RISER_COORDINATION_ISSUE_REASON_CODE.PENTHOUSE_UNSERVED:
      return 'Review penthouse toilet manually and either assign it to a lower riser group or create an explicit exception rule.'
    case RISER_COORDINATION_ISSUE_REASON_CODE.AMBIGUOUS_SERVING_GROUP:
    default:
      return 'Choose the intended serving riser group or add an explicit coverage exception rule.'
  }
}

function getLookupValue(
  lookup: Map<string | number, string> | Record<string | number, string> | undefined,
  key: string | number,
): string | undefined {
  if (!lookup) return undefined
  if (lookup instanceof Map) return lookup.get(key)
  return lookup[key]
}
