import type { PlanPoint } from './branchRouting'
import type { StoreyId } from './types'
import type { WetCore, WetCorePlanUnits, WetCoreStackPlacement } from './wetCores'

/**
 * Core collectors (R1): a wet core whose stack cannot be placed on a free /
 * shaft cell within the snap distance (V3's flagged-centroid fallback: "every
 * cell within MAX_SNAP is obstructed") is NOT given a stack on a blocked cell.
 * Instead its fixtures drain through a collector to the nearest neighbouring
 * core that HAS a valid stack, when that run is within the typology's
 * collector limit (`TYPOLOGY_PLACEMENT_RULES[t].coreCollectorMaxM`).
 *
 * This reproduces the engineer's pattern on real floors: fewer stacks, longer
 * under-slab runs gathering several wet rooms, no stack through a wall or a
 * solid slab. The flagged fallback stays for cores with no valid stack within
 * the limit — still visible, never silently dropped.
 *
 * Where it engages: only for placements that are flagged obstructed, which
 * only a continuity map with an obstruction grid on the storey can produce.
 * Storeys without a grid (the bundled Duplex sample) never reach this rule,
 * so their suggestion is byte-identical.
 *
 * Geometry: the collector is the Manhattan L-run from the gathered core's
 * centroid (its junction) to the receiving stack; `computeBranchRoutes`
 * draws it (`role: 'collector-run'`). Approximation: it is not routed around
 * walls / columns — no obstacle avoidance in V0.
 */
export interface CoreCollector {
  /** `core-collector|<gathered core id>` — deterministic per input. */
  id: string
  storeyId: StoreyId
  /** The gathered core (no stack of its own). */
  coreId: string
  /** Fixtures of the gathered core, sorted ascending. */
  memberExpressIds: number[]
  /** Core whose stack receives the collector. */
  targetCoreId: string
  /** Where the gathered core's fixtures meet: its centroid. */
  junction: PlanPoint
  /** Stack position of the receiving core. */
  targetStackPosition: PlanPoint
  /** Manhattan plan length junction → receiving stack, in `units`. */
  lengthManhattan: number
  units: WetCorePlanUnits
  reason: string
}

export interface CoreCollectorCandidate {
  core: WetCore
  placement: WetCoreStackPlacement
}

export interface GatherObstructedCoresOptions {
  units: WetCorePlanUnits
  /** Longest collector (Manhattan, in `units`); null disables gathering. */
  maxCollectorLength: number | null
}

export interface GatherObstructedCoresResult {
  collectors: CoreCollector[]
  /** Obstructed cores that stay flagged: no valid stack within the limit. */
  unreachable: Array<{ coreId: string; reason: string }>
}

/** An obstructed core: V3's flagged centroid (every cell in range blocked). */
export function isObstructedPlacement(placement: WetCoreStackPlacement): boolean {
  return placement.rule === 'centroid' && placement.flagged
}

/**
 * Pure and deterministic: for every obstructed core on a storey, the nearest
 * (Manhattan from the core centroid to the stack) non-flagged core of the same
 * storey within `maxCollectorLength` receives it. Ties → lower target core id.
 * Gathered cores never receive other cores (one hop only).
 */
export function gatherObstructedCores(
  candidates: readonly CoreCollectorCandidate[],
  options: GatherObstructedCoresOptions,
): GatherObstructedCoresResult {
  const collectors: CoreCollector[] = []
  const unreachable: Array<{ coreId: string; reason: string }> = []
  if (options.maxCollectorLength === null) return { collectors, unreachable }
  const limit = options.maxCollectorLength
  const limitLabel = formatLength(limit, options.units)

  const obstructed = candidates.filter((candidate) => isObstructedPlacement(candidate.placement))
  const valid = candidates.filter((candidate) => !candidate.placement.flagged)

  for (const { core } of obstructed) {
    const targets = valid
      .filter((candidate) => candidate.core.storeyId === core.storeyId && candidate.core.id !== core.id)
      .map((candidate) => ({
        candidate,
        length:
          Math.abs(core.centroid.x - candidate.placement.position.x) +
          Math.abs(core.centroid.z - candidate.placement.position.z),
      }))
      .sort((a, b) => a.length - b.length || a.candidate.core.id.localeCompare(b.candidate.core.id))
    const nearest = targets[0]
    if (nearest === undefined || nearest.length > limit) {
      unreachable.push({
        coreId: core.id,
        reason:
          nearest === undefined
            ? `no other core with a valid stack on the storey; the flagged centroid stack stays`
            : `nearest core with a valid stack (${nearest.candidate.core.id}) is ${formatLength(nearest.length, options.units)} away, beyond the ${limitLabel} collector limit; the flagged centroid stack stays`,
      })
      continue
    }
    collectors.push({
      id: `core-collector|${core.id}`,
      storeyId: core.storeyId,
      coreId: core.id,
      memberExpressIds: [...core.memberExpressIds].sort((a, b) => a - b),
      targetCoreId: nearest.candidate.core.id,
      junction: { ...core.centroid },
      targetStackPosition: { ...nearest.candidate.placement.position },
      lengthManhattan: nearest.length,
      units: options.units,
      reason:
        `every cell within snap range of the core is obstructed; gathered into the stack of ${nearest.candidate.core.id} ` +
        `through a ${formatLength(nearest.length, options.units)} collector (limit ${limitLabel}) instead of a stack on a blocked cell`,
    })
  }
  return { collectors, unreachable }
}

/**
 * Fixture → core-of-its-stack map for assignment: members of a gathered core
 * belong, for routing purposes, to the receiving core. Shared by the page and
 * the gauntlet pipeline so both wire membership identically.
 */
export function buildFixtureCoreIds(
  cores: readonly Pick<WetCore, 'id' | 'memberExpressIds'>[],
  coreCollectors: readonly Pick<CoreCollector, 'coreId' | 'targetCoreId'>[],
): Map<number, string> {
  const targetByCoreId = new Map(coreCollectors.map((collector) => [collector.coreId, collector.targetCoreId]))
  const fixtureCoreIds = new Map<number, string>()
  for (const core of cores) {
    const coreId = targetByCoreId.get(core.id) ?? core.id
    for (const expressId of core.memberExpressIds) fixtureCoreIds.set(expressId, coreId)
  }
  return fixtureCoreIds
}

function formatLength(value: number, units: WetCorePlanUnits): string {
  return units === 'mm' ? `${Math.round(value)} mm` : `${value.toFixed(2)} m`
}
