import { ourStackPlanPointsM } from '@/domain/engineerComparisonMetrics'
import { ENGINEER_STACK_STOREY_OVERLAP_MIN_M, stacksIntersectingBand } from '@/domain/engineerPipes'
import type {
  GauntletFixturePoint,
  GauntletMetricsInput as GauntletHardMetricsInput,
  GauntletOurSegment,
} from '@/domain/gauntletMetrics'
import { toMeters } from '@/shared/lengthUnits'
import { viewerPlanToDrawing } from './drawingFrame'
import type { GauntletMetricsInput as GauntletPipelineMetricsInput } from './gauntletFloorPipeline'

/**
 * Adapter from the pipeline's JSON-ready metrics input (`metrics-input.json`)
 * to the pure hard-metrics input of `computeGauntletMetrics`. Storey scope
 * and plan frame follow `computeEngineerComparison` exactly: our stacks are
 * the per-floor riser entries on the host storey (viewer plan x/z, metres);
 * engineer stacks are the sanitary stacks intersecting the engineer storey
 * band, already aligned to the viewer plan by the pipeline.
 *
 * The shared-fixture input is assembled in the DRAWING plan frame (metres,
 * IFC Y up): fixtures and our route segments through `viewerPlanToDrawing`,
 * the engineer's union-set runs as the pipeline exported them
 * (`ifcSourceToDrawing`) — the same pairing the hang-band evidence uses.
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
  const fixtures: GauntletFixturePoint[] = []
  const routedFixtureExpressIds: number[] = []
  for (const assignment of comparisonInput.ourAssignments) {
    if (assignment.unassigned && assignment.reason === 'no-plan-position') continue
    positioned += 1
    if (!assignment.unassigned) {
      routed += 1
      routedFixtureExpressIds.push(assignment.fixtureExpressId)
    }
    const position = assignment.fixturePosition
    if (position === null) continue
    // Unassigned entries carry no units; the fixtures were assigned in the same plan units as our risers.
    const units = assignment.unassigned ? comparisonInput.ourRiserUnits : assignment.units
    const plan = viewerPlanToDrawing({ x: toMeters(position.x, units), z: toMeters(position.z, units) })
    fixtures.push({ expressId: assignment.fixtureExpressId, kind: assignment.kind, xM: plan.xM, yM: plan.yM })
  }

  const ourSegments: GauntletOurSegment[] = []
  for (const floor of comparisonInput.ourBranchRoutes) {
    if (floor.storeyId !== ourStoreyId) continue
    for (const segment of floor.segments) {
      const dx = segment.end.x - segment.start.x
      const dz = segment.end.z - segment.start.z
      ourSegments.push({
        planLengthM: toMeters(Math.hypot(dx, dz), floor.planUnits),
        servedFixtureExpressIds: segment.servedFixtureExpressIds,
      })
    }
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
    sharedFixtures: {
      fixtures,
      routedFixtureExpressIds,
      ourSegments,
      engineerRuns: input.engineerBranchRuns.runs.map((run) => ({
        id: run.expressId,
        upstream: run.upstream,
        diameterMm: run.diameterMm,
        planLengthM: run.planLengthM,
        drainsInto: run.drainsInto,
      })),
    },
  }
}
