import type { Fixture, KitchenArea, Riser, Storey, StoreyId } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { buildRiserStack } from './buildRiserStacks'
import { getEligibleStoreyIdsForAutoRisers } from './floorClassification'
import {
  suggestRiserPositions,
  type ContinuitySnapOptions,
  type RiserContinuitySnap,
} from './suggestRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'
import {
  getDemoRuntimeConfig,
  isStoreyExcludedFromDemoScope,
  isStoreyIncludedInDemoScope,
} from '@/shared/demoConfig'

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
 *
 * `nextLabel` is injected by the caller (the page owns the label counter), keeping this a pure,
 * dependency-free domain function.
 */
export function buildSuggestedRisers(
  storeys: Storey[],
  sourceStoreyId: StoreyId,
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  floorMeshes: FloorMeshes | null,
  nextLabel: () => string,
  demoRuntime: ReturnType<typeof getDemoRuntimeConfig>,
): Riser[] {
  return buildSuggestedRisersWithSnap(
    storeys,
    sourceStoreyId,
    fixtures,
    kitchens,
    floorMeshes,
    nextLabel,
    demoRuntime,
  ).risers
}

/** Continuity-snap outcome of one suggested riser stack (W5), for the UI/debug JSON. */
export interface SuggestedRiserSnapOutcome {
  stackLabel: string
  snap: RiserContinuitySnap
}

export interface SuggestedRisersWithSnap {
  risers: Riser[]
  /**
   * One entry per suggested stack, in suggestion order. Empty when snapping
   * was requested but nothing was suggested; misses are included with their
   * reasons — never silently dropped.
   */
  snapOutcomes: SuggestedRiserSnapOutcome[]
}

/**
 * Same as {@link buildSuggestedRisers} but optionally snaps each suggestion to
 * the continuity map (W5). With `continuitySnap` undefined the riser output is
 * byte-identical to the plain function (the domain flag guarantees it).
 */
export function buildSuggestedRisersWithSnap(
  storeys: Storey[],
  sourceStoreyId: StoreyId,
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  floorMeshes: FloorMeshes | null,
  nextLabel: () => string,
  demoRuntime: ReturnType<typeof getDemoRuntimeConfig>,
  continuitySnap?: ContinuitySnapOptions,
): SuggestedRisersWithSnap {
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
  const positions = suggestRiserPositions(
    scopedFixtures,
    scopedKitchens,
    floorPlanBounds,
    ruleProfile,
    continuitySnap === undefined ? undefined : { continuitySnap },
  )

  const risers: Riser[] = []
  const snapOutcomes: SuggestedRiserSnapOutcome[] = []
  for (const position of positions) {
    const stackLabel = nextLabel()
    // Pass a plain point so the optional `snap` field never leaks into risers.
    risers.push(
      ...buildRiserStack(
        targetStoreys,
        sourceStoreyId,
        { x: position.x, y: position.y, z: position.z },
        stackLabel,
        'detected',
      ),
    )
    if (position.snap !== undefined) snapOutcomes.push({ stackLabel, snap: position.snap })
  }
  return { risers, snapOutcomes }
}
