import type { Fixture, FixtureKind, KitchenArea } from './types'

/**
 * Cross-file fixture merge for one aligned storey (W4).
 *
 * When the same physical fixture is modeled in more than one IFC file (e.g.
 * the architect and the plumbing engineer both placed the toilet), detection
 * across files would double-count it. Two fixtures are treated as the same
 * physical object when they have the same kind and their plan positions are
 * within {@link CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM} of each other.
 *
 * The host file always wins: host fixtures are merged first and are never
 * dropped; linked-file fixtures that duplicate an already-merged fixture are
 * recorded (not silently discarded) and excluded from the merged set.
 *
 * Positions are viewer metres (web-ifc world frame, Y-up); plan distance is
 * measured on the X/Z axes. Fixtures without a position can never be proven
 * duplicates, so they are always kept.
 */

export const CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM = 120
export const CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_M = CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM / 1000

export interface SourcedStoreyDetection {
  fileName: string
  /** Fixtures detected on this file's aligned storey; positions in viewer metres. */
  fixtures: Fixture[]
  /** Kitchen areas detected on this file's aligned storey. */
  kitchens: KitchenArea[]
}

export interface CrossFileDuplicate {
  kind: FixtureKind
  keptFileName: string
  keptExpressId: number
  droppedFileName: string
  droppedExpressId: number
  /** Plan distance between the two instances, rounded to 0.1 mm. */
  distanceMm: number
}

export interface FixtureMergeFileSummary {
  fileName: string
  detectedFixtureCount: number
  /** Fixtures from this file that survived into the merged set. */
  mergedFixtureCount: number
  /** Fixtures from this file dropped as duplicates of an earlier file's instance. */
  duplicateFixtureCount: number
  kitchenCount: number
}

export interface MergedStoreyDetection {
  fixtures: Fixture[]
  kitchens: KitchenArea[]
  duplicates: CrossFileDuplicate[]
  perFile: FixtureMergeFileSummary[]
  dedupeToleranceMm: number
}

/**
 * Merges per-file detections for one aligned storey. `host` fixtures are kept
 * unconditionally; each linked file is merged in order, dropping fixtures that
 * duplicate an already-merged instance (host preference falls out of the
 * host-first order). Kitchens are concatenated from every file — kitchen
 * spaces come from whichever file models them, and they are not deduped.
 */
export function mergeStoreyDetections(
  host: SourcedStoreyDetection,
  linked: SourcedStoreyDetection[],
): MergedStoreyDetection {
  const merged: Array<{ fixture: Fixture; fileName: string }> = host.fixtures.map((fixture) => ({
    fixture,
    fileName: host.fileName,
  }))
  const duplicates: CrossFileDuplicate[] = []
  const perFile: FixtureMergeFileSummary[] = [
    {
      fileName: host.fileName,
      detectedFixtureCount: host.fixtures.length,
      mergedFixtureCount: host.fixtures.length,
      duplicateFixtureCount: 0,
      kitchenCount: host.kitchens.length,
    },
  ]

  for (const source of linked) {
    let mergedCount = 0
    for (const fixture of source.fixtures) {
      const existing = findDuplicate(merged, fixture)
      if (existing === null) {
        merged.push({ fixture, fileName: source.fileName })
        mergedCount += 1
        continue
      }
      duplicates.push({
        kind: fixture.kind,
        keptFileName: existing.fileName,
        keptExpressId: existing.fixture.expressId,
        droppedFileName: source.fileName,
        droppedExpressId: fixture.expressId,
        distanceMm: existing.distanceMm,
      })
    }
    perFile.push({
      fileName: source.fileName,
      detectedFixtureCount: source.fixtures.length,
      mergedFixtureCount: mergedCount,
      duplicateFixtureCount: source.fixtures.length - mergedCount,
      kitchenCount: source.kitchens.length,
    })
  }

  return {
    fixtures: merged.map((entry) => entry.fixture),
    kitchens: [host, ...linked].flatMap((source) => source.kitchens),
    duplicates,
    perFile,
    dedupeToleranceMm: CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM,
  }
}

function findDuplicate(
  merged: Array<{ fixture: Fixture; fileName: string }>,
  candidate: Fixture,
): { fixture: Fixture; fileName: string; distanceMm: number } | null {
  if (candidate.position === null) return null

  let best: { fixture: Fixture; fileName: string; distanceM: number } | null = null
  for (const entry of merged) {
    if (entry.fixture.kind !== candidate.kind) continue
    if (entry.fixture.position === null) continue
    const distanceM = Math.hypot(
      entry.fixture.position.x - candidate.position.x,
      entry.fixture.position.z - candidate.position.z,
    )
    if (distanceM > CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_M) continue
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
