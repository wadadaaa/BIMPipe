import type { ContinuityMap, ShaftCandidate } from './continuityMap'
import { isTechnicalStoreyName } from './chooseInitialStorey'
import type { Fixture, KitchenArea, StoreyId } from './types'

/**
 * Vertical extent of a suggested riser stack (V4).
 *
 * A riser stack is a physical vertical shaft at one plan position (XY). Given
 * the storey it was suggested from ("anchor"), this module decides which
 * storeys the stack spans. Pure and deterministic: same input → same output,
 * regardless of input ordering.
 *
 * Rules (V0):
 *
 *  DOWN — the stack always runs down to the COLLECTOR level: by default the
 *    lowest storey of the building whose name is not roof/technical
 *    ({@link isTechnicalStoreyName}); basements count. Every storey between
 *    the collector and the anchor is a pass-through level the shaft physically
 *    crosses, so it is included regardless of its name. The collector can be
 *    overridden with `collectorStoreyId` (UI / V3 hook).
 *
 *  UP — the stack only continues into a storey whose CORE FINGERPRINT at the
 *    stack XY equals the anchor's: the sorted set of fixture kinds found
 *    within {@link SAME_CORE_RADIUS_M} of the stack position on that storey
 *    (kitchens are fed in as kind `KITCHEN`, see {@link toStackExtentFixtures}).
 *    The walk stops at the first storey (going up) without a matching core,
 *    and never enters a roof/technical storey.
 *
 *  OBSTRUCTIONS — when a continuity map (W5) in the same plan units is
 *    supplied, a storey whose obstruction-grid cell at the stack XY is
 *    blocked is a hard stop in both directions, unless a shaft candidate on
 *    that storey contains the point. Without a map (or with mismatched units)
 *    this bound is skipped and the skip is recorded in `reasons`.
 *
 * Every stop produces one human-readable reason line; storey names are passed
 * through untranslated (Hebrew names render as-is).
 *
 * Plan coordinates are (x, z) in the same frame and units as the fixture
 * positions used for suggestion; elevations are only used for ordering, so
 * their unit is irrelevant here.
 */

/**
 * Plan radius around the stack XY within which fixtures define the storey's
 * core fingerprint. Matches the wet-core clustering distance used by the W5/V3
 * continuity work (2.6 m). mm/m constant pair per repo unit rules.
 */
export const SAME_CORE_RADIUS_MM = 2600
export const SAME_CORE_RADIUS_M = 2.6

/** Fixture kind used for kitchen areas in stack-extent inputs. */
export const KITCHEN_CORE_KIND = 'KITCHEN'

export type StackExtentPlanUnits = 'mm' | 'm'

export interface StackExtentStorey {
  id: StoreyId
  /** Raw storey name (any language); used for the roof/technical predicate and reasons. */
  name: string
  /** Used for ordering only. */
  elevation: number
}

export interface StackExtentFixture {
  storeyId: StoreyId
  /** `FixtureKind` or {@link KITCHEN_CORE_KIND}. */
  kind: string
  x: number
  z: number
}

export interface RiserStackExtentInput {
  /** Every storey of the building (any order). */
  storeys: StackExtentStorey[]
  /** Every positioned fixture/kitchen of the building, all storeys (any order). */
  fixtures: StackExtentFixture[]
  /** Storey the stack was suggested from; always part of the extent. */
  anchorStoreyId: StoreyId
  /** Plan position of the stack, same frame/units as `fixtures`. */
  stackXY: { x: number; z: number }
  /** Unit of every plan coordinate in `fixtures` / `stackXY`. Never assumed. */
  planUnits: StackExtentPlanUnits
  /** Optional W5 continuity map; obstruction bound is skipped when absent. */
  continuityMap?: ContinuityMap | null
  /** Overrides the default collector rule (lowest non-technical storey). */
  collectorStoreyId?: StoreyId | null
  /** Core radius in `planUnits`; defaults to the 2.6 m constant pair. */
  sameCoreRadius?: number
}

export interface RiserStackExtent {
  /** Storeys the stack spans, bottom → top (by elevation, then id). Never empty. */
  storeyIds: StoreyId[]
  /**
   * Bottom storey of the stack. Equals the chosen collector unless an
   * obstruction stopped the downward walk earlier (explained in `reasons`).
   */
  collectorStoreyId: StoreyId
  topStoreyId: StoreyId
  /** Sorted `KIND+KIND…` set within the core radius on the anchor storey; empty if none. */
  anchorCoreFingerprint: string
  /** One line per decision/stop, in evaluation order. */
  reasons: string[]
}

/**
 * Adapts detected fixtures and kitchen areas (all storeys) to the plain
 * stack-extent input. Fixtures without a position are dropped — they cannot
 * contribute to a plan-position core. Kitchens contribute kind `KITCHEN` at
 * their anchor position.
 */
export function toStackExtentFixtures(fixtures: Fixture[], kitchens: KitchenArea[]): StackExtentFixture[] {
  const result: StackExtentFixture[] = []
  for (const fixture of fixtures) {
    if (fixture.position === null) continue
    result.push({ storeyId: fixture.storeyId, kind: fixture.kind, x: fixture.position.x, z: fixture.position.z })
  }
  for (const kitchen of kitchens) {
    if (kitchen.position === null) continue
    result.push({ storeyId: kitchen.storeyId, kind: KITCHEN_CORE_KIND, x: kitchen.position.x, z: kitchen.position.z })
  }
  return result
}

/**
 * Sorted set of fixture kinds within `radius` of `xy` on `storeyId`, joined
 * with `+` (e.g. `TOILETPAN+WASHHANDBASIN`). Empty string when none.
 */
export function buildCoreFingerprint(
  fixtures: StackExtentFixture[],
  storeyId: StoreyId,
  xy: { x: number; z: number },
  radius: number,
): string {
  const kinds = new Set<string>()
  for (const fixture of fixtures) {
    if (fixture.storeyId !== storeyId) continue
    const dx = fixture.x - xy.x
    const dz = fixture.z - xy.z
    if (Math.sqrt(dx * dx + dz * dz) <= radius) kinds.add(fixture.kind)
  }
  return Array.from(kinds).sort().join('+')
}

export function computeRiserStackExtent(input: RiserStackExtentInput): RiserStackExtent {
  const storeys = [...input.storeys].sort(compareStoreys)
  const anchorIndex = storeys.findIndex((storey) => storey.id === input.anchorStoreyId)
  if (anchorIndex === -1) {
    throw new Error(`computeRiserStackExtent: anchor storey ${input.anchorStoreyId} is not in the storey list`)
  }
  const anchor = storeys[anchorIndex]
  const radius =
    input.sameCoreRadius ?? (input.planUnits === 'mm' ? SAME_CORE_RADIUS_MM : SAME_CORE_RADIUS_M)
  const reasons: string[] = []

  const anchorCore = buildCoreFingerprint(input.fixtures, anchor.id, input.stackXY, radius)
  reasons.push(
    `anchor core on ${anchor.name}: ${describeCore(anchorCore)} ` +
      `(fixture kinds within ${formatLength(radius, input.planUnits)} of the stack position)`,
  )

  const obstructions = createObstructionProbe(input.continuityMap, input.planUnits, reasons)

  // --- collector -----------------------------------------------------------
  const collector = resolveCollector(storeys, input.collectorStoreyId ?? null, reasons)
  const collectorIndex = storeys.indexOf(collector)

  // --- down walk: anchor → collector ----------------------------------------
  const below: StackExtentStorey[] = []
  if (collectorIndex > anchorIndex) {
    reasons.push(
      `collector ${collector.name} is above the anchor ${anchor.name}; the stack bottoms out at the anchor`,
    )
  } else {
    for (let index = anchorIndex - 1; index >= 0; index--) {
      const storey = storeys[index]
      const obstruction = obstructions(storey, input.stackXY)
      if (obstruction !== null) {
        reasons.push(`stopped below ${storeys[index + 1].name}: obstruction on ${storey.name} (${obstruction})`)
        break
      }
      below.push(storey)
      if (storey.id === collector.id) break
    }
  }

  // --- up walk: anchor → first non-matching storey --------------------------
  const above: StackExtentStorey[] = []
  for (let index = anchorIndex + 1; index < storeys.length; index++) {
    const storey = storeys[index]
    if (isTechnicalStoreyName(storey.name)) {
      reasons.push(`roof excluded: ${storey.name} is a roof/technical storey`)
      break
    }
    const obstruction = obstructions(storey, input.stackXY)
    if (obstruction !== null) {
      reasons.push(`stopped at ${storeys[index - 1].name}: obstruction on ${storey.name} (${obstruction})`)
      break
    }
    const core = buildCoreFingerprint(input.fixtures, storey.id, input.stackXY, radius)
    if (core === '' || core !== anchorCore) {
      reasons.push(
        `no matching core on ${storey.name}: found ${describeCore(core)}, anchor core is ${describeCore(anchorCore)}`,
      )
      break
    }
    above.push(storey)
  }

  const technicalAbove = storeys
    .slice(anchorIndex + 1)
    .filter((storey) => isTechnicalStoreyName(storey.name))
  if (technicalAbove.length > 0 && !reasons.some((reason) => reason.startsWith('roof excluded:'))) {
    reasons.push(
      `roof excluded: ${technicalAbove.map((storey) => storey.name).join(', ')} ` +
        `(roof/technical storeys never receive auto risers)`,
    )
  }

  const spanned = [...below.reverse(), anchor, ...above]
  return {
    storeyIds: spanned.map((storey) => storey.id),
    collectorStoreyId: spanned[0].id,
    topStoreyId: spanned[spanned.length - 1].id,
    anchorCoreFingerprint: anchorCore,
    reasons,
  }
}

function resolveCollector(
  sortedStoreys: StackExtentStorey[],
  override: StoreyId | null,
  reasons: string[],
): StackExtentStorey {
  if (override !== null) {
    const overridden = sortedStoreys.find((storey) => storey.id === override)
    if (overridden !== undefined) {
      reasons.push(`collector: ${overridden.name} (explicit override)`)
      return overridden
    }
    reasons.push(`collector override ${override} is not a known storey; falling back to the default rule`)
  }
  const regular = sortedStoreys.find((storey) => !isTechnicalStoreyName(storey.name))
  if (regular !== undefined) {
    reasons.push(`collector: ${regular.name} (lowest storey excluding roof/technical names)`)
    return regular
  }
  const lowest = sortedStoreys[0]
  reasons.push(`collector: ${lowest.name} (every storey is roof/technical; lowest storey overall)`)
  return lowest
}

type ObstructionProbe = (storey: StackExtentStorey, xy: { x: number; z: number }) => string | null

/**
 * Returns a probe that yields a non-null description when the stack XY is a
 * blocked cell on the storey and no shaft candidate there contains the point.
 * Cells outside the storey grid, missing/empty grids, and maps in other units
 * never block (unknown ≠ obstructed).
 */
function createObstructionProbe(
  map: ContinuityMap | null | undefined,
  planUnits: StackExtentPlanUnits,
  reasons: string[],
): ObstructionProbe {
  if (map === null || map === undefined) {
    reasons.push('continuity bound skipped: no continuity map loaded')
    return () => null
  }
  if (map.units !== planUnits) {
    reasons.push(
      `continuity bound skipped: continuity map units (${map.units}) differ from plan units (${planUnits})`,
    )
    return () => null
  }
  return (storey, xy) => {
    const grid = map.grids.find((candidate) => candidate.storeyId === storey.id)
    if (grid === undefined || grid.columns === 0 || grid.rows === 0) return null
    const col = Math.floor((xy.x - grid.origin.x) / grid.cellSize)
    const row = Math.floor((xy.z - grid.origin.z) / grid.cellSize)
    if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return null
    if (grid.blocked[row * grid.columns + col] !== 1) return null
    const shaft = map.shaftCandidates.find(
      (candidate) => candidate.storeyIds.includes(storey.id) && containsPoint(candidate, xy),
    )
    if (shaft !== undefined) return null
    return `grid cell (${col}, ${row}) is blocked and no shaft candidate contains the stack position`
  }
}

function containsPoint(candidate: ShaftCandidate, xy: { x: number; z: number }): boolean {
  const { bounds } = candidate
  return xy.x >= bounds.minX && xy.x <= bounds.maxX && xy.z >= bounds.minZ && xy.z <= bounds.maxZ
}

function compareStoreys(left: StackExtentStorey, right: StackExtentStorey): number {
  if (left.elevation !== right.elevation) return left.elevation - right.elevation
  return left.id - right.id
}

function describeCore(core: string): string {
  return core === '' ? 'none' : core
}

function formatLength(value: number, units: StackExtentPlanUnits): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ${units}`
}
