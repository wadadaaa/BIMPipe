import type { FixtureKind, StoreyId } from '@/domain/types'

/**
 * Pure chooser for the storey to auto-open right after a model is parsed.
 *
 * Replaces the old "find the floor named 2" name heuristic, which broke on
 * real projects where a technical roof storey happened to match the name
 * (e.g. "R2"). The chooser works from per-storey fixture evidence instead:
 *
 * 1. Candidates are storeys with detected toilets.
 * 2. Storeys are grouped by their fixture fingerprint (see
 *    {@link buildFixtureFingerprint}); similarity is EXACT fingerprint
 *    equality — deliberately conservative so a group only contains storeys
 *    with identical per-kind fixture counts (typical repeated residential
 *    floors). The chosen storey is the lowest (by elevation) member of the
 *    LARGEST group.
 * 3. Roof / technical storeys (names matching `^R\d+$`, containing "roof",
 *    or the Hebrew "גג") are never chosen while any non-technical storey
 *    carries fixtures, even if the technical storey has fixtures itself.
 *    Regular Hebrew floor names like "קומה 2" never match these filters.
 * 4. Fallbacks when no storey has toilets, in order: storeys with any
 *    fixtures (same grouping rules), then the lowest non-technical storey,
 *    then the lowest storey overall. An empty storey set yields null.
 *
 * All ties are broken deterministically: lowest elevation first, then lowest
 * storey id. Same input always produces the same choice.
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

export function chooseInitialStorey(storeys: InitialStoreySummary[]): InitialStoreyChoice {
  if (storeys.length === 0) {
    return { storeyId: null, reason: 'No storeys parsed; nothing to auto-open.' }
  }

  const regular = storeys.filter((storey) => !isTechnicalStoreyName(storey.name))
  const technical = storeys.filter((storey) => isTechnicalStoreyName(storey.name))
  const hasFixtures = (storey: InitialStoreySummary) => storey.fixtureFingerprint !== ''
  const hasToilets = (storey: InitialStoreySummary) => storey.toiletCount > 0

  // Candidate tiers, first non-empty wins. Technical storeys only become
  // candidates when no regular storey qualifies at the same evidence level.
  const tiers: Array<{ candidates: InitialStoreySummary[]; label: string }> = [
    { candidates: regular.filter(hasToilets), label: 'toilet-bearing storeys' },
    { candidates: technical.filter(hasToilets), label: 'toilet-bearing technical storeys (no regular storey has toilets)' },
    { candidates: regular.filter(hasFixtures), label: 'fixture-bearing storeys (no toilets detected anywhere)' },
    { candidates: technical.filter(hasFixtures), label: 'fixture-bearing technical storeys (no toilets detected anywhere)' },
    { candidates: regular, label: 'storeys (no fixtures detected anywhere)' },
    { candidates: storeys, label: 'technical storeys (nothing else exists)' },
  ]
  const tier = tiers.find((entry) => entry.candidates.length > 0)!

  const groups = groupByFingerprint(tier.candidates)
  const winner = groups.reduce((best, group) => {
    if (group.members.length !== best.members.length) {
      return group.members.length > best.members.length ? group : best
    }
    // Equal group sizes: prefer the group whose lowest storey sorts first.
    return compareStoreys(group.members[0], best.members[0]) < 0 ? group : best
  })
  const chosen = winner.members[0]

  const reason =
    `Lowest of ${winner.members.length} ${tier.label} sharing fixture fingerprint ` +
    `"${chosen.fixtureFingerprint || 'none'}" (${groups.length} fingerprint group(s) among ` +
    `${tier.candidates.length} candidate(s); roof/technical storeys excluded while regular storeys qualify).`

  return { storeyId: chosen.id, reason }
}

interface FingerprintGroup {
  fingerprint: string
  /** Sorted by elevation, then id — index 0 is the group's lowest storey. */
  members: InitialStoreySummary[]
}

function groupByFingerprint(candidates: InitialStoreySummary[]): FingerprintGroup[] {
  const byFingerprint = new Map<string, InitialStoreySummary[]>()
  for (const storey of candidates) {
    const members = byFingerprint.get(storey.fixtureFingerprint) ?? []
    members.push(storey)
    byFingerprint.set(storey.fixtureFingerprint, members)
  }
  return Array.from(byFingerprint, ([fingerprint, members]) => ({
    fingerprint,
    members: [...members].sort(compareStoreys),
  }))
}

function compareStoreys(left: InitialStoreySummary, right: InitialStoreySummary): number {
  if (left.elevation !== right.elevation) return left.elevation - right.elevation
  return left.id - right.id
}
