/**
 * Hard metrics of one gauntlet floor — the gate a round must pass before the
 * blind A/B critic is even asked. Pure and deterministic: the caller (the
 * gauntlet harness) prepares the storey-scoped inputs from the pipeline
 * result; this module only measures and applies the named thresholds.
 *
 * Verdict: `red` when any threshold fails, with one plain-English line per
 * failure in `reds`; `green` otherwise. Thresholds are never softened here —
 * a red round is a legitimate loss.
 *
 * Metrics
 * - `obstruction`: number of our stacks whose plan position probes `blocked`
 *   in the continuity map of the storey (`probeContinuityCell`). Must be 0.
 *   `unknown` probes (point outside the obstruction grid) are counted
 *   separately and reported, never folded into blocked or free.
 * - `stacksRatio`: our stacks on the storey / engineer sanitary stacks
 *   intersecting the storey band. Must lie in
 *   [`STACKS_RATIO_MIN`, `STACKS_RATIO_MAX`].
 * - `meanDistToEngineerStackM`: mean plan distance from each of our stacks to
 *   the nearest engineer sanitary stack intersecting the storey. Reported,
 *   no threshold (the objective gives none).
 * - `branchRatio`: our branch-run plan length / the engineer's horizontal
 *   sanitary run plan length on the storey. Must lie in
 *   [`BRANCH_RATIO_MIN`, `BRANCH_RATIO_MAX`].
 * - `routedFraction`: routed fixtures / positioned fixtures. Must be 1.
 *
 * Branch-length definition (decided on evidence, 2026-09-06). The engineer's
 * horizontals of a storey exist under two storey rules: the literal slab band
 * `[bottom, top)` (V1 comparison scope) and its union with the 1.2 m hang
 * band under the slab (`ENGINEER_HANG_DEPTH_M`, what `buildEngineerFloorDrawing`
 * draws). The ratio that counts uses the UNION — the set the critic sees in
 * the engineer's drawing of the storey — because the hang-band runs do serve
 * this storey's fixtures: on the residential floor (122 hang-band runs) the
 * upstream end of 111 runs / 59.2 m is closer to a fixture of this storey
 * than to one of the storey below (median 1.26 m vs 4.51 m; 41 vs 10 within
 * 1 m), and on the office floor all 35 hang-band runs end within 0.65 m of a
 * fixture of this storey. Both ratios are still reported
 * (`branchRatioLiteralBand`); the literal-band set also carries geometry-less
 * segments placed by IFC containment that no drawing can show. Union lengths
 * are plan-projected (like ours); literal-band lengths are Pset 3D lengths.
 */

import type { PlanPointM } from './engineerComparisonMetrics'

export const OBSTRUCTION_MAX = 0
export const STACKS_RATIO_MIN = 0.6
export const STACKS_RATIO_MAX = 1.5
export const BRANCH_RATIO_MIN = 0.5
export const BRANCH_RATIO_MAX = 2.0
export const ROUTED_FRACTION_REQUIRED = 1
/** Which engineer horizontal set the gating `branchRatio` uses (see the module comment). */
export const BRANCH_RATIO_ENGINEER_SET = 'union' as const

export type GauntletStackProbeStatus = 'blocked' | 'free' | 'unknown'

export interface GauntletStackProbe {
  stackId: string
  stackLabel: string
  status: GauntletStackProbeStatus
}

export interface GauntletMetricsInput {
  /** Continuity probe of each of our stacks on the storey (one per stack). */
  stackProbes: readonly GauntletStackProbe[]
  /** One plan point per our stack on the storey, in the same plan frame as `engineerStacks`. */
  ourStacks: readonly PlanPointM[]
  /** Engineer sanitary stacks intersecting the storey band, same plan frame (metres). */
  engineerStacks: readonly PlanPointM[]
  /** Sum of our branch-run plan lengths on the storey, metres. */
  ourBranchTotalM: number
  /** Engineer horizontal sanitary run totals of the storey under both definitions; null when a set is empty/unknown. */
  engineerBranchTotalM: { union: number | null; literalBand: number | null }
  /** Fixtures of the storey with a plan position, and how many of them were routed to a stack. */
  fixtures: { positioned: number; routed: number }
}

export type GauntletVerdict = 'green' | 'red'

export interface GauntletMetrics {
  /** Our stacks probing `blocked` in the continuity map. */
  obstruction: number
  /** Our stacks whose probe is `unknown` (outside the grid / no grid) — reported, not gated. */
  unknownProbes: number
  /** ours / engineer stacks intersecting the storey; null when the engineer has none. */
  stacksRatio: number | null
  ourStackCount: number
  engineerStackCount: number
  /** Mean plan distance ours → nearest engineer stack; null when either side is empty. */
  meanDistToEngineerStackM: number | null
  /** ours / engineer horizontals, engineer set = `BRANCH_RATIO_ENGINEER_SET`; null when the engineer total is null/0. */
  branchRatio: number | null
  /** Same ratio against the literal storey band, for the record. */
  branchRatioLiteralBand: number | null
  ourBranchTotalM: number
  engineerBranchTotalM: { union: number | null; literalBand: number | null }
  /** routed / positioned; null when nothing is positioned. */
  routedFraction: number | null
  verdict: GauntletVerdict
  /** One line per failed threshold; empty when green. */
  reds: string[]
}

function ratio(numerator: number, denominator: number | null): number | null {
  if (denominator === null || denominator <= 0) return null
  return numerator / denominator
}

function meanNearestDistanceM(ours: readonly PlanPointM[], engineer: readonly PlanPointM[]): number | null {
  if (ours.length === 0 || engineer.length === 0) return null
  let sum = 0
  for (const our of ours) {
    let nearest = Infinity
    for (const eng of engineer) {
      const distance = Math.hypot(our.xM - eng.xM, our.yM - eng.yM)
      if (distance < nearest) nearest = distance
    }
    sum += nearest
  }
  return sum / ours.length
}

function formatRatio(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2)
}

export function computeGauntletMetrics(input: GauntletMetricsInput): GauntletMetrics {
  const reds: string[] = []

  const obstruction = input.stackProbes.filter((probe) => probe.status === 'blocked').length
  const unknownProbes = input.stackProbes.filter((probe) => probe.status === 'unknown').length
  if (obstruction > OBSTRUCTION_MAX) {
    const labels = input.stackProbes
      .filter((probe) => probe.status === 'blocked')
      .map((probe) => probe.stackLabel)
      .join(', ')
    reds.push(`obstruction: ${obstruction} stack(s) sit on a blocked continuity cell (${labels}); must be ${OBSTRUCTION_MAX}`)
  }

  const ourStackCount = input.ourStacks.length
  const engineerStackCount = input.engineerStacks.length
  const stacksRatio = ratio(ourStackCount, engineerStackCount)
  if (stacksRatio === null) {
    reds.push(`stacks: the engineer has no sanitary stack on the storey, ratio undefined (ours ${ourStackCount})`)
  } else if (stacksRatio < STACKS_RATIO_MIN || stacksRatio > STACKS_RATIO_MAX) {
    reds.push(
      `stacks: ratio ${formatRatio(stacksRatio)} (ours ${ourStackCount} / engineer ${engineerStackCount}) outside [${STACKS_RATIO_MIN}, ${STACKS_RATIO_MAX}]`,
    )
  }

  const meanDistToEngineerStackM = meanNearestDistanceM(input.ourStacks, input.engineerStacks)

  const branchRatio = ratio(input.ourBranchTotalM, input.engineerBranchTotalM[BRANCH_RATIO_ENGINEER_SET])
  const branchRatioLiteralBand = ratio(input.ourBranchTotalM, input.engineerBranchTotalM.literalBand)
  if (branchRatio === null) {
    reds.push(`branch length: the engineer has no drawn horizontal run on the storey, ratio undefined (ours ${input.ourBranchTotalM.toFixed(2)} m)`)
  } else if (branchRatio < BRANCH_RATIO_MIN || branchRatio > BRANCH_RATIO_MAX) {
    reds.push(
      `branch length: ratio ${formatRatio(branchRatio)} (ours ${input.ourBranchTotalM.toFixed(2)} m / engineer ${input.engineerBranchTotalM.union!.toFixed(2)} m, ${BRANCH_RATIO_ENGINEER_SET} set) outside [${BRANCH_RATIO_MIN}, ${BRANCH_RATIO_MAX}]`,
    )
  }

  const routedFraction = input.fixtures.positioned > 0 ? input.fixtures.routed / input.fixtures.positioned : null
  if (routedFraction === null) {
    reds.push('routed: no positioned fixture on the storey')
  } else if (routedFraction < ROUTED_FRACTION_REQUIRED) {
    reds.push(
      `routed: ${input.fixtures.routed}/${input.fixtures.positioned} positioned fixtures routed (${routedFraction.toFixed(2)}); must be ${ROUTED_FRACTION_REQUIRED}`,
    )
  }

  return {
    obstruction,
    unknownProbes,
    stacksRatio,
    ourStackCount,
    engineerStackCount,
    meanDistToEngineerStackM,
    branchRatio,
    branchRatioLiteralBand,
    ourBranchTotalM: input.ourBranchTotalM,
    engineerBranchTotalM: { ...input.engineerBranchTotalM },
    routedFraction,
    verdict: reds.length === 0 ? 'green' : 'red',
    reds,
  }
}
