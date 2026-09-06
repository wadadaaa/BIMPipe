#!/usr/bin/env node
/**
 * Export the two sides of the A/B for one floor as `FloorDrawingModel` JSON.
 *
 *   node tools/gauntlet/export-floor-models.ts --floor 096-01
 *   node tools/gauntlet/export-floor-models.ts --floor shbj-L04 --out /tmp/gauntlet
 *   node tools/gauntlet/export-floor-models.ts --spec my-floor.json
 *   node tools/gauntlet/export-floor-models.ts --list
 *
 * Writes `<out>/<floor>/engineer.json`, `ours.json`, `metrics-input.json` and
 * `summary.json` (default out: `external/gauntlet/models`, gitignored).
 *
 * How it runs: the repo has no `tsx`/`vite-node`; vitest is the only Node
 * runner here that already loads web-ifc's WASM, TypeScript and the `@/`
 * alias. This script therefore spawns vitest on
 * `src/shared/drawing/gauntletExport.gated.test.ts` with `GAUNTLET_EXPORT=1`
 * and forwards the floor/spec/out choices through environment variables.
 * "Ours" is produced by the same code path the app and the gated placement
 * tests use (`runGauntletFloorPipeline`: alignment → merged fixtures →
 * continuity map → wet-core stacks → assignments → branch routes).
 *
 * Spec JSON (`gauntletFloorSpecSchema`):
 *   {
 *     "floor": "096-01",
 *     "host":   { "path": "external/projects/096/096-P.ifc", "fileName": "096-P.ifc" },
 *     "linked": [{ "path": "external/projects/096/096-A.ifc", "fileName": "096-A.ifc" }],
 *     "storey": { "name": "01" },            // or { "elevationSource": 1800 }
 *     "storeyLabel": "Storey 01",
 *     "typology": "residential",             // optional: residential | office
 *     "wholeBuildingExtent": true            // optional, default true
 *   }
 *
 * Runs on Node ≥ 22.18 (native type stripping); no build step, not part of the app bundle.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPORT_TEST = 'src/shared/drawing/gauntletExport.gated.test.ts'
const DEFAULT_OUT_DIR = 'external/gauntlet/models'
const BUILTIN_FLOORS = ['096-01', 'shbj-L04']

interface CliArgs {
  floor?: string
  spec?: string
  out?: string
  list: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { list: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      i += 1
      return value
    }
    switch (arg) {
      case '--floor':
        args.floor = next()
        break
      case '--spec':
        args.spec = next()
        break
      case '--out':
        args.out = next()
        break
      case '--list':
        args.list = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown argument ${arg}`)
    }
  }
  return args
}

function usage(): string {
  return [
    'Usage: node tools/gauntlet/export-floor-models.ts (--floor <key> | --spec <file.json>) [--out <dir>]',
    `  --floor   built-in floor key: ${BUILTIN_FLOORS.join(', ')}`,
    '  --spec    JSON spec file (see header comment for the shape)',
    `  --out     output root (default ${DEFAULT_OUT_DIR}; output is client-derived, keep it gitignored)`,
    '  --list    print the built-in floor keys',
  ].join('\n')
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (args.list) {
    for (const key of BUILTIN_FLOORS) console.log(key)
    return 0
  }
  if (args.spec === undefined && args.floor === undefined) {
    console.error(usage())
    return 2
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const outRoot = path.resolve(args.out ?? path.join(repoRoot, DEFAULT_OUT_DIR))

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GAUNTLET_EXPORT: '1',
    GAUNTLET_EXPORT_OUT: outRoot,
  }
  let floorKey = args.floor
  if (args.spec !== undefined) {
    const specPath = path.resolve(args.spec)
    if (!existsSync(specPath)) {
      console.error(`Spec file not found: ${specPath}`)
      return 2
    }
    env.GAUNTLET_EXPORT_SPEC = specPath
    const raw = JSON.parse(readFileSync(specPath, 'utf-8')) as { floor?: unknown }
    floorKey = typeof raw.floor === 'string' ? raw.floor : undefined
  } else if (args.floor !== undefined) {
    env.GAUNTLET_EXPORT_FLOOR = args.floor
  }

  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', EXPORT_TEST, '--reporter=dot'], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`Failed to start vitest: ${result.error.message}`)
    return 1
  }
  if (result.status !== 0) {
    console.error(`Export failed (vitest exit ${result.status ?? 'signal'}). Re-run with --reporter=verbose via:`)
    console.error(`  GAUNTLET_EXPORT=1 GAUNTLET_EXPORT_FLOOR=<key> pnpm exec vitest run ${EXPORT_TEST} --reporter=verbose`)
    return result.status ?? 1
  }

  if (floorKey !== undefined) {
    const summaryPath = path.join(outRoot, floorKey, 'summary.json')
    if (existsSync(summaryPath)) {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as {
        engineer: { risers: number; pipes: number; fixtures: number; structure: number }
        ours: { risers: number; pipes: number; fixtures: number; structure: number }
        elapsedMs: number
      }
      console.log(`Wrote ${path.join(outRoot, floorKey)}`)
      console.log(
        `  engineer: ${summary.engineer.risers} risers, ${summary.engineer.pipes} pipes, ${summary.engineer.fixtures} fixtures, ${summary.engineer.structure} structure elements`,
      )
      console.log(
        `  ours:     ${summary.ours.risers} risers, ${summary.ours.pipes} pipes, ${summary.ours.fixtures} fixtures, ${summary.ours.structure} structure elements`,
      )
      console.log(`  pipeline: ${summary.elapsedMs} ms`)
    }
  }
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 2
}
