import type { FixtureKind, StoreyId } from '@/domain/types'

/**
 * Pure chooser for the storey to auto-open right after a model is parsed.
 *
 * Replaces the old "find the floor named 2" name heuristic, which broke on
 * real projects where a technical roof storey happened to match the name
 * (e.g. "R2"). The chooser works from per-storey fixture evidence instead:
 *
 * 1. Candidates are storeys with detected toilets (fallback tiers below).
 * 2. Candidates are grouped into fixture FAMILIES (see
 *    {@link buildFamilyKey}): storeys with the same toilet count and the same
 *    set of fixture kinds belong to one family, even if their non-toilet
 *    counts differ (2 WC + 2 basins and 2 WC + 4 basins are one family; 2 WC
 *    alone and 2 WC + 1 basin are not). This treats repeated typical floors as
 *    one shaft family while a basin modelled twice does not split them.
 * 3. Each family gets an explainable weight:
 *
 *        weight = family size × mean fixtures per storey
 *               = total fixtures across the family's storeys
 *
 *    where "fixtures" is the sum of every per-kind count in a storey's
 *    fingerprint (toilets + basins + sinks + baths + urinals + bidets +
 *    cisterns + other), see {@link countFixturesInFingerprint}. Three typical
 *    floors × 2 fixtures (6) beat one floor with 5 fixtures; one reference
 *    floor with 11 fixtures beats three floors × 2. All-singleton models
 *    therefore open the storey with the most fixtures, not the lowest one.
 * 4. Families are ranked deterministically ({@link compareFamilies}):
 *    higher weight → more toilets (toilets drive riser placement) → larger
 *    family (repetition = typical floor) → lower elevation of the family's
 *    lowest storey → lower storey id. The chosen storey is the LOWEST member
 *    of the winning family (drainage runs down, so the base of a shaft family
 *    is the natural place to start).
 * 5. Roof / technical storeys (names matching `^R\d+$`, containing "roof",
 *    or the Hebrew "גג") are never chosen while any non-technical storey
 *    carries fixtures, even if the technical storey has fixtures itself.
 *    Regular Hebrew floor names like "קומה 2" never match these filters.
 * 6. Fallbacks when no storey has toilets, in order: storeys with any
 *    fixtures (same family/weight rules), then the lowest non-technical
 *    storey, then the lowest storey overall. An empty storey set yields null.
 *
 * Same input always produces the same choice, regardless of input order.
 */

export interface InitialStoreySummary {
  id: StoreyId
  name: string
  elevation: number
  toiletCount: number
  /**
   * Deterministic per-storey fixture fingerprint from
   * {@link buildFixtureFingerprint}. Empty string = no fixtures detected.
   */
  fixtureFingerprint: string
}

export interface InitialStoreyChoice {
  storeyId: StoreyId | null
  /** Human-readable explanation of why this storey was picked (Decisions/debug). */
  reason: string
}

/**
 * One scored fixture family (see module doc). Exposed so tests and debug
 * output can show the full ranking, not just the winner.
 */
export interface InitialStoreyFamily {
  /** `<toiletCount>|<KIND+KIND…>`, see {@link buildFamilyKey}. */
  key: string
  /** Toilet count shared by every member. */
  toiletCount: number
  /** Sorted by elevation, then id — index 0 is the family's lowest storey. */
  members: InitialStoreySummary[]
  /** Sum of {@link countFixturesInFingerprint} over all members. */
  totalFixtureCount: number
  /** `totalFixtureCount / members.length`. */
  meanFixturesPerStorey: number
  /** `members.length × meanFixturesPerStorey` (equals `totalFixtureCount`). */
  weight: number
}

/**
 * Builds the fixture fingerprint for one storey: non-zero per-kind counts,
 * sorted by kind name, joined as `KIND:count|KIND:count`. Deterministic for
 * a given count map; identical residential floors produce identical strings.
 */
export function buildFixtureFingerprint(countsByKind: Partial<Record<FixtureKind, number>>): string {
  return (Object.entries(countsByKind) as Array<[FixtureKind, number | undefined]>)
    .filter((entry): entry is [FixtureKind, number] => (entry[1] ?? 0) > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([kind, count]) => `${kind}:${count}`)
    .join('|')
}

/** Inverse of {@link buildFixtureFingerprint}: `[kind, count]` pairs in fingerprint order. */
export function parseFixtureFingerprint(fingerprint: string): Array<[string, number]> {
  if (fingerprint === '') return []
  return fingerprint.split('|').map((part) => {
    const separator = part.lastIndexOf(':')
    const kind = separator === -1 ? part : part.slice(0, separator)
    const count = separator === -1 ? NaN : Number(part.slice(separator + 1))
    return [kind, Number.isFinite(count) && count > 0 ? count : 0]
  })
}

/**
 * Number of fixtures a storey carries: the sum of every per-kind count in its
 * fingerprint. Every detected kind counts as one fixture — toilets, basins,
 * sinks, baths, urinals, bidets, cisterns and "other" alike — because all of
 * them are drainage evidence and the same rule applies to every storey, so
 * the comparison between storeys stays fair.
 */
export function countFixturesInFingerprint(fingerprint: string): number {
  return parseFixtureFingerprint(fingerprint).reduce((sum, [, count]) => sum + count, 0)
}

/**
 * Family key of a storey: its toilet count plus the sorted set of fixture
 * kinds present, e.g. `2|TOILETPAN+WASHHANDBASIN`. Storeys with the same key
 * are treated as repetitions of the same typical floor even if their
 * non-toilet counts differ.
 */
export function buildFamilyKey(storey: InitialStoreySummary): string {
  const kinds = parseFixtureFingerprint(storey.fixtureFingerprint).map(([kind]) => kind)
  return `${storey.toiletCount}|${kinds.join('+')}`
}

/**
 * True for roof / technical storey names that must never be auto-opened while
 * a fixture-bearing regular storey exists: `R0`/`R1`/`R2`… (common technical
 * storey codes), anything containing "roof", or the Hebrew "גג". Kept
 * intentionally narrow so real floor names (Hebrew "קומה 2", "Level 1",
 * "GF", "B1"…) are never caught.
 */
export function isTechnicalStoreyName(name: string): boolean {
  const trimmed = name.trim()
  return /^r\d+$/i.test(trimmed) || /roof/i.test(trimmed) || /גג/.test(trimmed)
}

interface CandidateTier {
  candidates: InitialStoreySummary[]
  label: string
}

/**
 * Candidate tiers, first non-empty wins. Technical storeys only become
 * candidates when no regular storey qualifies at the same evidence level.
 */
function selectCandidateTier(storeys: InitialStoreySummary[]): CandidateTier {
  const regular = storeys.filter((storey) => !isTechnicalStoreyName(storey.name))
  const technical = storeys.filter((storey) => isTechnicalStoreyName(storey.name))
  const hasFixtures = (storey: InitialStoreySummary) => storey.fixtureFingerprint !== ''
  const hasToilets = (storey: InitialStoreySummary) => storey.toiletCount > 0

  const tiers: CandidateTier[] = [
    { candidates: regular.filter(hasToilets), label: 'toilet-bearing storeys' },
    { candidates: technical.filter(hasToilets), label: 'toilet-bearing technical storeys (no regular storey has toilets)' },
    { candidates: regular.filter(hasFixtures), label: 'fixture-bearing storeys (no toilets detected anywhere)' },
    { candidates: technical.filter(hasFixtures), label: 'fixture-bearing technical storeys (no toilets detected anywhere)' },
    { candidates: regular, label: 'storeys (no fixtures detected anywhere)' },
    { candidates: storeys, label: 'technical storeys (nothing else exists)' },
  ]
  return tiers.find((entry) => entry.candidates.length > 0)!
}

/**
 * Scores the candidate tier of `storeys` and returns its fixture families
 * ranked best-first (see module doc). Empty input yields an empty array.
 */
export function rankInitialStoreyFamilies(storeys: InitialStoreySummary[]): InitialStoreyFamily[] {
  if (storeys.length === 0) return []
  return groupIntoFamilies(selectCandidateTier(storeys).candidates).sort(compareFamilies)
}

export function chooseInitialStorey(storeys: InitialStoreySummary[]): InitialStoreyChoice {
  if (storeys.length === 0) {
    return { storeyId: null, reason: 'No storeys parsed; nothing to auto-open.' }
  }

  const tier = selectCandidateTier(storeys)
  const families = groupIntoFamilies(tier.candidates).sort(compareFamilies)
  const winner = families[0]
  const runnerUp = families[1]
  const chosen = winner.members[0]

  const runnerUpText = runnerUp
    ? `; runner-up ${describeFamily(runnerUp)}`
    : ''
  const reason =
    `Lowest of ${winner.members.length} ${tier.label} in the heaviest fixture family ` +
    `${describeFamily(winner)}; chosen storey fingerprint "${chosen.fixtureFingerprint || 'none'}" ` +
    `(${families.length} famil${families.length === 1 ? 'y' : 'ies'} among ${tier.candidates.length} ` +
    `candidate(s)${runnerUpText}; weight = storeys × mean fixtures per storey, ties → more toilets → ` +
    `larger family → lower elevation; roof/technical storeys excluded while regular storeys qualify).`

  return { storeyId: chosen.id, reason }
}

function describeFamily(family: InitialStoreyFamily): string {
  const names = family.members.map((member) => `"${member.name}"`).join(', ')
  return (
    `[${names}] (weight ${formatNumber(family.weight)} = ${family.members.length} × ` +
    `${formatNumber(family.meanFixturesPerStorey)} fixtures/storey, ${family.toiletCount} toilet(s)/storey)`
  )
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function groupIntoFamilies(candidates: InitialStoreySummary[]): InitialStoreyFamily[] {
  const byKey = new Map<string, InitialStoreySummary[]>()
  for (const storey of candidates) {
    const key = buildFamilyKey(storey)
    const members = byKey.get(key) ?? []
    members.push(storey)
    byKey.set(key, members)
  }
  return Array.from(byKey, ([key, unsorted]) => {
    const members = [...unsorted].sort(compareStoreys)
    const totalFixtureCount = members.reduce(
      (sum, member) => sum + countFixturesInFingerprint(member.fixtureFingerprint),
      0,
    )
    const meanFixturesPerStorey = totalFixtureCount / members.length
    return {
      key,
      toiletCount: members[0].toiletCount,
      members,
      totalFixtureCount,
      meanFixturesPerStorey,
      // size × mean == total; use the exact integer so ties are never lost to
      // floating-point rounding of the mean.
      weight: totalFixtureCount,
    }
  })
}

/** Best family first: weight desc → toilets desc → size desc → lowest member asc. */
function compareFamilies(left: InitialStoreyFamily, right: InitialStoreyFamily): number {
  if (left.weight !== right.weight) return right.weight - left.weight
  if (left.toiletCount !== right.toiletCount) return right.toiletCount - left.toiletCount
  if (left.members.length !== right.members.length) return right.members.length - left.members.length
  return compareStoreys(left.members[0], right.members[0])
}

function compareStoreys(left: InitialStoreySummary, right: InitialStoreySummary): number {
  if (left.elevation !== right.elevation) return left.elevation - right.elevation
  return left.id - right.id
}
