import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WC_MIN_BRANCH_DIAMETER_MM } from '@/domain/branchDefaults'
import { computeGauntletMetrics, computeSharedFixtureSet } from '@/domain/gauntletMetrics'
import { drawingContentOutsideBounds, drawingLabelsContaining, drawingModelHasNonFinite } from './drawingModelChecks'
import { parseGauntletFloorSpec, runGauntletFloorPipeline, type GauntletFloorSpec } from './gauntletFloorPipeline'
import { closeSpecModels, GAUNTLET_BUILTIN_FLOOR_SPECS, openSpecModels, resolveSpecPaths, specFilesExist } from './gauntletFloorSpecs'
import { gauntletMetricsInputFromPipeline } from './gauntletMetricsInput'
import { buildSharedFixtureVariant } from './sharedFixtureVariant'

/**
 * Export "script test" behind `GAUNTLET_EXPORT=1` — the node-side entry point
 * of `tools/gauntlet/export-floor-models.ts`. Vitest is the only runner in this
 * repo that already loads web-ifc, TypeScript and the `@/` alias on Node, so
 * the CLI spawns vitest on this file instead of re-implementing that setup.
 *
 * Environment:
 * - `GAUNTLET_EXPORT=1`            enable (otherwise this file is skipped)
 * - `GAUNTLET_EXPORT_FLOOR=<key>`  built-in spec key (`GAUNTLET_BUILTIN_FLOOR_SPECS`)
 * - `GAUNTLET_EXPORT_SPEC=<file>`  JSON spec file (`gauntletFloorSpecSchema`) — overrides FLOOR
 * - `GAUNTLET_EXPORT_OUT=<dir>`    output root (default `external/gauntlet/models`)
 *
 * Writes `<out>/<floor>/engineer.json`, `ours.json` (`FloorDrawingModel`s),
 * `metrics-input.json` (`GauntletMetricsInput`), `metrics.json` (the hard
 * metrics + verdict of `computeGauntletMetrics`) and `summary.json`
 * (both adapters' diagnostics + counts). Output lands under the gitignored
 * `external/` by default; it contains client-derived geometry and must stay there.
 */
const ENABLED = process.env.GAUNTLET_EXPORT === '1'
const DEFAULT_OUT_DIR = 'external/gauntlet/models'
const TEST_TIMEOUT_MS = 900_000
/** Tolerances the shared-fixture sensitivity is printed at (`summary.json`); the gate uses `ENGINEER_SERVES_FIXTURE_M`. */
const SHARED_SENSITIVITY_TOLERANCES_M = [0.75, 1.0, 1.5]

function resolveSpecFromEnv(): GauntletFloorSpec {
  const specFile = process.env.GAUNTLET_EXPORT_SPEC
  if (specFile !== undefined && specFile !== '') {
    const raw: unknown = JSON.parse(readFileSync(path.resolve(specFile), 'utf-8'))
    return parseGauntletFloorSpec(raw)
  }
  const key = process.env.GAUNTLET_EXPORT_FLOOR
  if (key === undefined || key === '') {
    throw new Error(
      `Set GAUNTLET_EXPORT_FLOOR to one of: ${Object.keys(GAUNTLET_BUILTIN_FLOOR_SPECS).join(', ')} — or GAUNTLET_EXPORT_SPEC to a spec JSON file.`,
    )
  }
  const spec = GAUNTLET_BUILTIN_FLOOR_SPECS[key]
  if (spec === undefined) {
    throw new Error(`Unknown built-in floor "${key}"; known: ${Object.keys(GAUNTLET_BUILTIN_FLOOR_SPECS).join(', ')}`)
  }
  return spec
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

describe.skipIf(!ENABLED)('gauntlet floor export (GAUNTLET_EXPORT=1)', () => {
  it(
    'runs the app pipeline on the spec and writes engineer.json, ours.json, metrics-input.json, summary.json',
    async () => {
      const spec = resolveSpecFromEnv()
      const missing = resolveSpecPaths(spec).filter((file) => !existsSync(file))
      expect(missing, `spec files missing: ${missing.join(', ')}`).toEqual([])
      expect(specFilesExist(spec)).toBe(true)

      const outRoot = path.resolve(process.env.GAUNTLET_EXPORT_OUT || DEFAULT_OUT_DIR)
      const outDir = path.join(outRoot, spec.floor)
      mkdirSync(outDir, { recursive: true })

      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const models = openSpecModels(api, spec)
      try {
        const startedAt = Date.now()
        const result = await runGauntletFloorPipeline(api, spec, models)
        const elapsedMs = Date.now() - startedAt
        const { engineer, ours, metricsInput } = result

        // Never write a model that fails the basic sanity checks.
        const forbidden = [spec.host.fileName, ...spec.linked.map((ref) => ref.fileName)]
        for (const [side, model] of [
          ['engineer', engineer.model],
          ['ours', ours.model],
        ] as const) {
          expect(drawingModelHasNonFinite(model), `${side}: non-finite number`).toBe(false)
          expect(drawingContentOutsideBounds(model), `${side}: content outside bounds`).toEqual({
            pipeEndpoints: 0,
            risers: 0,
            fixtures: 0,
          })
          expect(drawingLabelsContaining(model, forbidden), `${side}: file name in labels`).toEqual([])
        }

        writeJson(path.join(outDir, 'engineer.json'), engineer.model)
        writeJson(path.join(outDir, 'ours.json'), ours.model)
        writeJson(path.join(outDir, 'metrics-input.json'), metricsInput)
        const hardInput = gauntletMetricsInputFromPipeline(metricsInput)
        const metrics = computeGauntletMetrics(hardInput)
        writeJson(path.join(outDir, 'metrics.json'), metrics)
        // Sensitivity of the shared-fixture rule to its one tolerance — printed, never
        // used to pick it — at the gate's diameter rule and with the rule off (R3 before/after).
        const sharedSensitivity = SHARED_SENSITIVITY_TOLERANCES_M.flatMap((servesFixtureM) =>
          [WC_MIN_BRANCH_DIAMETER_MM, 0].map((wcMinBranchDiameterMm) => {
            const shared = computeSharedFixtureSet({ ...hardInput.sharedFixtures, servesFixtureM, wcMinBranchDiameterMm })
            return {
              servesFixtureM,
              diameterRule: wcMinBranchDiameterMm > 0 ? `WC ≥ Ø${wcMinBranchDiameterMm}` : 'off',
              shared: shared.shared,
              fixturesOnlyEngineerServes: shared.fixturesOnlyEngineerServes,
              fixturesOnlyWeServe: shared.fixturesOnlyWeServe,
              ourBranchSharedM: shared.ourBranchSharedM,
              engineerBranchSharedM: shared.engineerBranchSharedM,
              branchRatio: shared.engineerBranchSharedM > 0 ? shared.ourBranchSharedM / shared.engineerBranchSharedM : null,
              engineerRunsUnattributed: shared.engineerRunsUnattributed,
              engineerRunsUnattributedM: shared.engineerRunsUnattributedM,
              engineerRunsRejectedByDiameter: shared.engineerRunsRejectedByDiameter,
              engineerRunsRejectedByDiameterM: shared.engineerRunsRejectedByDiameterM,
              engineerLeafEndsWithoutFixture: shared.engineerLeafEndsWithoutFixture,
            }
          }),
        )
        // R3 diagnostic variant: both sheets restricted to the shared fixture set
        // (gated result stays the unrestricted one; `run-round.ts` pairs this
        // variant only when the two sides' fixture populations differ).
        const sharedVariant = buildSharedFixtureVariant({
          engineer: engineer.model,
          ours: ours.model,
          ourBranchRoutes: metricsInput.comparisonInput.ourBranchRoutes,
          sharedFixtureExpressIds: metrics.sharedFixtures.sharedFixtureExpressIds,
        })
        for (const [side, model] of [
          ['engineer', sharedVariant.engineer],
          ['ours', sharedVariant.ours],
        ] as const) {
          expect(drawingModelHasNonFinite(model), `${side} (shared variant): non-finite number`).toBe(false)
          expect(drawingLabelsContaining(model, forbidden), `${side} (shared variant): file name in labels`).toEqual([])
          writeJson(path.join(outDir, `${side}.shared.json`), model)
        }
        const summary = {
          floor: spec.floor,
          storeyLabel: spec.storeyLabel,
          typology: spec.typology ?? null,
          writtenAt: new Date().toISOString(),
          elapsedMs,
          engineer: {
            risers: engineer.model.risers.length,
            pipes: engineer.model.pipes.length,
            fixtures: engineer.model.fixtures.length,
            structure: engineer.model.structure.length,
            boundsM: engineer.model.boundsM,
            diagnostics: engineer.diagnostics,
          },
          ours: {
            risers: ours.model.risers.length,
            pipes: ours.model.pipes.length,
            fixtures: ours.model.fixtures.length,
            structure: ours.model.structure.length,
            boundsM: ours.model.boundsM,
            diagnostics: ours.diagnostics,
          },
          report: metricsInput.report,
          metrics,
          sharedSensitivity,
          sharedVariant: sharedVariant.diagnostics,
          pipelineDiagnostics: metricsInput.diagnostics,
          files: ['engineer.json', 'ours.json', 'engineer.shared.json', 'ours.shared.json', 'metrics-input.json', 'metrics.json', 'summary.json'],
        }
        writeJson(path.join(outDir, 'summary.json'), summary)
        console.info(`[gauntlet export] wrote ${outDir}`)
        console.info(`[gauntlet export] ${JSON.stringify(summary)}`)
      } finally {
        closeSpecModels(api, models)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
