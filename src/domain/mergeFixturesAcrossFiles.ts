import type { Fixture, FixtureKind, KitchenArea } from './types'

/**
 * Cross-file fixture merge for one aligned storey (W4, per-kind radii in V2).
 *
 * When the same physical fixture is modeled in more than one IFC file (e.g.
 * the architect and the plumbing engineer both placed the toilet), detection
 * across files would double-count it. Two fixtures are treated as the same
 * physical object when they have the same kind and their plan positions are
 * within the kind's dedupe radius of each other (see
 * {@link CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND}). Dedupe is always
 * same-kind: a multi-bowl SINK unit next to individual WASHHANDBASINs is two
 * different kinds and is never collapsed, even at the same position.
 *
 * Winner rule (deterministic): sources are merged in descending
 * `mergePriority`, ties broken by upload order (host first, then linked files
 * in order). A fixture is kept when no already-merged same-kind fixture lies
 * within its radius; otherwise it is recorded as a duplicate of the NEAREST
 * such fixture and excluded. With the default priority (0 everywhere) the host
 * file therefore always wins — upload the sanitary/MEP model as host when its
 * positions should be preferred. A caller that knows a linked file carries the
 * engineer evidence can set a higher `mergePriority` on it; the IFC files
 * themselves carry no reliable per-fixture MEP signal (both disciplines export
 * plain IfcFlowTerminals), so the priority is an explicit input, never
 * inferred.
 *
 * Positions are viewer metres (web-ifc world frame, Y-up); plan distance is
 * measured on the X/Z axes. Fixtures without a position can never be proven
 * duplicates, so they are always kept.
 */

/**
 * Default dedupe radius for kinds without an override. 120 mm covers exporter
 * jitter and small family-origin differences of compact fixtures.
 */
export const CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM = 120
export const CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_M = CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM / 1000

/**
 * Per-kind dedupe radii (mm). Architect and engineer families of the same
 * fixture place their insertion/centroid differently (a WC family with or
 * without its cistern shifts the centroid along the pan axis), so the radius
 * has to absorb the family-origin offset while staying well below the minimum
 * centre-to-centre spacing of adjacent fixtures of that kind:
 *
 *   - TOILETPAN     400 mm — measured architect-vs-engineer offsets on a real
 *                            project were 265–340 mm; adjacent WCs are >= 800 mm
 *                            apart (stall pitch), so 400 mm = half that pitch.
 *   - WASHHANDBASIN 300 mm — half of a tight 600 mm basin pitch; basins are
 *                            shallower than WCs so their family offsets are
 *                            smaller.
 *   - everything else: {@link CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM} (120 mm).
 */
export const CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND: Readonly<
  Partial<Record<FixtureKind, number>>
> = Object.freeze({
  TOILETPAN: 400,
  WASHHANDBASIN: 300,
})

export function crossFileDedupeDistanceMm(kind: FixtureKind): number {
  return CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND[kind] ?? CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM
}

export interface SourcedStoreyDetection {
  fileName: string
  /** Fixtures detected on this file's aligned storey; positions in viewer metres. */
  fixtures: Fixture[]
  /** Kitchen areas detected on this file's aligned storey. */
  kitchens: KitchenArea[]
  /**
   * Merge precedence; higher merges first and wins duplicate conflicts.
   * Default 0. Ties keep upload order (host, then linked files in order).
   */
  mergePriority?: number
}

export interface CrossFileDuplicate {
  kind: FixtureKind
  keptFileName: string
  keptExpressId: number
  droppedFileName: string
  droppedExpressId: number
  /** Plan distance between the two instances, rounded to 0.1 mm. */
  distanceMm: number
  /** The per-kind radius that made them duplicates. */
  toleranceMm: number
}

export interface FixtureMergeFileSummary {
  fileName: string
  detectedFixtureCount: number
  /** Fixtures from this file that survived into the merged set. */
  mergedFixtureCount: number
  /** Fixtures from this file dropped as duplicates of a higher-precedence file's instance. */
  duplicateFixtureCount: number
  kitchenCount: number
}

export interface MergedStoreyDetection {
  fixtures: Fixture[]
  kitchens: KitchenArea[]
  duplicates: CrossFileDuplicate[]
  /** In upload order (host first), regardless of merge priority. */
  perFile: FixtureMergeFileSummary[]
  /**
   * Default radius (mm) for kinds without a per-kind override; see
   * {@link CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND} for the overrides.
   */
  dedupeToleranceMm: number
}

interface MergedEntry {
  fixture: Fixture
  fileName: string
}

/**
 * Merges per-file detections for one aligned storey per the module rules.
 * Kitchens are concatenated from every file in upload order — kitchen spaces
 * come from whichever file models them, and they are not deduped.
 */
export function mergeStoreyDetections(
  host: SourcedStoreyDetection,
  linked: SourcedStoreyDetection[],
): MergedStoreyDetection {
  const uploadOrder = [host, ...linked]
  const mergeOrder = uploadOrder
    .map((source, uploadIndex) => ({ source, uploadIndex }))
    .sort(
      (a, b) =>
        (b.source.mergePriority ?? 0) - (a.source.mergePriority ?? 0) || a.uploadIndex - b.uploadIndex,
    )

  const merged: MergedEntry[] = []
  const duplicates: CrossFileDuplicate[] = []
  const mergedCountByUploadIndex = new Array<number>(uploadOrder.length).fill(0)

  for (const { source, uploadIndex } of mergeOrder) {
    for (const fixture of source.fixtures) {
      const existing = findDuplicate(merged, fixture)
      if (existing === null) {
        merged.push({ fixture, fileName: source.fileName })
        mergedCountByUploadIndex[uploadIndex] += 1
        continue
      }
      duplicates.push({
        kind: fixture.kind,
        keptFileName: existing.fileName,
        keptExpressId: existing.fixture.expressId,
        droppedFileName: source.fileName,
        droppedExpressId: fixture.expressId,
        distanceMm: existing.distanceMm,
        toleranceMm: crossFileDedupeDistanceMm(fixture.kind),
      })
    }
  }

  const perFile: FixtureMergeFileSummary[] = uploadOrder.map((source, uploadIndex) => ({
    fileName: source.fileName,
    detectedFixtureCount: source.fixtures.length,
    mergedFixtureCount: mergedCountByUploadIndex[uploadIndex],
    duplicateFixtureCount: source.fixtures.length - mergedCountByUploadIndex[uploadIndex],
    kitchenCount: source.kitchens.length,
  }))

  return {
    fixtures: merged.map((entry) => entry.fixture),
    kitchens: uploadOrder.flatMap((source) => source.kitchens),
    duplicates,
    perFile,
    dedupeToleranceMm: CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM,
  }
}

function findDuplicate(
  merged: MergedEntry[],
  candidate: Fixture,
): { fixture: Fixture; fileName: string; distanceMm: number } | null {
  if (candidate.position === null) return null

  const toleranceM = crossFileDedupeDistanceMm(candidate.kind) / 1000
  let best: { fixture: Fixture; fileName: string; distanceM: number } | null = null
  for (const entry of merged) {
    if (entry.fixture.kind !== candidate.kind) continue
    if (entry.fixture.position === null) continue
    const distanceM = Math.hypot(
      entry.fixture.position.x - candidate.position.x,
      entry.fixture.position.z - candidate.position.z,
    )
    if (distanceM > toleranceM) continue
    if (best === null || distanceM < best.distanceM) {
      best = { ...entry, distanceM }
    }
  }
  return best === null
    ? null
    : { fixture: best.fixture, fileName: best.fileName, distanceMm: roundToTenthMm(best.distanceM) }
}

function roundToTenthMm(valueM: number): number {
  return Math.round(valueM * 10_000) / 10
}
