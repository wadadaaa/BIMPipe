import { buildRiserCoordinationIssues, type RiserCoordinationIssue } from '@/domain/buildRiserCoordinationIssues'
import { RISER_STRATEGY_DECISION, type RiserStrategyDecision } from '@/domain/decideRiserStrategyPerToiletRoom'
import type { VerticalWetGroup } from '@/domain/groupWetAreasVertically'
import type { Riser, Storey } from '@/domain/types'
import { classifyFloors, type ClassifiedFloor } from './floorClassification'
import type { StoreyDetectionAggregation } from '@/shared/ifc/aggregateStoreyDetections'

interface ValidationIssue {
  code: string
  severity: 'warning'
  message: string
}

interface BuildRiserValidationReportInput {
  exportRunId: string
  timestamp: string
  sourceIfcName: string | null
  storeys: Storey[]
  floorClassifications?: ClassifiedFloor[]
  detectionAggregation?: StoreyDetectionAggregation | null
  verticalWetRoomGroups?: VerticalWetGroup[]
  placementDecisions?: RiserStrategyDecision[]
  risers: Riser[]
}

export function buildRiserValidationReport(input: BuildRiserValidationReportInput) {
  const floorClassifications = [...(input.floorClassifications ?? classifyFloors(input.storeys))]
    .sort((a, b) => a.storeyId - b.storeyId)
  const classByStoreyId = new Map(floorClassifications.map((x) => [x.storeyId, x.class]))

  const validationIssues: ValidationIssue[] = []

  const processedFloors = input.storeys
    .map((storey) => ({
      storeyId: storey.id,
      storeyName: storey.name,
      elevation: storey.elevation,
      floorClass: classByStoreyId.get(storey.id) ?? 'standard',
    }))
    .sort((a, b) => a.elevation - b.elevation || a.storeyId - b.storeyId)

  const skippedFloors = processedFloors.filter((floor) => ['basement', 'roof', 'penthouse'].includes(floor.floorClass))

  const detectedFixtures = input.detectionAggregation
    ? Object.values(input.detectionAggregation.fixturesByStoreyId)
      .flat()
      .map((fixture) => ({
        expressId: fixture.expressId,
        storeyId: fixture.storeyId,
        kind: fixture.kind,
        name: fixture.name,
      }))
      .sort((a, b) => a.storeyId - b.storeyId || a.expressId - b.expressId)
    : []

  const detectedToiletRooms = detectedFixtures
    .filter((fixture) => fixture.kind === 'TOILETPAN')
    .map((fixture) => ({
      toiletRoomId: `toilet-room:${fixture.storeyId}:${fixture.expressId}`,
      storeyId: fixture.storeyId,
      sourceFixtureExpressId: fixture.expressId,
      sourceFixtureName: fixture.name,
    }))

  if (!input.detectionAggregation) {
    validationIssues.push({
      code: 'DETECTION_AGGREGATION_MISSING',
      severity: 'warning',
      message: 'Storey-level fixture/kitchen aggregation is unavailable; detection sections are partial.',
    })
  }

  const verticalWetRoomGroups = [...(input.verticalWetRoomGroups ?? [])]
    .sort((a, b) => a.groupId.localeCompare(b.groupId))
  if (!input.verticalWetRoomGroups) {
    validationIssues.push({
      code: 'VERTICAL_GROUPING_NOT_AVAILABLE',
      severity: 'warning',
      message: 'Vertical wet-room grouping is unavailable in current flow; grouping and strategy sections are partial.',
    })
  }

  const placementDecisions = [...(input.placementDecisions ?? [])].sort((a, b) => a.decisionId.localeCompare(b.decisionId))

  const coordinationIssues: RiserCoordinationIssue[] = buildRiserCoordinationIssues(placementDecisions)

  const unresolvedToiletRooms = placementDecisions
    .filter((decision) => decision.decision === RISER_STRATEGY_DECISION.COORDINATION_REQUIRED)
    .map((decision) => ({
      toiletRoomId: decision.areaId,
      storeyId: decision.storeyId,
      groupId: decision.groupId,
      reasons: decision.reasons,
    }))

  const newlyAddedRisers = [...input.risers]
    .sort((a, b) => a.stackLabel.localeCompare(b.stackLabel) || a.storeyId - b.storeyId || a.id.localeCompare(b.id))
    .map((riser) => ({
      riserId: riser.id,
      stackId: riser.stackId,
      stackLabel: riser.stackLabel,
      storeyId: riser.storeyId,
      position: { ...riser.position },
    }))

  const reusedRiserGroups = Array.from(new Set(
    placementDecisions
      .filter((d) => d.decision === RISER_STRATEGY_DECISION.COVERED_BY_EXISTING_RISER_GROUP || d.decision === RISER_STRATEGY_DECISION.PENTHOUSE_SERVED_BY_EXISTING_RISER)
      .map((d) => d.coveredByGroupId ?? d.servedByGroupId)
      .filter((id): id is string => Boolean(id)),
  )).sort()

  const existingRisers = reusedRiserGroups.map((groupId) => ({ groupId }))

  return {
    exportRunId: input.exportRunId,
    timestamp: input.timestamp,
    sourceIfcName: input.sourceIfcName,
    processedFloors,
    skippedFloors,
    floorClassifications,
    detectedToiletRooms,
    detectedFixtures,
    verticalWetRoomGroups,
    existingRisers,
    newlyAddedRisers,
    reusedRiserGroups,
    placementDecisions,
    coordinationIssues,
    unresolvedToiletRooms,
    validationIssues,
    summary: {
      processedFloorCount: processedFloors.length,
      skippedFloorCount: skippedFloors.length,
      detectedToiletRoomCount: detectedToiletRooms.length,
      detectedFixtureCount: detectedFixtures.length,
      verticalWetRoomGroupCount: verticalWetRoomGroups.length,
      existingRiserCount: existingRisers.length,
      newlyAddedRiserCount: newlyAddedRisers.length,
      reusedRiserGroupCount: reusedRiserGroups.length,
      placementDecisionCount: placementDecisions.length,
      coordinationIssueCount: coordinationIssues.length,
      unresolvedToiletRoomCount: unresolvedToiletRooms.length,
      validationIssueCount: validationIssues.length,
    },
  }
}
