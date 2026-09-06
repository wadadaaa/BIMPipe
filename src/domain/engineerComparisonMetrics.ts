/**
 * Pure comparison metrics between BIMPipe's proposed risers/branches and the
 * engineer baseline extracted from a plumbing IFC.
 *
 * Frame assumption (documented, enforced by the caller): our riser positions
 * use the viewer convention (plan = X/Z, Y vertical) while engineer stacks use
 * the IFC source plan frame in metres (xM/yM, Z-up vertical). Distances in
 * this report are only meaningful when the caller has already aligned both
 * inputs to a shared plan frame; frame alignment belongs to the overlay wave,
 * not to this module.
 *
 * Storey scope: riser counts "ours vs engineer" and the nearest-riser distance
 * are computed per open floor — our stacks with an entry on that host storey
 * against the engineer sanitary stacks whose Z-range intersects the matching
 * engineer storey's slab band. Branch lengths follow the same scope: our
 * branch runs on the open floor against the engineer segments the caller
 * selected for that storey. Model-wide totals are reported alongside so the
 * scoped numbers stay explainable. Vent stacks and stubs are counted
 * separately and never enter the sanitary comparison.
 *
 * All lengths in the report are metres, converted here at the boundary from
 * the explicit units carried by the inputs. Empty inputs produce explicit
 * zeros/nulls — never NaN or Infinity.
 */
import type { FloorRoutes } from './branchRouting'
import type { FixtureRiserAssignment } from './assignFixturesToRisers'
import {
  ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
  stacksIntersectingBand,
  type EngineerPipeSegment,
  type EngineerRiserClassification,
  type EngineerRiserStack,
  type MinStackExtentSource,
  type StoreySlabBandM,
} from './engineerPipes'

export type ComparisonPlanUnits = 'mm' | 'm'

/** Structural subset of `Riser` from `src/domain/types.ts` (which satisfies it). */
export interface ComparableOurRiser {
  id: string
  stackId: string
  storeyId: number
  /** Viewer convention: plan = (x, z), y vertical. */
  position: { x: number; y: number; z: number }
}

/**
 * Storey scope of the comparison: our side is the host storey's per-floor
 * riser entries, the engineer side is the engineer-model storey's slab band.
 */
export interface EngineerComparisonStoreyScope {
  /** Host storey whose riser entries define "our stacks on this storey". */
  ourStoreyId: number
  /**
   * Slab band of the matching engineer-model storey (`storeySlabBandM`), in
   * metres; null when the open floor has no counterpart in the engineer model.
   */
  engineerBandM: StoreySlabBandM | null
}

export interface EngineerComparisonInput {
  ourRisers: ComparableOurRiser[]
  /** Units of `ourRisers` positions. Explicit — no magnitude heuristics here. */
  ourRiserUnits: ComparisonPlanUnits
  /** Our computed branch routes (each floor carries its own planUnits). */
  ourBranchRoutes: FloorRoutes[]
  /** Our fixture-to-riser assignment results. */
  ourAssignments: FixtureRiserAssignment[]
  /**
   * Engineer riser classification from `classifyEngineerRiserStacks`, with
   * stack plan positions already aligned to our plan frame (metres).
   */
  engineerRisers: Pick<
    EngineerRiserClassification,
    'sanitaryStacks' | 'ventStacks' | 'stubs' | 'minStackExtentM' | 'minStackExtentSource'
  >
  /** Null when no floor is open: storey-scoped fields become null. */
  storeyScope: EngineerComparisonStoreyScope | null
  /**
   * Engineer segments whose Pset `Length` values make up the engineer branch
   * total. The caller chooses the population — with a storey scope, the
   * horizontal sanitary segments on that storey via
   * `selectEngineerBranchSegments`; without one, model-wide non-vertical
   * segments. This module only sums.
   */
  engineerSegments: EngineerPipeSegment[]
}

export type BranchLengthScope = 'storey' | 'model-wide'

export interface EngineerComparisonReport {
  riserCounts: {
    /** Distinct vertical stacks on our side, model-wide (unique stackId). */
    oursStacksTotal: number
    /** Our stacks with a per-floor entry on the scoped storey; null without scope. */
    oursStacksOnStorey: number | null
    /** Our per-floor riser entries (one Riser per storey per stack), model-wide. */
    oursPerFloorEntries: number
    /** Engineer sanitary stacks model-wide (extent ≥ threshold). */
    engineerStacksTotal: number
    /** Engineer sanitary stacks whose Z-range intersects the scoped storey band. */
    engineerStacksIntersectingStorey: number | null
    /** Engineer vent stacks model-wide; never mixed into the sanitary counts. */
    engineerVentStacksTotal: number
    engineerVentStacksIntersectingStorey: number | null
    /** Vertical runs of either class below the stack extent threshold. */
    engineerStubs: number
  }
  /** How the engineer stack set was defined — printed so the counts are explainable. */
  engineerStackDefinition: {
    minStackExtentM: number
    minStackExtentSource: MinStackExtentSource
    storeyOverlapMinM: number
  }
  /**
   * Storey scope the intersecting counts and the distance refer to; null when
   * no floor is open or the floor has no engineer-model counterpart. The
   * `reason` explains a null scope.
   */
  storeyScope: {
    ourStoreyId: number
    engineerStoreyId: number
    engineerBandBottomM: number
    /** +Infinity (top storey) serialises as null. */
    engineerBandTopM: number | null
  } | null
  storeyScopeReason: string | null
  /**
   * Mean plan distance (metres) from each of our stacks ON THE SCOPED STOREY
   * to the nearest engineer sanitary stack INTERSECTING that storey. Null when
   * there is no scope or either side has no stacks on the storey.
   */
  meanNearestEngineerRiserDistanceM: number | null
  branchLengths: {
    /**
     * `'storey'` when a storey scope is set: ours sums only the branch runs on
     * `storeyScope.ourStoreyId` and the caller is expected to have selected
     * the engineer segments on the matching storey. `'model-wide'` otherwise.
     */
    scope: BranchLengthScope
    /**
     * Sum of our branch-run segments' plan lengths in metres. Plan-projected:
     * excludes the 2% slope component (≤0.02% understatement) and contains no
     * vertical runs, while engineer Pset lengths are true 3D pipe lengths.
     */
    oursTotalM: number
    /** How many of our branch-run segments were summed. */
    oursSegmentCount: number
    /** Sum of non-null engineer `lengthM` values; null when none are present. */
    engineerTotalM: number | null
    /** How many engineer segments were provided (summed + null-length ones). */
    engineerSegmentCount: number
    /** How many provided engineer segments had no Pset Length (honesty count). */
    engineerSegmentsWithNullLength: number
    /** oursTotalM / engineerTotalM; null when engineer total is null or zero. */
    ratioOursToEngineer: number | null
  }
  fixtures: {
    oursAssignedCount: number
    oursUnassignedCount: number
    /**
     * Not computable from this extraction: deriving which fixtures the
     * engineer actually connected would require IfcRelConnectsPorts /
     * distribution-port topology, which W7 does not extract.
     */
    engineerConnectedCount: null
    engineerConnectedNote: string
  }
}

const MM_PER_M = 1000

function toMeters(value: number, units: ComparisonPlanUnits): number {
  return units === 'mm' ? value / MM_PER_M : value
}

interface PlanPointM {
  xM: number
  yM: number
}

/**
 * One representative plan point per our-stack: the arithmetic mean of its
 * per-floor entries' plan positions (viewer x/z), converted to metres.
 * Deterministic: stacks ordered by stackId.
 */
function ourStackPlanPointsM(
  risers: readonly ComparableOurRiser[],
  units: ComparisonPlanUnits,
): PlanPointM[] {
  const byStack = new Map<string, ComparableOurRiser[]>()
  for (const riser of risers) {
    const entries = byStack.get(riser.stackId) ?? []
    entries.push(riser)
    byStack.set(riser.stackId, entries)
  }

  return [...byStack.keys()].sort((a, b) => a.localeCompare(b)).map((stackId) => {
    const entries = byStack.get(stackId)!
    const xM = entries.reduce((sum, entry) => sum + toMeters(entry.position.x, units), 0) / entries.length
    const yM = entries.reduce((sum, entry) => sum + toMeters(entry.position.z, units), 0) / entries.length
    return { xM, yM }
  })
}

function meanNearestDistanceM(ours: PlanPointM[], engineer: readonly PlanPointM[]): number | null {
  if (ours.length === 0 || engineer.length === 0) return null
  let sum = 0
  for (const our of ours) {
    let nearest = Infinity
    for (const eng of engineer) {
      const dx = our.xM - eng.xM
      const dy = our.yM - eng.yM
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < nearest) nearest = distance
    }
    sum += nearest
  }
  return sum / ours.length
}

function ourBranchTotalM(
  routes: FloorRoutes[],
  storeyId: number | null,
): { totalM: number; segmentCount: number } {
  let totalM = 0
  let segmentCount = 0
  for (const floor of routes) {
    if (storeyId !== null && floor.storeyId !== storeyId) continue
    for (const segment of floor.segments) {
      const dx = segment.end.x - segment.start.x
      const dz = segment.end.z - segment.start.z
      totalM += toMeters(Math.sqrt(dx * dx + dz * dz), floor.planUnits)
      segmentCount += 1
    }
  }
  return { totalM, segmentCount }
}

/**
 * Computes the riser/branch/fixture comparison report between our proposal
 * and the engineer baseline. Pure and deterministic; output is JSON-ready for
 * the Decisions/debug display (later wave).
 */
export function computeEngineerComparison(input: EngineerComparisonInput): EngineerComparisonReport {
  const ourStacksTotal = ourStackPlanPointsM(input.ourRisers, input.ourRiserUnits)
  const { sanitaryStacks, ventStacks, stubs } = input.engineerRisers

  // Storey scope: both sides restricted to the open floor, or nothing scoped.
  let oursStacksOnStorey: PlanPointM[] | null = null
  let engineerOnStorey: EngineerRiserStack[] | null = null
  let ventOnStorey: EngineerRiserStack[] | null = null
  let storeyScope: EngineerComparisonReport['storeyScope'] = null
  let storeyScopeReason: string | null = null
  if (input.storeyScope === null) {
    storeyScopeReason = 'No floor is open; storey-scoped counts and the riser distance are not computed.'
  } else if (input.storeyScope.engineerBandM === null) {
    storeyScopeReason =
      'The open floor has no counterpart storey in the engineer model; storey-scoped counts and the riser distance are not computed.'
  } else {
    const band = input.storeyScope.engineerBandM
    oursStacksOnStorey = ourStackPlanPointsM(
      input.ourRisers.filter((riser) => riser.storeyId === input.storeyScope!.ourStoreyId),
      input.ourRiserUnits,
    )
    engineerOnStorey = stacksIntersectingBand(sanitaryStacks, band, ENGINEER_STACK_STOREY_OVERLAP_MIN_M)
    ventOnStorey = stacksIntersectingBand(ventStacks, band, ENGINEER_STACK_STOREY_OVERLAP_MIN_M)
    storeyScope = {
      ourStoreyId: input.storeyScope.ourStoreyId,
      engineerStoreyId: band.storeyId,
      engineerBandBottomM: band.bottomM,
      engineerBandTopM: Number.isFinite(band.topM) ? band.topM : null,
    }
  }

  let engineerTotalM: number | null = null
  let engineerSegmentsWithNullLength = 0
  for (const segment of input.engineerSegments) {
    if (segment.lengthM === null) {
      engineerSegmentsWithNullLength += 1
      continue
    }
    engineerTotalM = (engineerTotalM ?? 0) + segment.lengthM
  }

  const branchScope: BranchLengthScope = input.storeyScope === null ? 'model-wide' : 'storey'
  const { totalM: oursTotalM, segmentCount: oursSegmentCount } = ourBranchTotalM(
    input.ourBranchRoutes,
    input.storeyScope?.ourStoreyId ?? null,
  )
  const ratioOursToEngineer =
    engineerTotalM !== null && engineerTotalM > 0 ? oursTotalM / engineerTotalM : null

  let oursAssignedCount = 0
  let oursUnassignedCount = 0
  for (const assignment of input.ourAssignments) {
    if (assignment.unassigned) oursUnassignedCount += 1
    else oursAssignedCount += 1
  }

  return {
    riserCounts: {
      oursStacksTotal: ourStacksTotal.length,
      oursStacksOnStorey: oursStacksOnStorey === null ? null : oursStacksOnStorey.length,
      oursPerFloorEntries: input.ourRisers.length,
      engineerStacksTotal: sanitaryStacks.length,
      engineerStacksIntersectingStorey: engineerOnStorey === null ? null : engineerOnStorey.length,
      engineerVentStacksTotal: ventStacks.length,
      engineerVentStacksIntersectingStorey: ventOnStorey === null ? null : ventOnStorey.length,
      engineerStubs: stubs.length,
    },
    engineerStackDefinition: {
      minStackExtentM: input.engineerRisers.minStackExtentM,
      minStackExtentSource: input.engineerRisers.minStackExtentSource,
      storeyOverlapMinM: ENGINEER_STACK_STOREY_OVERLAP_MIN_M,
    },
    storeyScope,
    storeyScopeReason,
    meanNearestEngineerRiserDistanceM:
      oursStacksOnStorey === null || engineerOnStorey === null
        ? null
        : meanNearestDistanceM(oursStacksOnStorey, engineerOnStorey),
    branchLengths: {
      scope: branchScope,
      oursTotalM,
      oursSegmentCount,
      engineerTotalM,
      engineerSegmentCount: input.engineerSegments.length,
      engineerSegmentsWithNullLength,
      ratioOursToEngineer,
    },
    fixtures: {
      oursAssignedCount,
      oursUnassignedCount,
      engineerConnectedCount: null,
      engineerConnectedNote:
        'Engineer-connected fixture count is not derivable from pipe segments and psets alone; it requires IfcRelConnectsPorts/port topology, which this extraction does not read.',
    },
  }
}
