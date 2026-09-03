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
 * All lengths in the report are metres, converted here at the boundary from
 * the explicit units carried by the inputs. Empty inputs produce explicit
 * zeros/nulls — never NaN or Infinity.
 */
import type { FloorRoutes } from './branchRouting'
import type { FixtureRiserAssignment } from './assignFixturesToRisers'
import type { EngineerPipeSegment, EngineerRiserStack } from './engineerPipes'

export type ComparisonPlanUnits = 'mm' | 'm'

/** Structural subset of `Riser` from `src/domain/types.ts` (which satisfies it). */
export interface ComparableOurRiser {
  id: string
  stackId: string
  storeyId: number
  /** Viewer convention: plan = (x, z), y vertical. */
  position: { x: number; y: number; z: number }
}

export interface EngineerComparisonInput {
  ourRisers: ComparableOurRiser[]
  /** Units of `ourRisers` positions. Explicit — no magnitude heuristics here. */
  ourRiserUnits: ComparisonPlanUnits
  /** Our computed branch routes (each floor carries its own planUnits). */
  ourBranchRoutes: FloorRoutes[]
  /** Our fixture-to-riser assignment results. */
  ourAssignments: FixtureRiserAssignment[]
  /** Engineer riser stacks from `groupEngineerRiserStacks` (already metres). */
  engineerRisers: EngineerRiserStack[]
  /**
   * Engineer segments whose Pset `Length` values make up the engineer branch
   * total. The caller chooses the population (e.g. non-vertical segments of
   * one system, via `isVerticalEngineerSegment`); this module only sums.
   */
  engineerSegments: EngineerPipeSegment[]
}

export interface EngineerComparisonReport {
  riserCounts: {
    /** Distinct vertical stacks on our side (unique stackId). */
    oursStacks: number
    /** Our per-floor riser entries (one Riser per storey per stack). */
    oursPerFloorEntries: number
    engineerStacks: number
  }
  /**
   * Mean plan distance (metres) from each of our riser stacks to the nearest
   * engineer stack. Null when either side has no stacks.
   */
  meanNearestEngineerRiserDistanceM: number | null
  branchLengths: {
    /**
     * Sum of our route segments' plan lengths in metres. Plan-projected:
     * excludes the 2% slope component (≤0.02% understatement) and contains no
     * vertical runs, while engineer Pset lengths are true 3D pipe lengths.
     */
    oursTotalM: number
    /** Sum of non-null engineer `lengthM` values; null when none are present. */
    engineerTotalM: number | null
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
  risers: ComparableOurRiser[],
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

function meanNearestDistanceM(ours: PlanPointM[], engineer: PlanPointM[]): number | null {
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

function ourBranchTotalM(routes: FloorRoutes[]): number {
  let totalM = 0
  for (const floor of routes) {
    for (const segment of floor.segments) {
      const dx = segment.end.x - segment.start.x
      const dz = segment.end.z - segment.start.z
      totalM += toMeters(Math.sqrt(dx * dx + dz * dz), floor.planUnits)
    }
  }
  return totalM
}

/**
 * Computes the riser/branch/fixture comparison report between our proposal
 * and the engineer baseline. Pure and deterministic; output is JSON-ready for
 * the Decisions/debug display (later wave).
 */
export function computeEngineerComparison(input: EngineerComparisonInput): EngineerComparisonReport {
  const ourStacks = ourStackPlanPointsM(input.ourRisers, input.ourRiserUnits)
  const engineerPoints: PlanPointM[] = input.engineerRisers.map((stack) => ({
    xM: stack.xM,
    yM: stack.yM,
  }))

  let engineerTotalM: number | null = null
  let engineerSegmentsWithNullLength = 0
  for (const segment of input.engineerSegments) {
    if (segment.lengthM === null) {
      engineerSegmentsWithNullLength += 1
      continue
    }
    engineerTotalM = (engineerTotalM ?? 0) + segment.lengthM
  }

  const oursTotalM = ourBranchTotalM(input.ourBranchRoutes)
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
      oursStacks: ourStacks.length,
      oursPerFloorEntries: input.ourRisers.length,
      engineerStacks: input.engineerRisers.length,
    },
    meanNearestEngineerRiserDistanceM: meanNearestDistanceM(ourStacks, engineerPoints),
    branchLengths: {
      oursTotalM,
      engineerTotalM,
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
