import { describe, expect, it } from 'vitest'
import { computeGauntletMetrics } from '@/domain/gauntletMetrics'
import { runGauntletFloorPipeline } from './gauntletFloorPipeline'
import { closeSpecModels, GAUNTLET_BUILTIN_FLOOR_SPECS, openSpecModels, specFilesExist } from './gauntletFloorSpecs'
import { gauntletMetricsInputFromPipeline } from './gauntletMetricsInput'

/**
 * Goal 4 final gate (G6): the five hard metrics of the gauntlet's residential
 * floor (first project, storey 01 as residential — floor code F1), computed by
 * `computeGauntletMetrics` on the real pipeline output and pinned to the round-3
 * values (`external/gauntlet/rounds/03/F1/metrics.json`, 2026-09-07). Client
 * data lives under the gitignored `external/`; the suite skips cleanly without it.
 *
 * A change that moves any of these numbers is a change to the gauntlet result
 * and must be recorded as such (PROGRESS.md round table), never re-pinned quietly.
 */
const SPEC = GAUNTLET_BUILTIN_FLOOR_SPECS['096-01']
const TEST_TIMEOUT_MS = 600_000

const PIN_OBSTRUCTION = 0
const PIN_UNKNOWN_PROBES = 3
const PIN_OUR_STACKS = 8
const PIN_ENGINEER_STACKS = 12
const PIN_STACKS_RATIO = 8 / 12
const PIN_MEAN_DIST_TO_ENGINEER_STACK_M = 1.45
const MEAN_DIST_TOLERANCE_M = 0.05
const PIN_BRANCH_RATIO_SHARED = 0.55
const BRANCH_RATIO_TOLERANCE = 0.02
const PIN_ROUTED_FRACTION = 1
const PIN_FIXTURES_ONLY_ENGINEER_SERVES = 0
const PIN_FIXTURES_ONLY_WE_SERVE = 0

const gated = describe.skipIf(!specFilesExist(SPEC))

gated('gauntlet hard metrics on the residential floor F1 (gated: requires local client files)', () => {
  it(
    'pins obstruction, stacks ratio, mean stack distance, shared branch ratio, routed fraction, coverage and the green verdict',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const models = openSpecModels(api, SPEC)
      try {
        const result = await runGauntletFloorPipeline(api, SPEC, models)
        const metrics = computeGauntletMetrics(gauntletMetricsInputFromPipeline(result.metricsInput))
        console.info(`[F1 gauntlet metrics] ${JSON.stringify({ ...metrics, sharedFixtures: undefined })}`)

        expect(metrics.obstruction).toBe(PIN_OBSTRUCTION)
        expect(metrics.unknownProbes).toBe(PIN_UNKNOWN_PROBES)

        expect(metrics.ourStackCount).toBe(PIN_OUR_STACKS)
        expect(metrics.engineerStackCount).toBe(PIN_ENGINEER_STACKS)
        expect(metrics.stacksRatio).not.toBeNull()
        expect(metrics.stacksRatio!).toBeCloseTo(PIN_STACKS_RATIO, 10)

        expect(metrics.meanDistToEngineerStackM).not.toBeNull()
        expect(Math.abs(metrics.meanDistToEngineerStackM! - PIN_MEAN_DIST_TO_ENGINEER_STACK_M)).toBeLessThanOrEqual(MEAN_DIST_TOLERANCE_M)

        expect(metrics.branchRatio).not.toBeNull()
        expect(Math.abs(metrics.branchRatio! - PIN_BRANCH_RATIO_SHARED)).toBeLessThanOrEqual(BRANCH_RATIO_TOLERANCE)

        expect(metrics.routedFraction).toBe(PIN_ROUTED_FRACTION)

        expect(metrics.sharedFixtures.fixturesOnlyEngineerServes).toBe(PIN_FIXTURES_ONLY_ENGINEER_SERVES)
        expect(metrics.sharedFixtures.fixturesOnlyWeServe).toBe(PIN_FIXTURES_ONLY_WE_SERVE)

        expect(metrics.reds).toEqual([])
        expect(metrics.verdict).toBe('green')
      } finally {
        closeSpecModels(api, models)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
