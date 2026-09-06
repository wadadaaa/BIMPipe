import type { FixtureKind } from './types'

/**
 * Per-kind defaults for horizontal branch runs (V5) — the single table every
 * routing, UI and export consumer reads. Values are nominal pipe diameters in
 * millimetres and a dimensionless design slope.
 *
 * Diameter rule for a branch-run segment (see {@link resolveBranchSegmentDiameterMm}):
 *  1. the largest per-kind diameter among the fixtures the segment serves
 *     (a run that carries a WC is Ø110 all the way to the stack);
 *  2. a shared run serving ≥ {@link BRANCH_COLLECTOR_MIN_FIXTURES} small
 *     fixtures (no WC) is upgraded to the Ø63 collector.
 *
 * Honesty note on the collector: the brief calls it a "shower collector". The
 * fixture classifier has no shower kind (showers and baths both classify as
 * `BATH`), so the collector rule is applied to any shared run of ≥ 2 small
 * fixtures — showers/baths, basins, sinks, urinals — not to showers only.
 * Urinals default to Ø50 (no documented value existed in the codebase before).
 */
export const BRANCH_DIAMETER_MM_BY_FIXTURE_KIND: Readonly<Record<FixtureKind, number>> = {
  TOILETPAN: 110,
  WASHHANDBASIN: 50,
  SINK: 50,
  BATH: 50,
  URINAL: 50,
  BIDET: 50,
  CISTERN: 50,
  OTHER: 50,
}

/** Shared run of ≥ 2 small (non-WC) fixtures. */
export const BRANCH_COLLECTOR_DIAMETER_MM = 63
export const BRANCH_COLLECTOR_MIN_FIXTURES = 2

/** Design slope of every horizontal branch run: 2.0 % (20 mm per 1000 mm). */
export const BRANCH_SLOPE_PERCENT = 2.0
export const DEFAULT_BRANCH_SLOPE_DROP_MM = 20
export const DEFAULT_BRANCH_SLOPE_RUN_MM = 1000

/** Dimensionless drop/run ratio (0.02); identical for mm- and m-scale plans. */
export const BRANCH_SLOPE_RATIO = DEFAULT_BRANCH_SLOPE_DROP_MM / DEFAULT_BRANCH_SLOPE_RUN_MM

/** Diameter written when a segment carries no served-fixture information. */
export const BRANCH_FALLBACK_DIAMETER_MM = BRANCH_DIAMETER_MM_BY_FIXTURE_KIND.TOILETPAN

export function branchDiameterForFixtureKind(kind: FixtureKind): number {
  return BRANCH_DIAMETER_MM_BY_FIXTURE_KIND[kind]
}

/**
 * Nominal diameter of one branch-run segment from the kinds of the fixtures
 * whose flow passes through it (one entry per served fixture; duplicates are
 * meaningful because two basins make a collector). Empty input → fallback.
 */
export function resolveBranchSegmentDiameterMm(servedFixtureKinds: readonly FixtureKind[]): number {
  if (servedFixtureKinds.length === 0) return BRANCH_FALLBACK_DIAMETER_MM
  let largest = 0
  for (const kind of servedFixtureKinds) {
    largest = Math.max(largest, branchDiameterForFixtureKind(kind))
  }
  const isCollector =
    servedFixtureKinds.length >= BRANCH_COLLECTOR_MIN_FIXTURES && largest < BRANCH_COLLECTOR_DIAMETER_MM
  return isCollector ? BRANCH_COLLECTOR_DIAMETER_MM : largest
}

export function formatBranchSlopePercent(): string {
  return `${BRANCH_SLOPE_PERCENT.toFixed(1)} %`
}
