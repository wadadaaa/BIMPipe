import { decideRiserStrategyPerToiletRoom, RISER_STRATEGY_DECISION, type RiserStrategyDecision } from '@/domain/decideRiserStrategyPerToiletRoom'
import { buildStoreyEligibilityById, groupWetAreasVertically, type DetectedWetArea, type StoreyEligibilitySummary, type VerticalWetGroup } from '@/domain/groupWetAreasVertically'
import type { Fixture, Storey } from '@/domain/types'

export interface RuntimePlacementStrategy {
  wetAreas: DetectedWetArea[]
  verticalGroups: VerticalWetGroup[]
  placementDecisions: RiserStrategyDecision[]
}

const TOILET_ROOM_PROXY_HALF_WIDTH_M = 0.6

export function buildRuntimePlacementStrategy(
  storeys: Storey[],
  fixtures: Fixture[],
  floors: StoreyEligibilitySummary[],
): RuntimePlacementStrategy {
  const wetAreas = fixtures
    .filter((fixture) => fixture.kind === 'TOILETPAN')
    .map((fixture) => {
      if (!fixture.position) {
        return null
      }

      // Approximate toilet-room footprint proxy around fixture centroid for vertical overlap grouping.
      const radius = TOILET_ROOM_PROXY_HALF_WIDTH_M
      return {
        areaId: `fixture:${fixture.expressId}`,
        storeyId: fixture.storeyId,
        planBounds: {
          minX: fixture.position.x - radius,
          maxX: fixture.position.x + radius,
          minZ: fixture.position.z - radius,
          maxZ: fixture.position.z + radius,
        },
      } satisfies DetectedWetArea
    })
    .filter((value): value is DetectedWetArea => value !== null)

  const eligibilityByStoreyId = buildStoreyEligibilityById(floors)
  const verticalGroups = groupWetAreasVertically(wetAreas, storeys, eligibilityByStoreyId)
  const placementDecisions = decideRiserStrategyPerToiletRoom(verticalGroups, { storeys })

  const fallbackDecisions = fixtures
    .filter((fixture) => fixture.kind === 'TOILETPAN' && fixture.position === null)
    .map((fixture): RiserStrategyDecision => ({
      decisionId: `runtime:fallback:${fixture.expressId}`,
      groupId: `runtime:fallback-group:${fixture.expressId}`,
      areaId: `fixture:${fixture.expressId}`,
      storeyId: fixture.storeyId,
      decision: RISER_STRATEGY_DECISION.COORDINATION_REQUIRED,
      reasons: ['TOILETPAN fixture is missing plan position; manual coordination required'],
      debug: {
        confidence: 0,
        overlapGroupIds: [],
      },
    }))

  return {
    wetAreas,
    verticalGroups,
    placementDecisions: [...placementDecisions, ...fallbackDecisions].sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
  }
}
