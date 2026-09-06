import {
  CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND,
  crossFileDedupeDistanceMm,
} from '@/domain/mergeFixturesAcrossFiles'
import type { FixtureKind } from '@/domain/types'
import type { WetCore } from '@/domain/wetCores'
import type { WetCoreSuggestedStack } from '@/shared/routes/buildSuggestedRisers'
import { formatLengthM } from '@/shared/lengthUnits'

/**
 * Pure UI copy for the sidebar panels (kept out of the component files so
 * fast refresh keeps working): fixture-kind labels, per-kind dedupe radii,
 * and one-line explanations of wet cores and stack placements (V3).
 */

export const FIXTURE_KIND_LABELS: Partial<Record<FixtureKind, string>> = {
  TOILETPAN: 'WC',
  WASHHANDBASIN: 'basin',
  SINK: 'sink',
  URINAL: 'urinal',
  BATH: 'bath',
  BIDET: 'bidet',
  CISTERN: 'cistern',
}

/** Per-kind dedupe radii from V2's table, e.g. "400 mm (WC), 300 mm (basin), 120 mm (other kinds)". */
export function describeDedupeRadii(defaultToleranceMm: number): string {
  const perKind = (Object.keys(CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND) as FixtureKind[])
    .map((kind) => `${crossFileDedupeDistanceMm(kind)} mm (${FIXTURE_KIND_LABELS[kind] ?? kind})`)
  return [...perKind, `${defaultToleranceMm} mm (other kinds)`].join(', ')
}

/** Short human label of a wet core: member counts per kind, e.g. "2 WC + 1 basin". */
export function describeWetCoreMembers(core: WetCore): string {
  return Object.entries(core.kindCounts)
    .map(([kind, count]) => `${count} ${FIXTURE_KIND_LABELS[kind as FixtureKind] ?? kind}`)
    .join(' + ')
}

/** One-line placement description of a wet-core stack (rule + snapped-to target). */
export function describeWetCoreStackPlacement(stack: WetCoreSuggestedStack): string {
  if (stack.anchor === 'kitchen') {
    if (stack.snap === null) return 'kitchen stack at the outer kitchen corner (no continuity map)'
    if (stack.snap.status === 'snapMiss') return `kitchen stack at the outer kitchen corner — ${stack.snap.reason}`
    const target = stack.snap.target === 'shaft' ? `shaft candidate ${stack.snap.shaftId}` : 'free grid cell'
    return `kitchen stack snapped to ${target} (${formatLengthM(stack.snap.distance, 'm')} from the corner)`
  }
  const { placement } = stack
  switch (placement.rule) {
    case 'shaft':
      return `snapped to shaft candidate ${placement.shaftId} (${formatLengthM(placement.distance, 'm')} from the core footprint)`
    case 'free-cell':
      return `snapped to free grid cell (${placement.cell.col}, ${placement.cell.row}), ${formatLengthM(placement.distance, 'm')} from the core footprint — no shaft candidate in range`
    case 'wall-side-edge':
      return `wall-side edge of the core (${placement.edge}, ${formatLengthM(placement.clearance, 'm')} clearance) — approximation, no structure loaded`
    case 'centroid':
      return placement.flagged ? `FLAGGED — ${placement.reason}` : `core centroid — ${placement.reason}`
  }
}

/** Compact placement tag for the riser list, e.g. "on shaft candidate", "wall-side edge", "needs review: obstructed". */
export function describePlacementRule(stack: WetCoreSuggestedStack): string {
  if (stack.anchor === 'kitchen') {
    if (stack.snap === null) return 'kitchen corner'
    return stack.snap.status === 'snapped'
      ? `snapped to ${stack.snap.target === 'shaft' ? 'shaft' : 'free cell'}`
      : 'kitchen corner (snap missed)'
  }
  switch (stack.placement.rule) {
    case 'shaft':
      return 'on shaft candidate'
    case 'free-cell':
      return 'on free cell'
    case 'wall-side-edge':
      return 'wall-side edge'
    case 'centroid':
      return stack.placement.flagged ? 'needs review: obstructed' : 'core centroid'
  }
}

/** Stacks whose placement needs the engineer's attention (obstructed fallbacks, unsnapped kitchens with a map). */
export function collectPlacementWarnings(stacks: WetCoreSuggestedStack[]): Array<{ stackLabel: string; message: string }> {
  const warnings: Array<{ stackLabel: string; message: string }> = []
  for (const stack of stacks) {
    if (stack.anchor === 'wet-core' && stack.placement.rule === 'centroid' && stack.placement.flagged) {
      warnings.push({ stackLabel: stack.stackLabel, message: stack.placement.reason })
    }
    if (stack.anchor === 'kitchen' && stack.snap?.status === 'snapMiss') {
      warnings.push({ stackLabel: stack.stackLabel, message: `kitchen stack not snapped — ${stack.snap.reason}` })
    }
  }
  return warnings
}
