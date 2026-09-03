import type { Fixture, KitchenArea, Riser, Storey, StoreyId } from '@/domain/types'
import type { ContinuityMap } from '@/domain/continuityMap'
import {
  computeRiserStackExtent,
  type RiserStackExtent,
  type StackExtentFixture,
  type StackExtentPlanUnits,
} from '@/domain/riserStackExtent'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { buildRiserStack } from './buildRiserStacks'
import { getEligibleStoreyIdsForAutoRisers } from './floorClassification'
import {
  suggestRiserPositions,
  suggestWetCoreRiserPositions,
  type ContinuitySnapOptions,
  type RiserContinuitySnap,
  type WetCoreSuggestOptions,
  type WetCoreSuggestedPosition,
} from './suggestRisers'
import type { WetCore, WetCoreStackPlacement } from '@/domain/wetCores'
import type { Point3D } from './planGeometry'
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
 * when the user inspects an out-of-scope floor (e.g. קומה 3). Callers that can supply
 * whole-building fixtures can bound each stack instead via the `stackExtent` option of
 * {@link buildSuggestedRisersWithSnap} (V4).
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

/**
 * Per-stack vertical extent (V4). When supplied, each auto-suggested stack
 * spans the storeys chosen by `computeRiserStackExtent` (collector → last
 * storey with a matching core, never into roof/technical storeys) instead of
 * every eligible storey of the building. Requires positioned fixtures for the
 * WHOLE building, not just the source floor — see `toStackExtentFixtures`.
 */
export interface StackExtentOptions {
  /** Every positioned fixture/kitchen of the building, all storeys. */
  buildingFixtures: StackExtentFixture[]
  /** Unit of the plan coordinates in `buildingFixtures` and the suggested positions. */
  planUnits: StackExtentPlanUnits
  /** W5 continuity map for the obstruction bound; omitted → bound skipped. */
  continuityMap?: ContinuityMap | null
  /** Explicit collector storey; omitted → lowest non-technical storey. */
  collectorStoreyId?: StoreyId | null
}

/** Extent decision of one suggested riser stack (V4), for the UI/debug JSON. */
export interface SuggestedRiserStackExtent {
  stackLabel: string
  extent: RiserStackExtent
}

export interface SuggestedRisersWithSnap {
  risers: Riser[]
  /**
   * One entry per suggested stack, in suggestion order. Empty when snapping
   * was requested but nothing was suggested; misses are included with their
   * reasons — never silently dropped.
   */
  snapOutcomes: SuggestedRiserSnapOutcome[]
  /**
   * One entry per suggested stack when `stackExtent` was supplied (with the
   * reasons for every stop), empty otherwise.
   */
  stackExtents: SuggestedRiserStackExtent[]
}

/**
 * Same as {@link buildSuggestedRisers} but optionally snaps each suggestion to
 * the continuity map (W5) and/or bounds each stack's vertical extent (V4).
 * With `continuitySnap` and `stackExtent` undefined the riser output is
 * byte-identical to the plain function.
 *
 * Only auto stacks are produced here (`source: 'detected'`); manual risers are
 * never an input, so the extent can never touch them.
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
  stackExtent?: StackExtentOptions,
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
  const stackExtents: SuggestedRiserStackExtent[] = []
  for (const position of positions) {
    const built = buildStackForPosition(
      { storeys, sourceStoreyId, targetStoreys, demoRuntime, stackExtent },
      position,
      nextLabel(),
    )
    risers.push(...built.risers)
    if (built.extent !== null) stackExtents.push({ stackLabel: built.stackLabel, extent: built.extent })
    if (position.snap !== undefined) snapOutcomes.push({ stackLabel: built.stackLabel, snap: position.snap })
  }
  return { risers, snapOutcomes, stackExtents }
}

// ---------------------------------------------------------------------------
// Wet-core path (V3)
// ---------------------------------------------------------------------------

/** One suggested stack of the wet-core path with everything the UI needs to explain it. */
export type WetCoreSuggestedStack =
  | {
      anchor: 'wet-core'
      stackId: string
      stackLabel: string
      storeyId: StoreyId
      core: WetCore
      placement: WetCoreStackPlacement
      position: Point3D
    }
  | {
      anchor: 'kitchen'
      stackId: string
      stackLabel: string
      storeyId: StoreyId
      kitchenExpressId: number
      snap: RiserContinuitySnap | null
      position: Point3D
    }

export interface WetCoreSuggestedRisers {
  risers: Riser[]
  /** One entry per stack, in suggestion order (cores first, then kitchens). */
  stacks: WetCoreSuggestedStack[]
  /** Wet cores of the source storey, in suggestion order (same as the core stacks). */
  cores: WetCore[]
  /** Continuity-snap view of the stacks, compatible with the W5 debug JSON. */
  snapOutcomes: SuggestedRiserSnapOutcome[]
  /** One entry per stack when `stackExtent` was supplied, empty otherwise. */
  stackExtents: SuggestedRiserStackExtent[]
  /** Explicit notes about inputs that could not be used. */
  diagnostics: string[]
}

export interface BuildWetCoreSuggestedRisersOptions {
  storeys: Storey[]
  sourceStoreyId: StoreyId
  /** Fixtures of the source storey (all kinds). */
  fixtures: Fixture[]
  /** Kitchen areas of the source storey. */
  kitchens: KitchenArea[]
  floorMeshes: FloorMeshes | null
  nextLabel: () => string
  wetCore: WetCoreSuggestOptions
  stackExtent?: StackExtentOptions
  /**
   * Cores already represented by a preserved (moved) stack from an earlier
   * suggest. No stack is built and no label consumed for them; they still
   * appear in `cores` so fixture membership keeps routing to the moved stack.
   */
  preservedCoreIds?: ReadonlySet<string>
}

/**
 * Wet-core riser suggestion (V3): exactly one stack per wet core of the source
 * storey (see `src/domain/wetCores.ts` for the clustering and placement rules)
 * plus one dedicated stack per kitchen area. Not demo-scoped: demo mode keeps
 * the toilet-anchored {@link buildSuggestedRisersWithSnap}; the page gates the
 * two paths on `demoRuntime.enabled`.
 *
 * Stacks span every eligible storey of the building unless `stackExtent` (V4)
 * bounds them. Only auto stacks are produced (`source: 'detected'`).
 */
export function buildWetCoreSuggestedRisers(options: BuildWetCoreSuggestedRisersOptions): WetCoreSuggestedRisers {
  const { storeys, sourceStoreyId, fixtures, kitchens, floorMeshes, nextLabel, stackExtent } = options
  const ruleProfile = DEFAULT_RISER_PLACEMENT_RULE_PROFILE
  const floorPlanBounds = floorMeshes
    ? {
        minX: floorMeshes.boundingBox.min.x,
        maxX: floorMeshes.boundingBox.max.x,
        minZ: floorMeshes.boundingBox.min.z,
        maxZ: floorMeshes.boundingBox.max.z,
      }
    : null
  const sourceFixtures = fixtures.filter((fixture) => fixture.storeyId === sourceStoreyId)
  const sourceKitchens = kitchens.filter((kitchen) => kitchen.storeyId === sourceStoreyId)
  const eligibleStoreyIds = new Set(getEligibleStoreyIdsForAutoRisers(storeys, ruleProfile))
  const targetStoreys = storeys.filter((storey) => eligibleStoreyIds.has(storey.id))
  const demoRuntime: ReturnType<typeof getDemoRuntimeConfig> = { enabled: false }

  const suggestion = suggestWetCoreRiserPositions(
    sourceFixtures,
    sourceKitchens,
    floorPlanBounds,
    ruleProfile,
    options.wetCore,
  )

  const risers: Riser[] = []
  const stacks: WetCoreSuggestedStack[] = []
  const snapOutcomes: SuggestedRiserSnapOutcome[] = []
  const stackExtents: SuggestedRiserStackExtent[] = []
  const diagnostics = [...suggestion.diagnostics]
  const preservedCoreIds = options.preservedCoreIds ?? new Set<string>()
  for (const position of suggestion.positions) {
    // A core whose stack the user moved keeps that stack (overrides win); no
    // fresh auto stack is built and no label is consumed, so labels stay
    // contiguous across re-suggests. Skipped BEFORE `nextLabel()`.
    if (position.anchor === 'wet-core' && preservedCoreIds.has(position.core.id)) {
      diagnostics.push(
        `core ${position.core.kindsFingerprint} (${position.core.memberExpressIds.length} fixtures) keeps its moved stack; no new auto stack`,
      )
      continue
    }
    const built = buildStackForPosition(
      { storeys, sourceStoreyId, targetStoreys, demoRuntime, stackExtent },
      position,
      nextLabel(),
      position.anchor === 'wet-core' ? position.core.kindsFingerprint : null,
    )
    risers.push(...built.risers)
    if (built.extent !== null) stackExtents.push({ stackLabel: built.stackLabel, extent: built.extent })
    const stackId = built.risers[0]?.stackId ?? ''
    const point = { x: position.x, y: position.y, z: position.z }
    stacks.push(toWetCoreStack(position, stackId, built.stackLabel, point))
    const snap = toSnapOutcome(position)
    if (snap !== null) snapOutcomes.push({ stackLabel: built.stackLabel, snap })
  }
  return { risers, stacks, cores: suggestion.cores, snapOutcomes, stackExtents, diagnostics }
}

function toWetCoreStack(
  position: WetCoreSuggestedPosition,
  stackId: string,
  stackLabel: string,
  point: Point3D,
): WetCoreSuggestedStack {
  if (position.anchor === 'wet-core') {
    return {
      anchor: 'wet-core',
      stackId,
      stackLabel,
      storeyId: position.core.storeyId,
      core: position.core,
      placement: position.placement,
      position: point,
    }
  }
  return {
    anchor: 'kitchen',
    stackId,
    stackLabel,
    storeyId: position.storeyId,
    kitchenExpressId: position.kitchenExpressId,
    snap: position.snap,
    position: point,
  }
}

/** Expresses a wet-core placement in the W5 snap vocabulary so existing debug views keep working. */
function toSnapOutcome(position: WetCoreSuggestedPosition): RiserContinuitySnap | null {
  if (position.anchor === 'kitchen') return position.snap
  const { placement, core } = position
  const original: Point3D = { x: core.centroid.x, y: core.centroidY, z: core.centroid.z }
  switch (placement.rule) {
    case 'shaft':
      return { status: 'snapped', target: 'shaft', shaftId: placement.shaftId, distance: placement.distance, original }
    case 'free-cell':
      return { status: 'snapped', target: 'free-cell', cell: placement.cell, distance: placement.distance, original }
    case 'wall-side-edge':
      return null
    case 'centroid':
      return placement.flagged ? { status: 'snapMiss', reason: placement.reason } : null
  }
}

// ---------------------------------------------------------------------------
// Shared stack construction
// ---------------------------------------------------------------------------

interface StackBuildContext {
  storeys: Storey[]
  sourceStoreyId: StoreyId
  /** Eligibility-based storey list used when no `stackExtent` is supplied. */
  targetStoreys: Storey[]
  demoRuntime: ReturnType<typeof getDemoRuntimeConfig>
  stackExtent: StackExtentOptions | undefined
}

function buildStackForPosition(
  context: StackBuildContext,
  position: Point3D,
  stackLabel: string,
  /** Wet-core anchor fingerprint; null for toilet/kitchen-anchored stacks (radius-derived). */
  anchorCoreFingerprint: string | null = null,
): { risers: Riser[]; stackLabel: string; extent: RiserStackExtent | null } {
  const { storeys, sourceStoreyId, demoRuntime, stackExtent } = context
  let stackStoreys = context.targetStoreys
  let extent: RiserStackExtent | null = null
  if (stackExtent !== undefined) {
    // The extent (after snapping, so it is evaluated at the final XY)
    // replaces the eligibility-based storey list; demo exclusions still
    // apply because they are explicit user configuration.
    extent = computeRiserStackExtent({
      storeys,
      fixtures: stackExtent.buildingFixtures,
      anchorStoreyId: sourceStoreyId,
      stackXY: { x: position.x, z: position.z },
      planUnits: stackExtent.planUnits,
      continuityMap: stackExtent.continuityMap,
      collectorStoreyId: stackExtent.collectorStoreyId,
      anchorCoreFingerprint,
    })
    stackStoreys = resolveExtentStoreys(storeys, extent, demoRuntime)
  }
  // Pass a plain point so optional provenance fields never leak into risers.
  const risers = buildRiserStack(
    stackStoreys,
    sourceStoreyId,
    { x: position.x, y: position.y, z: position.z },
    stackLabel,
    'detected',
  )
  return { risers, stackLabel, extent }
}

/** Storey objects for the extent's ids (bottom → top), minus demo-excluded floors. */
function resolveExtentStoreys(
  storeys: Storey[],
  extent: RiserStackExtent,
  demoRuntime: ReturnType<typeof getDemoRuntimeConfig>,
): Storey[] {
  const byId = new Map(storeys.map((storey) => [storey.id, storey]))
  return extent.storeyIds.flatMap((storeyId) => {
    const storey = byId.get(storeyId)
    if (storey === undefined) return []
    if (demoRuntime.enabled && isStoreyExcludedFromDemoScope(storey.name, demoRuntime.config)) return []
    return [storey]
  })
}
