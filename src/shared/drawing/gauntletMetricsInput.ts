import { ourStackPlanPointsM } from '@/domain/engineerComparisonMetrics'
import { ENGINEER_STACK_STOREY_OVERLAP_MIN_M, stacksIntersectingBand } from '@/domain/engineerPipes'
import type { GauntletMetricsInput as GauntletHardMetricsInput } from '@/domain/gauntletMetrics'
import type { GauntletMetricsInput as GauntletPipelineMetricsInput } from './gauntletFloorPipeline'

/**
 * Adapter from the pipeline's JSON-ready metrics input (`metrics-input.json`)
 * to the pure hard-metrics input of `computeGauntletMetrics`. Storey scope
 * and plan frame follow `computeEngineerComparison` exactly: our stacks are
 * the per-floor riser entries on the host storey (viewer plan x/z, metres);
 * engineer stacks are the sanitary stacks intersecting the engineer storey
 * band, already aligned to the viewer plan by the pipeline.
 */
export function gauntletMetricsInputFromPipeline(input: GauntletPipelineMetricsInput): GauntletHardMetricsInput {
  const { comparisonInput, report } = input
  const band = comparisonInput.storeyScope?.engineerBandM ?? null
  const ourStoreyId = comparisonInput.storeyScope?.ourStoreyId ?? input.hostStorey.id
  const ourStacks = ourStackPlanPointsM(
    comparisonInput.ourRisers.filter((riser) => riser.storeyId === ourStoreyId),
    comparisonInput.ourRiserUnits,
  )
  const engineerStacks =
    band === null
      ? []
      : stacksIntersectingBand(comparisonInput.engineerRisers.sanitaryStacks, band, ENGINEER_STACK_STOREY_OVERLAP_MIN_M).map(
          (stack) => ({ xM: stack.xM, yM: stack.yM }),
        )

  let positioned = 0
  let routed = 0
  for (const assignment of comparisonInput.ourAssignments) {
    if (assignment.unassigned && assignment.reason === 'no-plan-position') continue
    positioned += 1
    if (!assignment.unassigned) routed += 1
  }

  const { union, literalBand } = input.engineerBranchRuns
  return {
    stackProbes: input.continuityProbes.map((probe) => ({
      stackId: probe.stackId,
      stackLabel: probe.stackLabel,
      status: probe.probe.status,
    })),
    ourStacks,
    engineerStacks,
    ourBranchTotalM: report.branchLengths.oursTotalM,
    engineerBranchTotalM: {
      union: union.segments === 0 ? null : union.totalM,
      literalBand: literalBand.segments === 0 ? null : literalBand.totalM,
    },
    fixtures: { positioned, routed },
  }
}
