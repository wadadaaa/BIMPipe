import { z } from 'zod'

/**
 * Building typology switch (G3).
 *
 * The typology is chosen MANUALLY by the user on the upload screen (auto
 * detection is a later step) and drives the riser placement rule chain, the
 * horizontal branch routing and the branch length limit. Residential is the
 * default and is byte-identical to the pre-typology behaviour; every office
 * rule is opt-in through the `typology` option of the placement / assignment /
 * routing entry points:
 *
 *  - `suggestWetCoreRiserPositions` / `buildWetCoreSuggestedRisers`
 *    → `wetCore.typology`
 *  - `assignFixturesToRisers(fixtures, risers, { typology })`
 *  - `computeBranchRoutes(assignments, { rowCollectors })` (rows come from the
 *    wet-core suggestion, `WetCoreSuggestedRisers.rows`)
 *
 * The demo runtime ignores the typology entirely (same gate as `routingModel`:
 * the toilet-anchored path never reads it).
 */
export type BuildingTypology = 'residential' | 'office'

export const buildingTypologySchema = z.enum(['residential', 'office'])

export const BUILDING_TYPOLOGIES: readonly BuildingTypology[] = ['residential', 'office']

export const DEFAULT_BUILDING_TYPOLOGY: BuildingTypology = 'residential'

/** English UI labels (no hardcoded Hebrew in JSX per the i18n rule). */
export const BUILDING_TYPOLOGY_LABEL: Readonly<Record<BuildingTypology, string>> = {
  residential: 'Residential',
  office: 'Office',
}

export function isBuildingTypology(value: unknown): value is BuildingTypology {
  return buildingTypologySchema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// Branch length limit (per typology)
// ---------------------------------------------------------------------------

/**
 * Maximum horizontal branch length from a fixture to its stack, per typology,
 * as a mm/m constant pair.
 *
 *  - residential 4.0 m: the pre-typology `MAX_BRANCH_LENGTH_M` (unvented
 *    small-fixture branch drains; common code limits are 3–5 m).
 *  - office 12.0 m: **PLACEHOLDER** until the הל"ת (Israeli plumbing code,
 *    hora'ot le-mitkanei tavru'ah) value for collector runs in office wet
 *    cores is confirmed. Office toilet rows drain through a collector to a
 *    core shaft, so the run is legitimately longer than a residential branch,
 *    but the exact figure has not been verified against the code text.
 *
 * Over-length is always a WARNING (`exceedsMaxBranchLength`), never a block.
 */
export const BRANCH_LENGTH_LIMIT_M: Readonly<Record<BuildingTypology, number>> = {
  residential: 4.0,
  office: 12.0,
}
export const BRANCH_LENGTH_LIMIT_MM: Readonly<Record<BuildingTypology, number>> = {
  residential: 4000,
  office: 12000,
}

// ---------------------------------------------------------------------------
// Office placement constants (metres; mm pairs derived where the caller needs them)
// ---------------------------------------------------------------------------

/**
 * Footprint area window of a shaft-like slab opening. Smaller openings are
 * sleeves / single-pipe penetrations; larger ones are stair, lift or atrium
 * voids (excluded as stack targets but used as CORE anchors, see below).
 */
export const OFFICE_SHAFT_MIN_AREA_M2 = 0.1
export const OFFICE_SHAFT_MAX_AREA_M2 = 6

/**
 * Longest / shortest side of a shaft-like opening. A 6 m² opening that is
 * 6 × 1 m is a slot (duct riser, services trench), not a plumbing shaft.
 */
export const OFFICE_SHAFT_MAX_ASPECT_RATIO = 4

/**
 * A shaft candidate belongs to the building core when it lies within this
 * plan distance of a dense-structure cluster or of a stair / lift void.
 */
export const OFFICE_CORE_RADIUS_M = 6

/**
 * Dense-structure detection on the continuity grid: the fraction of
 * wall/column cells (slab cells do NOT count — slabs cover the whole floor)
 * inside a square window of {@link OFFICE_DENSE_WINDOW_M} that marks the
 * window as core-like. A single facade wall through a 3 m window covers
 * ≈ 0.25 m × 3 m / 9 m² ≈ 8 %; core walls (lift shafts, stair enclosures,
 * service rooms) cross the window several times.
 */
export const OFFICE_DENSE_WINDOW_M = 3
export const OFFICE_DENSE_STRUCTURE_MIN_DENSITY = 0.3

/**
 * Minimum footprint area of a vertical void that counts as a stair / lift
 * void (a core anchor). Such voids are excluded as stack targets by
 * {@link OFFICE_SHAFT_MAX_AREA_M2}; they anchor the core when they repeat on
 * ≥ 3 storeys (`aligned-void` candidates) or, on a single-storey map, when
 * they are simply large slab openings (reported as such).
 */
export const OFFICE_LARGE_VOID_MIN_AREA_M2 = 4

/**
 * Snap distance from the wet-core footprint to a core shaft in office mode.
 * Larger than the residential 1.5 m: office toilet rows drain along a
 * collector to the core, so the shaft can sit a few metres away.
 */
export const MAX_SNAP_OFFICE_M = 6
export const MAX_SNAP_OFFICE_MM = 6000

// ---------------------------------------------------------------------------
// Toilet-row collectors (office)
// ---------------------------------------------------------------------------

/** A row needs at least this many same-kind fixtures. */
export const ROW_MIN_FIXTURES = 3
/** Perpendicular scatter of the fixture centres around the row line. */
export const ROW_COLLINEARITY_TOLERANCE_M = 0.3
/** Largest gap between neighbouring fixtures along the row. */
export const ROW_MAX_SPACING_M = 2.0
/**
 * Offset of the collector line from the row of fixture centres, on the wall
 * side (behind the fixtures, in the service zone). Approximation: no duct
 * geometry is consulted.
 */
export const ROW_COLLECTOR_OFFSET_M = 0.3
/** How far behind a row we look for a wall/column cell to decide the wall side. */
export const ROW_WALL_SEARCH_M = 1.5

// ---------------------------------------------------------------------------
// Core collectors (R1): gather an obstructed core into a neighbour's stack
// ---------------------------------------------------------------------------

/**
 * Longest Manhattan run (metres, in plan) from an obstructed core's centroid to
 * a neighbouring core's stack that may gather it instead of leaving a flagged
 * stack at the centroid (`src/domain/coreCollectors.ts`).
 *
 *  - residential 8.0 m: **PLACEHOLDER** — twice the residential branch limit,
 *    i.e. a collector spanning two adjacent wet rooms under the slab. The
 *    הל"ת figure for an under-slab collector between two apartments' wet
 *    rooms has not been verified.
 *  - office 12.0 m: the office collector limit (`BRANCH_LENGTH_LIMIT_M.office`),
 *    already a placeholder there.
 *
 * The rule engages only where a continuity map with an obstruction grid says
 * the core is obstructed; storeys without a grid never reach it.
 */
export const RESIDENTIAL_COLLECTOR_MAX_M = 8.0
export const OFFICE_COLLECTOR_MAX_M = BRANCH_LENGTH_LIMIT_M.office

// ---------------------------------------------------------------------------
// Rules table
// ---------------------------------------------------------------------------

/** Rules for {@link selectOfficeCoreShafts} (`src/domain/continuityMap.ts`). */
export interface OfficeCoreShaftRules {
  shaftMinAreaM2: number
  shaftMaxAreaM2: number
  shaftMaxAspectRatio: number
  coreRadiusM: number
  denseWindowM: number
  denseStructureMinDensity: number
  largeVoidMinAreaM2: number
}

export interface RowCollectorRules {
  minFixtures: number
  collinearityToleranceM: number
  maxSpacingM: number
  collectorOffsetM: number
  wallSearchM: number
}

export interface TypologyPlacementRules {
  typology: BuildingTypology
  /**
   * 'any': the residential chain (shaft → free cell → wall-side edge →
   * flagged centroid). 'core-shafts-only': office — only core shafts selected
   * by `selectOfficeCoreShafts`; nothing else, flagged when none is in range.
   */
  stackCandidates: 'any' | 'core-shafts-only'
  /** Snap distance from the core footprint, metres. */
  maxSnapM: number
  branchLengthLimitM: number
  /** Toilet-row collectors (office only). null = fixtures route individually. */
  rowCollectors: RowCollectorRules | null
  /** Core-shaft selection rules (office only). */
  coreShafts: OfficeCoreShaftRules | null
  /**
   * Longest collector (Manhattan, metres) that may gather an OBSTRUCTED core
   * into a neighbouring core's valid stack instead of a flagged centroid stack.
   * null = never gather (keep the flagged fallback).
   */
  coreCollectorMaxM: number | null
}

export const OFFICE_CORE_SHAFT_RULES: OfficeCoreShaftRules = {
  shaftMinAreaM2: OFFICE_SHAFT_MIN_AREA_M2,
  shaftMaxAreaM2: OFFICE_SHAFT_MAX_AREA_M2,
  shaftMaxAspectRatio: OFFICE_SHAFT_MAX_ASPECT_RATIO,
  coreRadiusM: OFFICE_CORE_RADIUS_M,
  denseWindowM: OFFICE_DENSE_WINDOW_M,
  denseStructureMinDensity: OFFICE_DENSE_STRUCTURE_MIN_DENSITY,
  largeVoidMinAreaM2: OFFICE_LARGE_VOID_MIN_AREA_M2,
}

export const OFFICE_ROW_COLLECTOR_RULES: RowCollectorRules = {
  minFixtures: ROW_MIN_FIXTURES,
  collinearityToleranceM: ROW_COLLINEARITY_TOLERANCE_M,
  maxSpacingM: ROW_MAX_SPACING_M,
  collectorOffsetM: ROW_COLLECTOR_OFFSET_M,
  wallSearchM: ROW_WALL_SEARCH_M,
}

export const TYPOLOGY_PLACEMENT_RULES: Readonly<Record<BuildingTypology, TypologyPlacementRules>> = {
  residential: {
    typology: 'residential',
    stackCandidates: 'any',
    // Kept equal to `MAX_SNAP_M` in `src/shared/routes/suggestRisers.ts`.
    maxSnapM: 1.5,
    branchLengthLimitM: BRANCH_LENGTH_LIMIT_M.residential,
    rowCollectors: null,
    coreShafts: null,
    coreCollectorMaxM: RESIDENTIAL_COLLECTOR_MAX_M,
  },
  office: {
    typology: 'office',
    stackCandidates: 'core-shafts-only',
    maxSnapM: MAX_SNAP_OFFICE_M,
    branchLengthLimitM: BRANCH_LENGTH_LIMIT_M.office,
    rowCollectors: OFFICE_ROW_COLLECTOR_RULES,
    coreShafts: OFFICE_CORE_SHAFT_RULES,
    coreCollectorMaxM: OFFICE_COLLECTOR_MAX_M,
  },
}

export function resolveTypologyPlacementRules(typology: BuildingTypology | undefined): TypologyPlacementRules {
  return TYPOLOGY_PLACEMENT_RULES[typology ?? DEFAULT_BUILDING_TYPOLOGY]
}

/** Branch length limit in the caller's plan units. */
export function resolveBranchLengthLimit(units: 'mm' | 'm', typology: BuildingTypology | undefined): number {
  const resolved = typology ?? DEFAULT_BUILDING_TYPOLOGY
  return units === 'mm' ? BRANCH_LENGTH_LIMIT_MM[resolved] : BRANCH_LENGTH_LIMIT_M[resolved]
}

/** Decisions-panel / debug line: "Typology: office (manual)". */
export function describeBuildingTypology(typology: BuildingTypology): string {
  return `Typology: ${typology} (manual)`
}
