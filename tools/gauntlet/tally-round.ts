#!/usr/bin/env node
/**
 * Tally the critic answers of one round: parse the raw replies saved under
 * `rounds/NN/<F>/critic/trial-<t>.txt`, map A/B to ours/engineer through the
 * hidden `key.json`, and write `verdicts.json` + `summary.json`.
 *
 *   node tools/gauntlet/tally-round.ts --round 00 [--floors F1,F2] [--out <dir>]
 *
 * A reply must contain the three lines of the critic format (CRITIC.md):
 *   WINNER: A|B
 *   CONFIDENCE: low|medium|high
 *   GAP: <one sentence>
 * The gap sentence is classified into the fixed category list by keyword;
 * anything else is `other`. Unparseable replies are listed, never guessed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_OUT_DIR = 'external/gauntlet/rounds'

export const GAP_CATEGORIES = [
  'stack location',
  'collector geometry',
  'run along walls vs diagonal',
  'crossings',
  'missing sleeves',
  'unrealistic slopes/diameters',
  'other',
] as const
export type GapCategory = (typeof GAP_CATEGORIES)[number]

/** Keyword → category, checked in order; the first hit wins. */
const GAP_KEYWORDS: ReadonlyArray<[RegExp, GapCategory]> = [
  [/stack location|stack placement|stack position|riser location|riser placement|location of (the )?stacks?/i, 'stack location'],
  [/collector/i, 'collector geometry'],
  [/along walls?|diagonal/i, 'run along walls vs diagonal'],
  [/crossing/i, 'crossings'],
  [/sleeve/i, 'missing sleeves'],
  [/slope|diameter|gradient|ø/i, 'unrealistic slopes/diameters'],
]

export interface ParsedCriticReply {
  winner: 'A' | 'B'
  confidence: 'low' | 'medium' | 'high'
  gapText: string
  gap: GapCategory
}

export function classifyGap(text: string): GapCategory {
  const trimmed = text.trim()
  for (const category of GAP_CATEGORIES) {
    if (trimmed.toLowerCase().startsWith(category)) return category
  }
  for (const [pattern, category] of GAP_KEYWORDS) if (pattern.test(trimmed)) return category
  return 'other'
}

export function parseCriticReply(raw: string): ParsedCriticReply | { error: string } {
  const winner = /^\s*\**WINNER\**\s*:\s*\**\s*([AB])\b/im.exec(raw)
  const confidence = /^\s*\**CONFIDENCE\**\s*:\s*\**\s*(low|medium|high)\b/im.exec(raw)
  const gap = /^\s*\**GAP\**\s*:\s*\**\s*(.+)$/im.exec(raw)
  if (winner === null) return { error: 'no WINNER line' }
  if (confidence === null) return { error: 'no CONFIDENCE line' }
  if (gap === null) return { error: 'no GAP line' }
  const gapText = gap[1].trim()
  return {
    winner: winner[1].toUpperCase() as 'A' | 'B',
    confidence: confidence[1].toLowerCase() as 'low' | 'medium' | 'high',
    gapText,
    gap: classifyGap(gapText),
  }
}

interface KeyFile {
  round: string
  floor: string
  seed: number
  trials: Array<{ trial: string; ours: 'A' | 'B' }>
}

interface TrialVerdict {
  trial: string
  winnerSide: 'A' | 'B'
  winner: 'ours' | 'engineer'
  confidence: 'low' | 'medium' | 'high'
  gap: GapCategory
  gapText: string
}

function parseArgs(argv: string[]): { round?: string; floors?: string[]; out?: string; help: boolean } {
  const args: { round?: string; floors?: string[]; out?: string; help: boolean } = { help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      i += 1
      return value
    }
    if (arg === '--round') args.round = next()
    else if (arg === '--floors') args.floors = next().split(',').map((code) => code.trim())
    else if (arg === '--out') args.out = next()
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`Unknown argument ${arg}`)
  }
  return args
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function tallyFloor(floorDir: string): string {
  const keyPath = path.join(floorDir, 'key.json')
  if (!existsSync(keyPath)) return `${path.basename(floorDir)}: no key.json (no trials in this round)`
  const key = JSON.parse(readFileSync(keyPath, 'utf-8')) as KeyFile
  const criticDir = path.join(floorDir, 'critic')
  const verdicts: TrialVerdict[] = []
  const unparsed: Array<{ trial: string; error: string }> = []
  const missing: string[] = []
  for (const entry of key.trials) {
    const replyPath = path.join(criticDir, `${entry.trial}.txt`)
    if (!existsSync(replyPath)) {
      missing.push(entry.trial)
      continue
    }
    const parsed = parseCriticReply(readFileSync(replyPath, 'utf-8'))
    if ('error' in parsed) {
      unparsed.push({ trial: entry.trial, error: parsed.error })
      continue
    }
    verdicts.push({
      trial: entry.trial,
      winnerSide: parsed.winner,
      winner: parsed.winner === entry.ours ? 'ours' : 'engineer',
      confidence: parsed.confidence,
      gap: parsed.gap,
      gapText: parsed.gapText,
    })
  }

  const engineerPreferred = verdicts.filter((verdict) => verdict.winner === 'engineer').length
  const confidence = { low: 0, medium: 0, high: 0 }
  const gapHistogram: Record<GapCategory, number> = Object.fromEntries(GAP_CATEGORIES.map((category) => [category, 0])) as Record<GapCategory, number>
  // The gap to fix is the one named when OURS lost; gaps named against the engineer are kept apart.
  const gapAgainstOurs: Record<GapCategory, number> = { ...gapHistogram }
  for (const verdict of verdicts) {
    confidence[verdict.confidence] += 1
    gapHistogram[verdict.gap] += 1
    if (verdict.winner === 'engineer') gapAgainstOurs[verdict.gap] += 1
  }
  const mostFrequentGap =
    engineerPreferred === 0
      ? null
      : (Object.entries(gapAgainstOurs) as Array<[GapCategory, number]>).sort((a, b) => b[1] - a[1] || GAP_CATEGORIES.indexOf(a[0]) - GAP_CATEGORIES.indexOf(b[0]))[0][0]

  const verdictPath = path.join(floorDir, 'verdict.json')
  const verdictFile = existsSync(verdictPath) ? (JSON.parse(readFileSync(verdictPath, 'utf-8')) as { result: string; reason?: string[]; note?: string }) : null
  const summary = {
    round: key.round,
    floor: key.floor,
    trials: key.trials.length,
    answered: verdicts.length,
    missing,
    unparsed,
    engineerPreferred,
    oursPreferred: verdicts.length - engineerPreferred,
    confidence,
    gapHistogram,
    gapAgainstOurs,
    gapToFixNext: mostFrequentGap,
    metricsVerdict: verdictFile?.result ?? null,
    metricsReds: verdictFile?.reason ?? [],
  }
  writeJson(path.join(floorDir, 'verdicts.json'), verdicts)
  writeJson(path.join(floorDir, 'summary.json'), summary)
  if (verdictFile !== null && verdictFile.result === 'pending-critic') {
    writeJson(verdictPath, { result: 'critic-tallied', engineerPreferred, of: verdicts.length, gapToFixNext: mostFrequentGap })
  }
  return `${key.floor}: engineer preferred ${engineerPreferred}/${verdicts.length} · confidence low ${confidence.low} / medium ${confidence.medium} / high ${confidence.high} · gap to fix: ${mostFrequentGap ?? 'none (ours preferred every time)'}${missing.length > 0 ? ` · missing replies: ${missing.join(', ')}` : ''}${unparsed.length > 0 ? ` · unparsed: ${unparsed.map((entry) => `${entry.trial} (${entry.error})`).join(', ')}` : ''}`
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node tools/gauntlet/tally-round.ts --round NN [--floors F1,F2] [--out <dir>]')
    return 0
  }
  if (args.round === undefined) throw new Error('--round NN is required')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const roundDir = path.join(path.resolve(args.out ?? path.join(repoRoot, DEFAULT_OUT_DIR)), args.round.padStart(2, '0'))
  const floors = args.floors ?? readdirSync(roundDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  for (const code of floors) console.log(tallyFloor(path.join(roundDir, code)))
  return 0
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
