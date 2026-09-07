#!/usr/bin/env node
/**
 * One gauntlet round for one or both floors: export both drawing models →
 * hard metrics → anonymized renders → blind A/B trial pairs for the critic.
 *
 *   node tools/gauntlet/run-round.ts --round 00
 *   node tools/gauntlet/run-round.ts --round 03 --floors F2 --trials 10 --seed 42
 *   node tools/gauntlet/run-round.ts --round 00 --force-trials   # A/B pairs even on red metrics
 *
 * Output (default root `external/gauntlet/rounds`, gitignored — every file is
 * client-derived):
 *
 *   rounds/NN/<F>/models/        engineer.json, ours.json, metrics-input.json, metrics.json, summary.json
 *   rounds/NN/<F>/metrics.json   hard metrics + verdict (`computeGauntletMetrics`)
 *   rounds/NN/<F>/engineer.png   anonymized render (no title strip), same scale/dpi as ours.png
 *   rounds/NN/<F>/ours.png
 *   rounds/NN/<F>/verdict.json   { result: 'loss', reason: [...] } when a metric is red (no trials), else
 *                                { result: 'pending-critic' } until `tally-round.ts` runs
 *   rounds/NN/<F>/key.json       HIDDEN: which side is ours per trial — never inside a trial folder
 *   rounds/NN/<F>/prompts.json   the exact critic prompt per trial (see CRITIC.md)
 *   rounds/NN/<F>/trial-<t>/A.png, B.png   copies in a seeded random order
 *   rounds/NN/<F>S/…                diagnostic variant (round 3): both sheets restricted to the
 *                                    fixtures both sides serve; written only when the two sides'
 *                                    fixture populations differ; verdict.json = { result: 'diagnostic' }
 *
 * The floor codes `F1`/`F2` (plus the `S` variant suffix) are the only names a
 * critic ever sees in a path; the trial folders carry nothing else (no model
 * JSON, no key, no file names).
 *
 * `--force-trials` writes the trial pairs even when the metrics are red — the
 * verdict stays `loss` (thresholds are never softened); the A/B then serves
 * only to name the gap for the next round.
 *
 * Runs on Node ≥ 22.18 (native type stripping); delegates the pipeline to
 * `export-floor-models.ts` (vitest + web-ifc) and rendering to
 * `render-drawing.mjs` (Vite SSR loader), so it imports nothing from `src/`.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_OUT_DIR = 'external/gauntlet/rounds'
const DEFAULT_TRIALS = 10
const DEFAULT_SCALE = 100
const DEFAULT_DPI = 220

/** Neutral floor code → built-in export spec key. Critics only ever see the code. */
const FLOORS: Readonly<Record<string, { specKey: string; description: string }>> = {
  F1: { specKey: '096-01', description: 'residential storey' },
  F2: { specKey: 'shbj-L04', description: 'office storey' },
}

const CRITIC_PROMPT = (dir: string): string =>
  'You are a senior sanitary/drainage engineer reviewing two candidate drainage layouts for the same floor, drawn in the same drafting convention: ' +
  `${dir}/A.png and ${dir}/B.png. Read both images. Decide which layout is the more professional, buildable engineering design (stack locations, collector geometry, runs along walls vs diagonals, crossings, sleeves, slopes/diameters). Answer in this exact format and nothing else:\n` +
  'WINNER: A|B\n' +
  'CONFIDENCE: low|medium|high\n' +
  'GAP: one sentence naming the single biggest engineering gap in the losing drawing, choosing from: stack location, collector geometry, run along walls vs diagonal, crossings, missing sleeves, unrealistic slopes/diameters, other.'

interface CliArgs {
  round?: string
  floors: string[]
  trials: number
  seed?: number
  out?: string
  scale: number
  dpi: number
  forceTrials: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { floors: Object.keys(FLOORS), trials: DEFAULT_TRIALS, scale: DEFAULT_SCALE, dpi: DEFAULT_DPI, forceTrials: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      i += 1
      return value
    }
    switch (arg) {
      case '--round':
        args.round = next()
        break
      case '--floors':
        args.floors = next().split(',').map((code) => code.trim()).filter((code) => code.length > 0)
        break
      case '--trials':
        args.trials = Number(next())
        break
      case '--seed':
        args.seed = Number(next())
        break
      case '--out':
        args.out = next()
        break
      case '--scale':
        args.scale = Number(next())
        break
      case '--dpi':
        args.dpi = Number(next())
        break
      case '--force-trials':
        args.forceTrials = true
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
    'Usage: node tools/gauntlet/run-round.ts --round NN [--floors F1,F2] [--trials 10] [--seed N] [--out <dir>] [--scale 50|100] [--dpi N] [--force-trials]',
    '  --round        round number (zero-padded folder name, e.g. 00)',
    `  --floors       floor codes, comma-separated (default ${Object.keys(FLOORS).join(',')})`,
    `  --trials       A/B pairs per floor (default ${DEFAULT_TRIALS})`,
    '  --seed         RNG seed for the A/B order (default derived from the round number)',
    `  --out          output root (default ${DEFAULT_OUT_DIR}; client-derived, keep it gitignored)`,
    `  --scale/--dpi  render options for both sides (default 1:${DEFAULT_SCALE}, ${DEFAULT_DPI} dpi)`,
    '  --force-trials write A/B pairs even when a metric is red (verdict stays loss)',
  ].join('\n')
}

/** mulberry32 — small, seedable, deterministic; enough to shuffle A/B sides. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

/** Runs a child step; its stdout is shown only when it fails (the export step is verbose). */
function run(repoRoot: string, command: string, commandArgs: string[]): void {
  const result = spawnSync(command, commandArgs, { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`)
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    throw new Error(`${command} ${commandArgs.slice(0, 3).join(' ')} … exited with ${result.status ?? 'signal'}`)
  }
}

interface HardMetrics {
  obstruction: number
  unknownProbes: number
  stacksRatio: number | null
  ourStackCount: number
  engineerStackCount: number
  meanDistToEngineerStackM: number | null
  /** Gated: on the fixtures both sides serve. */
  branchRatio: number | null
  branchRatioFullUnion: number | null
  branchRatioLiteralBand: number | null
  sharedFixtures: {
    fixtures: number
    shared: number
    fixturesOnlyEngineerServes: number
    fixturesOnlyWeServe: number
    engineerLeafEndsWithoutFixture: number
  }
  routedFraction: number | null
  verdict: 'green' | 'red'
  reds: string[]
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? 'n/a' : value.toFixed(digits)
}

/** Suffix of the diagnostic shared-fixture-set variant folder (`F2S`): reveals nothing about either side. */
const SHARED_VARIANT_SUFFIX = 'S'

function renderSide(repoRoot: string, modelFile: string, outDir: string, side: 'engineer' | 'ours', args: CliArgs): void {
  run(repoRoot, 'node', [
    'tools/render-drawing.mjs',
    modelFile,
    path.join(outDir, `${side}.svg`),
    '--png',
    path.join(outDir, `${side}.png`),
    '--anonymize',
    '--scale',
    String(args.scale),
    '--dpi',
    String(args.dpi),
  ])
}

/** Blind A/B pairs: copies only, seeded order, key outside the trial folders. */
function writeTrialPairs(dir: string, code: string, args: CliArgs, seed: number, floorSeed: number, extraKey: Record<string, unknown>): void {
  const random = seededRandom(floorSeed)
  const key: Array<{ trial: string; ours: 'A' | 'B' }> = []
  const prompts: Array<{ trial: string; prompt: string }> = []
  for (let t = 1; t <= args.trials; t += 1) {
    const trial = `trial-${String(t).padStart(2, '0')}`
    const trialDir = path.join(dir, trial)
    rmSync(trialDir, { recursive: true, force: true })
    mkdirSync(trialDir, { recursive: true })
    const oursIsA = random() < 0.5
    copyFileSync(path.join(dir, oursIsA ? 'ours.png' : 'engineer.png'), path.join(trialDir, 'A.png'))
    copyFileSync(path.join(dir, oursIsA ? 'engineer.png' : 'ours.png'), path.join(trialDir, 'B.png'))
    key.push({ trial, ours: oursIsA ? 'A' : 'B' })
    prompts.push({ trial, prompt: CRITIC_PROMPT(path.resolve(trialDir)) })
  }
  writeJson(path.join(dir, 'key.json'), { round: args.round, floor: code, seed, floorSeed, ...extraKey, trials: key })
  writeJson(path.join(dir, 'prompts.json'), prompts)
}

/**
 * Diagnostic variant (round 3): when the two sides serve different fixture
 * populations, pair both sheets restricted to the shared set as well
 * (`<code>S/`). Its verdict is never gated — the unrestricted pair is the
 * result; this one only tells whether the unserved fixtures drove the critics.
 */
function runSharedVariant(repoRoot: string, roundDir: string, code: string, args: CliArgs, seed: number, metrics: HardMetrics, modelsDir: string): { code: string; trials: number } | null {
  const differ = metrics.sharedFixtures.fixturesOnlyEngineerServes + metrics.sharedFixtures.fixturesOnlyWeServe > 0
  const engineerModel = path.join(modelsDir, 'engineer.shared.json')
  const oursModel = path.join(modelsDir, 'ours.shared.json')
  if (!differ || !existsSync(engineerModel) || !existsSync(oursModel)) return null
  const variantCode = `${code}${SHARED_VARIANT_SUFFIX}`
  const dir = path.join(roundDir, variantCode)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  renderSide(repoRoot, engineerModel, dir, 'engineer', args)
  renderSide(repoRoot, oursModel, dir, 'ours', args)
  writeJson(path.join(dir, 'verdict.json'), {
    result: 'diagnostic',
    note: `Both sheets restricted to the ${metrics.sharedFixtures.shared} fixture(s) both sides serve (only engineer ${metrics.sharedFixtures.fixturesOnlyEngineerServes}, only us ${metrics.sharedFixtures.fixturesOnlyWeServe} on the full set); not gated — the ${code} pair is the round's result.`,
  })
  const floorSeed = seed + (Object.keys(FLOORS).indexOf(code) + Object.keys(FLOORS).length) * 1_000_003
  writeTrialPairs(dir, variantCode, args, seed, floorSeed, { variant: 'shared-fixture-set', baseFloor: code })
  return { code: variantCode, trials: args.trials }
}

function runFloor(repoRoot: string, roundDir: string, code: string, args: CliArgs, seed: number): { metrics: HardMetrics; trials: number; sharedVariant: { code: string; trials: number } | null } {
  const floor = FLOORS[code]
  if (floor === undefined) throw new Error(`Unknown floor code ${code}; known: ${Object.keys(FLOORS).join(', ')}`)
  const floorDir = path.join(roundDir, code)
  mkdirSync(floorDir, { recursive: true })

  // 1. export both models through the app pipeline
  const exportRoot = path.join(floorDir, '.export')
  rmSync(exportRoot, { recursive: true, force: true })
  run(repoRoot, 'node', ['tools/gauntlet/export-floor-models.ts', '--floor', floor.specKey, '--out', exportRoot])
  const modelsDir = path.join(floorDir, 'models')
  rmSync(modelsDir, { recursive: true, force: true })
  renameSync(path.join(exportRoot, floor.specKey), modelsDir)
  rmSync(exportRoot, { recursive: true, force: true })

  // 2. hard metrics (computed by the export step from the same pipeline result)
  const metrics = JSON.parse(readFileSync(path.join(modelsDir, 'metrics.json'), 'utf-8')) as HardMetrics
  writeJson(path.join(floorDir, 'metrics.json'), metrics)

  // 3. anonymized renders, identical options on both sides
  for (const side of ['engineer', 'ours'] as const) renderSide(repoRoot, path.join(modelsDir, `${side}.json`), floorDir, side, args)

  // 4. verdict gate
  const red = metrics.verdict === 'red'
  if (red && !args.forceTrials) {
    writeJson(path.join(floorDir, 'verdict.json'), { result: 'loss', reason: metrics.reds })
    return { metrics, trials: 0, sharedVariant: null }
  }
  writeJson(
    path.join(floorDir, 'verdict.json'),
    red
      ? { result: 'loss', reason: metrics.reds, note: 'A/B trials forced (--force-trials) to name the gap; the metrics verdict stands.' }
      : { result: 'pending-critic' },
  )

  // 5. blind A/B pairs (per-floor seed, so the two floors do not share one A/B sequence)
  const floorSeed = seed + Object.keys(FLOORS).indexOf(code) * 1_000_003
  writeTrialPairs(floorDir, code, args, seed, floorSeed, {})

  // 6. diagnostic shared-set variant, only when the fixture populations differ
  const sharedVariant = runSharedVariant(repoRoot, roundDir, code, args, seed, metrics, modelsDir)
  return { metrics, trials: args.trials, sharedVariant }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (args.round === undefined || !/^\d+$/.test(args.round)) {
    console.error('--round NN is required (digits only)')
    console.error(usage())
    return 2
  }
  if (!Number.isInteger(args.trials) || args.trials < 1) throw new Error('--trials must be a positive integer')
  const roundNumber = Number(args.round)
  const seed = args.seed ?? roundNumber * 7919 + 1
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer')

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const outRoot = path.resolve(args.out ?? path.join(repoRoot, DEFAULT_OUT_DIR))
  const roundDir = path.join(outRoot, args.round.padStart(2, '0'))
  mkdirSync(roundDir, { recursive: true })

  const rows: string[] = []
  for (const code of args.floors) {
    const { metrics, trials, sharedVariant } = runFloor(repoRoot, roundDir, code, args, seed)
    rows.push(
      [
        `${code}: ${metrics.verdict.toUpperCase()}`,
        `obstruction ${metrics.obstruction} (unknown ${metrics.unknownProbes})`,
        `stacks ${metrics.ourStackCount}/${metrics.engineerStackCount} = ${formatNumber(metrics.stacksRatio)}`,
        `mean dist ${formatNumber(metrics.meanDistToEngineerStackM)} m`,
        `branch ${formatNumber(metrics.branchRatio)} on ${metrics.sharedFixtures.shared}/${metrics.sharedFixtures.fixtures} shared fixtures (full union ${formatNumber(metrics.branchRatioFullUnion)}, literal band ${formatNumber(metrics.branchRatioLiteralBand)})`,
        `coverage: only engineer serves ${metrics.sharedFixtures.fixturesOnlyEngineerServes}, only we serve ${metrics.sharedFixtures.fixturesOnlyWeServe}, engineer free ends without a detected fixture ${metrics.sharedFixtures.engineerLeafEndsWithoutFixture}`,
        `routed ${formatNumber(metrics.routedFraction)}`,
        trials > 0 ? `${trials} trial pair(s) → run the critic (CRITIC.md), then tally-round.ts` : 'no trials (loss by metrics)',
      ].join(' · '),
    )
    if (sharedVariant !== null) rows.push(`    ${sharedVariant.code}: diagnostic shared-set variant, ${sharedVariant.trials} trial pair(s) (not gated)`)
    for (const line of metrics.reds) rows.push(`    red: ${line}`)
  }
  console.log(`Round ${args.round} → ${roundDir} (seed ${seed})`)
  for (const row of rows) console.log(row)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
