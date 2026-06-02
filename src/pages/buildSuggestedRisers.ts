import type { MutableRefObject } from 'react'
import type { Fixture, KitchenArea, Riser, Storey, StoreyId } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { buildRiserStack } from '@/shared/routes/buildRiserStacks'
import { getEligibleStoreyIdsForAutoRisers } from '@/shared/routes/floorClassification'
import { suggestRiserPositions } from '@/shared/routes/suggestRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from '@/shared/routes/riserPlacementProfile'
import {
  getDemoRuntimeConfig,
  isStoreyExcludedFromDemoScope,
  isStoreyIncludedInDemoScope,
} from '@/shared/demoConfig'

export function takeNextRiserLabel(nextRiserLabelRef: MutableRefObject<number>): string {
  const label = `R${nextRiserLabelRef.current}`
  nextRiserLabelRef.current += 1
  return label
}

/**
 * Suggests riser positions from the fixtures/kitchens on the demo-scoped floors, then
 * creates one `Riser` entry per eligible storey while preserving the source floor's
 * vertical offset from its storey elevation. All entries for the same physical pipe share a
 * `stackId`.
 *
 * The demo scope only constrains which floors' fixtures drive placement (where the riser lands
 * in plan). A riser is a physical vertical shaft, so its stack spans every eligible floor of the
 * building, not just the demo-scoped floors — otherwise risers placed from floor 2 would vanish
 * when the user inspects an out-of-scope floor (e.g. קומה 3).
 */
export function buildSuggestedRisers(
  storeys: Storey[],
  sourceStoreyId: StoreyId,
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  floorMeshes: FloorMeshes | null,
  nextRiserLabelRef: MutableRefObject<number>,
  demoRuntime: ReturnType<typeof getDemoRuntimeConfig>,
): Riser[] {
  const ruleProfile = DEFAULT_RISER_PLACEMENT_RULE_PROFILE
  const floorPlanBounds = floorMeshes
    ? {
        minX: floorMeshes.boundingBox.min.x,
        maxX: floorMeshes.boundingBox.max.x,
        minZ: floorMeshes.boundingBox.min.z,
        maxZ: floorMeshes.boundingBox.max.z,
      }
    : null
  // TODO(BIM-56): derive plan bounds from scoped/target storeys instead of only the active viewer floor.

  const scopedStoreys = demoRuntime.enabled
    ? storeys.filter((storey) => isStoreyIncludedInDemoScope(storey.name, demoRuntime.config))
    : storeys
  const scopedStoreyIds = new Set(scopedStoreys.map((storey) => storey.id))
  const scopedFixtures = fixtures.filter((fixture) => scopedStoreyIds.has(fixture.storeyId))
  const scopedKitchens = kitchens.filter((kitchen) => scopedStoreyIds.has(kitchen.storeyId))
  const eligibleStoreyIds = new Set(getEligibleStoreyIdsForAutoRisers(storeys, ruleProfile))
  const targetStoreys = storeys.filter((storey) => {
    if (!eligibleStoreyIds.has(storey.id)) return false
    // Honor the demo's explicit floor exclusions (basements/roofs) for the shaft extent so the
    // riser does not extend onto floors the demo deliberately leaves out, while still spanning
    // every eligible in-between floor (not just the routing-scoped floors).
    if (demoRuntime.enabled && isStoreyExcludedFromDemoScope(storey.name, demoRuntime.config)) {
      return false
    }
    return true
  })
  const positions = suggestRiserPositions(scopedFixtures, scopedKitchens, floorPlanBounds, ruleProfile)

  return positions.flatMap((position) =>
    buildRiserStack(
      targetStoreys,
      sourceStoreyId,
      position,
      takeNextRiserLabel(nextRiserLabelRef),
      'detected',
    ),
  )
}
