import { buildToiletRoomAreaId } from '@/domain/buildToiletRoomAreaId'
import { decideRiserStrategyPerToiletRoom, RISER_STRATEGY_DECISION, type RiserStrategyDecision } from '@/domain/decideRiserStrategyPerToiletRoom'
import { buildStoreyEligibilityById, groupWetAreasVertically, type DetectedWetArea } from '@/domain/groupWetAreasVertically'
import type { Storey } from '@/domain/types'
import type { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'

// Geometric proxy for toilet-room footprint around fixture centroids used only for vertical grouping.
export const TOILET_ROOM_PROXY_HALF_WIDTH_M = 0.6

export function buildRuntimePlacementStrategy(
  storeys: Storey[],
  detectionAggregation: Awaited<ReturnType<typeof aggregateStoreyDetections>>,
): { verticalWetRoomGroups: ReturnType<typeof groupWetAreasVertically>, placementDecisions: RiserStrategyDecision[] } {
  const wetAreas: DetectedWetArea[] = Object.values(detectionAggregation.fixturesByStoreyId)
    .flat()
    .filter((fixture) => fixture.kind === 'TOILETPAN' && fixture.position)
    .map((fixture) => ({
      areaId: buildToiletRoomAreaId(fixture.storeyId, fixture.expressId),
      storeyId: fixture.storeyId,
      planBounds: {
        minX: fixture.position!.x - TOILET_ROOM_PROXY_HALF_WIDTH_M,
        maxX: fixture.position!.x + TOILET_ROOM_PROXY_HALF_WIDTH_M,
        minZ: fixture.position!.z - TOILET_ROOM_PROXY_HALF_WIDTH_M,
        maxZ: fixture.position!.z + TOILET_ROOM_PROXY_HALF_WIDTH_M,
      },
    }))

  const eligibilityByStoreyId = buildStoreyEligibilityById(
    detectionAggregation.floors.map((floor) => ({ id: floor.storeyId, eligibleForNewRisers: floor.eligibleForNewRisers })),
  )
  const verticalWetRoomGroups = groupWetAreasVertically(wetAreas, storeys, eligibilityByStoreyId)
  const placementDecisions = decideRiserStrategyPerToiletRoom(verticalWetRoomGroups, { storeys })
  const decisionByAreaId = new Map(placementDecisions.map((decision) => [decision.areaId, decision]))

  for (const fixture of Object.values(detectionAggregation.fixturesByStoreyId).flat()) {
    if (fixture.kind !== 'TOILETPAN') continue
    const areaId = buildToiletRoomAreaId(fixture.storeyId, fixture.expressId)
    if (decisionByAreaId.has(areaId)) continue
    placementDecisions.push({
      decisionId: `runtime-fallback:${areaId}`,
      groupId: `ungrouped:${areaId}`,
      areaId,
      storeyId: fixture.storeyId,
      decision: RISER_STRATEGY_DECISION.COORDINATION_REQUIRED,
      reasons: fixture.position
        ? ['detected toilet room is not represented in vertical wet-room groups; coordination required']
        : ['detected toilet room is missing position geometry; coordination required'],
      debug: { confidence: 0, overlapGroupIds: [] },
    })
  }

  return {
    verticalWetRoomGroups,
    placementDecisions: placementDecisions.sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
  }
}
