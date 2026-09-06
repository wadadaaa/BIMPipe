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
 *   sanitary run plan length on the storey, both restricted to the fixtures
 *   BOTH sides serve (the shared set, see below). Must lie in
 *   [`BRANCH_RATIO_MIN`, `BRANCH_RATIO_MAX`]. The same ratio over the full
 *   sets is reported alongside (`branchRatioFullUnion`,
 *   `branchRatioLiteralBand`), never gated.
 * - `routedFraction`: routed fixtures / positioned fixtures. Must be 1.
 * - coverage (reported, not gated): `fixturesOnlyEngineerServes` (detected
 *   fixtures the engineer serves and we do not — our placement gap),
 *   `fixturesOnlyWeServe` (fixtures we route that no engineer run reaches —
 *   the engineer model's gap) and `engineerLeafEndsWithoutFixture` (upstream
 *   free ends of the engineer's runs with no detected fixture nearby — our
 *   detection gap, or fixtures the model does not carry).
 *
 * Engineer horizontal set (decided on evidence, 2026-09-06). The engineer's
 * horizontals of a storey exist under two storey rules: the literal slab band
 * `[bottom, top)` (V1 comparison scope) and its union with the 1.2 m hang
 * band under the slab (`ENGINEER_HANG_DEPTH_M`, what `buildEngineerFloorDrawing`
 * draws). The set that counts is the UNION — the set the critic sees in the
 * engineer's drawing of the storey — because the hang-band runs do serve this
 * storey's fixtures: on the residential floor (122 hang-band runs) the
 * upstream end of 111 runs / 59.2 m is closer to a fixture of this storey
 * than to one of the storey below (median 1.26 m vs 4.51 m; 41 vs 10 within
 * 1 m), and on the office floor all 35 hang-band runs end within 0.65 m of a
 * fixture of this storey. The literal-band set also carries geometry-less
 * segments placed by IFC containment that no drawing can show. Union lengths
 * are plan-projected (like ours); literal-band lengths are Pset 3D lengths.
 *
 * Shared-fixture rule (round 2, 2026-09-06). A full-set ratio compares two
 * different fixture populations: on the residential floor 58 of the
 * engineer's 71.7 m are Ø50/Ø63 runs to drum traps, shower drains and floor
 * traps whose fixtures no file models on that storey (13 fixtures detected:
 * 11 WC + 2 basins); on the office floor the engineer's slice reaches 28 of
 * the 33 fixtures we route within 3 m (25 within the 1.0 m rule below). The gated ratio therefore uses only the fixtures
 * served by both sides, symmetrically:
 * - a fixture is served by the ENGINEER when the upstream end of one of the
 *   engineer's horizontal runs lies within `ENGINEER_SERVES_FIXTURE_M` of it in
 *   plan (the branch drop meets the run there);
 * - a fixture is served by US when it is routed (has a branch route);
 * - shared = both. Our shared length = every route segment that carries at
 *   least one shared fixture (`servedFixtureExpressIds`), counted once.
 *   Engineer shared length: each run whose upstream end lies within the
 *   tolerance of a fixture is attributed to the NEAREST such fixture, then the
 *   attribution is walked DOWNSTREAM along the 150 mm fitting-bridged
 *   connectivity (`classifyEngineerRunRoles` at
 *   `ENGINEER_FITTING_BRIDGE_TOLERANCE_M`: a run drains into the run its lower
 *   end touches), so a collector fed by several fixtures carries the union of
 *   their attributions and is counted once when ANY of them is shared. Runs
 *   reached by no attribution (free ends far from every detected fixture, or
 *   joined through fittings longer than the bridge) are excluded from the
 *   shared denominator and counted in `engineerRunsUnattributed`.
 * Diameter-compatible attribution (round 3). A run of nominal diameter below
 * `WC_MIN_BRANCH_DIAMETER_MM` (110, `branchDefaults`) cannot serve a toilet:
 * the direct attribution takes the nearest COMPATIBLE fixture within the
 * tolerance; a Ø50/Ø63 run whose only fixtures within reach are WCs is
 * unattributed (an engineer free end — the unmodelled basin/trap it really
 * serves), counted in `engineerRunsRejectedByDiameter`. Runs without a
 * diameter are compatible with every fixture (no evidence either way). The
 * rule is the same on both floors; `wcMinBranchDiameterMm: 0` switches it off
 * for the before/after comparison the harness prints.
 * Approximations, stated: the bridge tolerance misses joints through long
 * fittings (reducer + wye), which then look like free ends; the effect is
 * visible through the tolerance sensitivity and the unattributed count.
 */

import { WC_MIN_BRANCH_DIAMETER_MM } from './branchDefaults'
import type { PlanPointM } from './engineerComparisonMetrics'
import type { FixtureKind } from './types'

export const OBSTRUCTION_MAX = 0
export const STACKS_RATIO_MIN = 0.6
export const STACKS_RATIO_MAX = 1.5
export const BRANCH_RATIO_MIN = 0.5
export const BRANCH_RATIO_MAX = 2.0
export const ROUTED_FRACTION_REQUIRED = 1
/** Which engineer horizontal set the branch ratios use (see the module comment). */
export const BRANCH_RATIO_ENGINEER_SET = 'union' as const
/**
 * A fixture counts as served by the engineer when the upstream end of one of
 * the engineer's horizontal runs lies within this plan distance of it. The
 * drop from a fixture (WC outlet, trap) to the collector under the slab is
 * vertical and not part of the horizontal set, so the run starts under the
 * fixture; 1.0 m covers the fixture body plus a bend. Sensitivity at 0.75 /
 * 1.0 / 1.5 m is printed by the export step, never used to pick a value.
 */
export const ENGINEER_SERVES_FIXTURE_M = 1.0

/** A positioned fixture of the storey, drawing plan frame (metres). */
export interface GauntletFixturePoint extends PlanPointM {
  expressId: number
  /** Canonical fixture kind; decides which run diameters can serve it. */
  kind: FixtureKind
}

/** One engineer horizontal run of the compared set, drawing plan frame (metres). */
export interface GauntletEngineerRun {
  /** Segment express id (stable key). */
  id: number
  /** Upstream end: the higher endpoint, where a fixture drop meets the run. */
  upstream: PlanPointM
  /** Nominal diameter; null when the file carries none (compatible with every fixture). */
  diameterMm: number | null
  planLengthM: number
  /**
   * Ids of the runs this one drains into (its lower end touches them within
   * the fitting-bridged tolerance); a collector's feeders list it here.
   */
  drainsInto: readonly number[]
}

/** One of our route segments on the storey with the fixtures whose flow it carries. */
export interface GauntletOurSegment {
  planLengthM: number
  servedFixtureExpressIds: readonly number[]
}

export interface GauntletSharedFixtureInput {
  fixtures: readonly GauntletFixturePoint[]
  /** Fixtures with a branch route (served by us). */
  routedFixtureExpressIds: readonly number[]
  ourSegments: readonly GauntletOurSegment[]
  engineerRuns: readonly GauntletEngineerRun[]
  /** Overrides {@link ENGINEER_SERVES_FIXTURE_M} (sensitivity runs). */
  servesFixtureM?: number
  /** Overrides {@link WC_MIN_BRANCH_DIAMETER_MM}; 0 disables the diameter rule (before/after runs). */
  wcMinBranchDiameterMm?: number
}

/**
 * Can a run of this nominal diameter serve the fixture? Only the WC rule
 * exists: a run narrower than {@link WC_MIN_BRANCH_DIAMETER_MM} cannot carry a
 * toilet. Unknown diameters are compatible with everything.
 */
export function runDiameterServesFixture(diameterMm: number | null, kind: FixtureKind, wcMinBranchDiameterMm = WC_MIN_BRANCH_DIAMETER_MM): boolean {
  if (diameterMm === null) return true
  if (kind === 'TOILETPAN') return diameterMm >= wcMinBranchDiameterMm
  return true
}

export interface GauntletSharedFixtureMetrics {
  servesFixtureM: number
  /** Detected fixtures with a plan position (the population both rules are evaluated on). */
  fixtures: number
  fixturesServedByEngineer: number
  fixturesServedByUs: number
  /** Served by both sides — the comparison set of the gated branch ratio. */
  shared: number
  sharedFixtureExpressIds: number[]
  /** Coverage: engineer serves, we do not (our placement/routing gap). */
  fixturesOnlyEngineerServes: number
  /** Coverage: we serve, no engineer run reaches (engineer model gap). */
  fixturesOnlyWeServe: number
  /** Our route segments carrying ≥ 1 shared fixture, summed once each. */
  ourBranchSharedM: number
  /** Engineer runs attributed (directly or downstream) to ≥ 1 shared fixture, summed once each. */
  engineerBranchSharedM: number
  /** Engineer runs attributed to at least one detected fixture. */
  engineerRunsAttributed: number
  /** Engineer runs no attribution reaches (excluded from the shared denominator). */
  engineerRunsUnattributed: number
  engineerRunsUnattributedM: number
  /**
   * Engineer runs whose upstream end lies within the tolerance of a fixture
   * but of no diameter-compatible one (a Ø50/Ø63 run ending near a WC): left
   * without a direct attribution by the diameter rule.
   */
  engineerRunsRejectedByDiameter: number
  engineerRunsRejectedByDiameterM: number
  /** Engineer runs with no feeder whose upstream end has no detected fixture within the tolerance. */
  engineerLeafEndsWithoutFixture: number
}

/**
 * Pure shared-fixture set and both sides' branch length restricted to it (see
 * the module comment for the rule). Deterministic: ids are emitted sorted.
 */
export function computeSharedFixtureSet(input: GauntletSharedFixtureInput): GauntletSharedFixtureMetrics {
  const servesFixtureM = input.servesFixtureM ?? ENGINEER_SERVES_FIXTURE_M
  const wcMinBranchDiameterMm = input.wcMinBranchDiameterMm ?? WC_MIN_BRANCH_DIAMETER_MM
  const fixtureIds = new Set(input.fixtures.map((fixture) => fixture.expressId))
  const servedByUs = new Set(input.routedFixtureExpressIds.filter((id) => fixtureIds.has(id)))

  // 1. Direct attribution: each run → nearest diameter-compatible fixture within
  //    the tolerance of its upstream end. A run with fixtures in reach but none
  //    compatible is rejected by the diameter rule (stays unattributed).
  const runById = new Map(input.engineerRuns.map((run) => [run.id, run]))
  const directFixtureByRun = new Map<number, number>()
  let engineerRunsRejectedByDiameter = 0
  let engineerRunsRejectedByDiameterM = 0
  for (const run of input.engineerRuns) {
    let nearest: { expressId: number; distance: number } | null = null
    let incompatibleInReach = false
    for (const fixture of input.fixtures) {
      const distance = Math.hypot(fixture.xM - run.upstream.xM, fixture.yM - run.upstream.yM)
      if (distance > servesFixtureM) continue
      if (!runDiameterServesFixture(run.diameterMm, fixture.kind, wcMinBranchDiameterMm)) {
        incompatibleInReach = true
        continue
      }
      if (nearest === null || distance < nearest.distance || (distance === nearest.distance && fixture.expressId < nearest.expressId)) {
        nearest = { expressId: fixture.expressId, distance }
      }
    }
    if (nearest !== null) directFixtureByRun.set(run.id, nearest.expressId)
    else if (incompatibleInReach) {
      engineerRunsRejectedByDiameter += 1
      engineerRunsRejectedByDiameterM += run.planLengthM
    }
  }
  const servedByEngineer = new Set(directFixtureByRun.values())

  // 2. Downstream walk: every run reachable from a directly attributed run carries that fixture too.
  const attributedFixturesByRun = new Map<number, Set<number>>()
  for (const [runId, fixtureId] of directFixtureByRun) {
    const stack = [runId]
    const visited = new Set<number>()
    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      const set = attributedFixturesByRun.get(current) ?? new Set<number>()
      set.add(fixtureId)
      attributedFixturesByRun.set(current, set)
      const run = runById.get(current)
      if (run === undefined) continue
      for (const next of run.drainsInto) if (runById.has(next)) stack.push(next)
    }
  }

  const shared = new Set<number>()
  for (const id of servedByEngineer) if (servedByUs.has(id)) shared.add(id)

  let ourBranchSharedM = 0
  for (const segment of input.ourSegments) {
    if (segment.servedFixtureExpressIds.some((id) => shared.has(id))) ourBranchSharedM += segment.planLengthM
  }

  let engineerBranchSharedM = 0
  let engineerRunsAttributed = 0
  let engineerRunsUnattributed = 0
  let engineerRunsUnattributedM = 0
  const hasFeeder = new Set<number>()
  for (const run of input.engineerRuns) for (const into of run.drainsInto) hasFeeder.add(into)
  let engineerLeafEndsWithoutFixture = 0
  for (const run of input.engineerRuns) {
    const attributed = attributedFixturesByRun.get(run.id)
    if (attributed === undefined) {
      engineerRunsUnattributed += 1
      engineerRunsUnattributedM += run.planLengthM
    } else {
      engineerRunsAttributed += 1
      if ([...attributed].some((id) => shared.has(id))) engineerBranchSharedM += run.planLengthM
    }
    if (!hasFeeder.has(run.id) && !directFixtureByRun.has(run.id)) engineerLeafEndsWithoutFixture += 1
  }

  let fixturesOnlyEngineerServes = 0
  for (const id of servedByEngineer) if (!servedByUs.has(id)) fixturesOnlyEngineerServes += 1
  let fixturesOnlyWeServe = 0
  for (const id of servedByUs) if (!servedByEngineer.has(id)) fixturesOnlyWeServe += 1

  return {
    servesFixtureM,
    fixtures: fixtureIds.size,
    fixturesServedByEngineer: servedByEngineer.size,
    fixturesServedByUs: servedByUs.size,
    shared: shared.size,
    sharedFixtureExpressIds: [...shared].sort((a, b) => a - b),
    fixturesOnlyEngineerServes,
    fixturesOnlyWeServe,
    ourBranchSharedM,
    engineerBranchSharedM,
    engineerRunsAttributed,
    engineerRunsUnattributed,
    engineerRunsUnattributedM,
    engineerRunsRejectedByDiameter,
    engineerRunsRejectedByDiameterM,
    engineerLeafEndsWithoutFixture,
  }
}

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
  /** Sum of our branch-run plan lengths on the storey, metres (full set). */
  ourBranchTotalM: number
  /** Engineer horizontal sanitary run totals of the storey under both definitions (full sets); null when a set is empty/unknown. */
  engineerBranchTotalM: { union: number | null; literalBand: number | null }
  /** Fixtures of the storey with a plan position, and how many of them were routed to a stack. */
  fixtures: { positioned: number; routed: number }
  /** Both sides' runs and the positioned fixtures, for the shared-fixture branch ratio (the union engineer set). */
  sharedFixtures: GauntletSharedFixtureInput
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
  /**
   * GATED: ours / engineer horizontals restricted to the fixtures both sides
   * serve (`sharedFixtures`), engineer set = `BRANCH_RATIO_ENGINEER_SET`; null
   * when the shared set is empty or the engineer's shared length is 0.
   */
  branchRatio: number | null
  /** Full-set ratio on the union engineer set (every run, every fixture), for the record. */
  branchRatioFullUnion: number | null
  /** Full-set ratio against the literal storey band, for the record. */
  branchRatioLiteralBand: number | null
  ourBranchTotalM: number
  engineerBranchTotalM: { union: number | null; literalBand: number | null }
  /** The shared-fixture set, both sides' shared lengths and the coverage numbers. */
  sharedFixtures: GauntletSharedFixtureMetrics
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

  const branchRatioFullUnion = ratio(input.ourBranchTotalM, input.engineerBranchTotalM[BRANCH_RATIO_ENGINEER_SET])
  const branchRatioLiteralBand = ratio(input.ourBranchTotalM, input.engineerBranchTotalM.literalBand)
  const sharedFixtures = computeSharedFixtureSet(input.sharedFixtures)
  const branchRatio = ratio(sharedFixtures.ourBranchSharedM, sharedFixtures.engineerBranchSharedM)
  const engineerUnion = input.engineerBranchTotalM[BRANCH_RATIO_ENGINEER_SET]
  if (engineerUnion === null || engineerUnion <= 0) {
    reds.push(`branch length: the engineer has no drawn horizontal run on the storey, ratio undefined (ours ${input.ourBranchTotalM.toFixed(2)} m)`)
  } else if (sharedFixtures.shared === 0) {
    reds.push(
      `branch length: no fixture is served by both sides (engineer serves ${sharedFixtures.fixturesServedByEngineer}, we route ${sharedFixtures.fixturesServedByUs} of ${sharedFixtures.fixtures} within ${sharedFixtures.servesFixtureM} m), ratio undefined`,
    )
  } else if (branchRatio === null) {
    reds.push(
      `branch length: the engineer's runs attributed to the ${sharedFixtures.shared} shared fixture(s) have no length (ours ${sharedFixtures.ourBranchSharedM.toFixed(2)} m), ratio undefined`,
    )
  } else if (branchRatio < BRANCH_RATIO_MIN || branchRatio > BRANCH_RATIO_MAX) {
    reds.push(
      `branch length: ratio ${formatRatio(branchRatio)} (ours ${sharedFixtures.ourBranchSharedM.toFixed(2)} m / engineer ${sharedFixtures.engineerBranchSharedM.toFixed(2)} m on the ${sharedFixtures.shared} fixture(s) both sides serve, ${BRANCH_RATIO_ENGINEER_SET} set; full set ${formatRatio(branchRatioFullUnion)}) outside [${BRANCH_RATIO_MIN}, ${BRANCH_RATIO_MAX}]`,
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
    branchRatioFullUnion,
    branchRatioLiteralBand,
    ourBranchTotalM: input.ourBranchTotalM,
    engineerBranchTotalM: { ...input.engineerBranchTotalM },
    sharedFixtures,
    routedFraction,
    verdict: reds.length === 0 ? 'green' : 'red',
    reds,
  }
}
