import { BRANCH_SLOPE_PERCENT } from '@/domain/branchDefaults'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type {
  DrawingBoundsM,
  DrawingPipeRun,
  DrawingRiser,
  FloorDrawingModel,
} from '@/domain/drawing/floorDrawingModel'
import type { Fixture, PlanBounds, Riser, Storey, StoreyId } from '@/domain/types'
import { buildDrawingFixtures } from './drawingFixtures'
import {
  boundsOfDrawingPoints,
  drawingPointInBounds,
  unionDrawingBounds,
  viewerBoundsToDrawing,
  viewerPlanToDrawing,
} from './drawingFrame'
import { buildDrawingStructure, structureBounds, type DrawingStructureInput } from './drawingStructure'
import { formatRiserTag, parseFloorNumberFromStoreyLabel } from './riserTag'

/**
 * Our side of the A/B: the page's own data shapes (suggested `Riser`s, branch
 * `FloorRoutes`, merged fixtures, continuity structure) as a
 * `FloorDrawingModel` for the same storey.
 *
 * - Risers: the per-floor `Riser` entries on the storey, one per stack, tagged
 *   "<floor>.<n>ק" where n is the stack's label index ("R3" → 3) so the tag is
 *   stable across re-suggests; ordinal fallback when a label has no number.
 * - Pipes: the storey's route segments; `trunk` segments (serving ≥ 2
 *   fixtures — the Ø63 shared trunk, a Ø110 run serving two WCs) are
 *   collectors, `fixture-branch` segments are branches. Slope is the routing
 *   default (`BRANCH_SLOPE_PERCENT`, 2 %) along start → end (upstream → riser).
 * - Structure, fixtures and bounds mirror the engineer adapter so the two
 *   sheets are framed identically.
 */
export interface OurFloorDrawingInput {
  storeyId: StoreyId
  /** Neutral label, e.g. "Storey 01". */
  storeyLabel: string
  /** All suggested/manual risers (any storey); filtered to `storeyId` here. */
  risers: readonly Riser[]
  /** Branch routes per floor (viewer plan frame, own `planUnits`). */
  routes: readonly FloorRoutes[]
  fixtures?: readonly Fixture[]
  structure?: DrawingStructureInput
  planBounds?: PlanBounds | null
  /** Storeys, for `spansStoreyLabels` (names of the storeys a stack has entries on). */
  storeys?: readonly Storey[]
  /** Stack diameter written to the sheet; defaults to the exporter's Ø110 stack. */
  stackDiameterMm?: number
}

/** Same value the full exporter uses for a stack (`DEFAULT_RISER_DIAMETER_MM`); kept local to avoid importing web-ifc code. */
export const OUR_STACK_DIAMETER_MM = 110

export interface OurFloorDrawingDiagnostics {
  risers: { onStorey: number; tagsFromLabelIndex: number; tagsOrdinal: number }
  pipes: { drawn: number; collectors: number; branches: number; diametersMm: Record<string, number>; zeroLengthSkipped: number }
  fixtures: { drawn: number; skippedWithoutPosition: number }
  structure: { elements: number }
  pipeEndpointsOutsideBounds: number
  notes: string[]
}

export interface OurFloorDrawingResult {
  model: FloorDrawingModel
  diagnostics: OurFloorDrawingDiagnostics
}

/** Drawing id of one of our route segments (the restricted variant maps it back to the served fixtures). */
export function ourPipeDrawingId(segmentId: string): string {
  return `our-pipe-${segmentId}`
}

/** "R3" → 3; null when the label carries no digits. */
export function stackLabelIndex(stackLabel: string): number | null {
  return parseFloorNumberFromStoreyLabel(stackLabel)
}

function toMetres(value: number, units: FloorRoutes['planUnits']): number {
  return units === 'mm' ? value / 1000 : value
}

export function buildOurFloorDrawing(input: OurFloorDrawingInput): OurFloorDrawingResult {
  const { storeyId, storeyLabel } = input
  const notes: string[] = []
  const floorNumber = parseFloorNumberFromStoreyLabel(storeyLabel)
  const storeyNameById = new Map((input.storeys ?? []).map((storey) => [storey.id, storey.name]))

  // --- risers: one per stack on the storey, ordered by label index then id ---
  const onStorey = input.risers.filter((riser) => riser.storeyId === storeyId)
  const byStack = new Map<string, Riser>()
  for (const riser of [...onStorey].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!byStack.has(riser.stackId)) byStack.set(riser.stackId, riser)
  }
  const stacks = [...byStack.values()].sort((a, b) => {
    const ia = stackLabelIndex(a.stackLabel)
    const ib = stackLabelIndex(b.stackLabel)
    if (ia !== null && ib !== null && ia !== ib) return ia - ib
    if (ia === null && ib !== null) return 1
    if (ia !== null && ib === null) return -1
    return a.stackId.localeCompare(b.stackId)
  })
  // Label-index tags are claimed first so an ordinal fallback can never collide with them.
  const usedIndices = new Set<number>()
  for (const riser of stacks) {
    const labelIndex = stackLabelIndex(riser.stackLabel)
    if (labelIndex !== null && labelIndex >= 1) usedIndices.add(labelIndex)
  }
  let nextOrdinal = 1
  let tagsFromLabelIndex = 0
  let tagsOrdinal = 0
  const risers: DrawingRiser[] = stacks.map((riser) => {
    const labelIndex = stackLabelIndex(riser.stackLabel)
    let index: number
    if (labelIndex !== null && labelIndex >= 1 && usedIndices.has(labelIndex)) {
      index = labelIndex
      usedIndices.delete(labelIndex) // a duplicate label falls through to an ordinal
      tagsFromLabelIndex += 1
    } else {
      while (usedIndices.has(nextOrdinal)) nextOrdinal += 1
      index = nextOrdinal
      nextOrdinal += 1
      tagsOrdinal += 1
    }
    const tag = formatRiserTag(floorNumber, index)
    const storeyOrder = new Map((input.storeys ?? []).map((storey, index) => [storey.id, index]))
    const spanIds = [...new Set(input.risers.filter((entry) => entry.stackId === riser.stackId).map((entry) => entry.storeyId))].sort(
      (a, b) => (storeyOrder.get(a) ?? a) - (storeyOrder.get(b) ?? b),
    )
    return {
      id: riser.stackId,
      system: 'sanitary',
      centre: viewerPlanToDrawing(riser.position),
      diameterMm: input.stackDiameterMm ?? OUR_STACK_DIAMETER_MM,
      tag,
      spansStoreyLabels: spanIds
        .map((id) => storeyNameById.get(id))
        .filter((name): name is string => name !== undefined),
    }
  })

  // --- pipes: the storey's branch runs ---
  const pipes: DrawingPipeRun[] = []
  let collectors = 0
  let branches = 0
  let zeroLengthSkipped = 0
  const diametersMm: Record<string, number> = {}
  const slopePercent = BRANCH_SLOPE_PERCENT
  for (const floor of input.routes) {
    if (floor.storeyId !== storeyId) continue
    const segments: RouteSegment[] = [...floor.segments].sort((a, b) => a.id.localeCompare(b.id))
    for (const segment of segments) {
      const start = viewerPlanToDrawing({ x: toMetres(segment.start.x, floor.planUnits), z: toMetres(segment.start.z, floor.planUnits) })
      const end = viewerPlanToDrawing({ x: toMetres(segment.end.x, floor.planUnits), z: toMetres(segment.end.z, floor.planUnits) })
      if (start.xM === end.xM && start.yM === end.yM) {
        zeroLengthSkipped += 1
        continue
      }
      const role = segment.kind === 'trunk' ? 'collector' : 'branch'
      if (role === 'collector') collectors += 1
      else branches += 1
      diametersMm[String(segment.diameterMm)] = (diametersMm[String(segment.diameterMm)] ?? 0) + 1
      pipes.push({
        id: ourPipeDrawingId(segment.id),
        system: 'sanitary',
        diameterMm: segment.diameterMm,
        slopePercent,
        start,
        end,
        role,
      })
    }
  }
  if (zeroLengthSkipped > 0) notes.push(`${zeroLengthSkipped} zero-length route segment(s) were not drawn.`)

  // --- structure, fixtures, bounds ---
  const structure = buildDrawingStructure(input.structure)
  const fixtureResult = buildDrawingFixtures(input.fixtures ?? [], storeyId)

  let boundsM: DrawingBoundsM | null = input.planBounds ? viewerBoundsToDrawing(input.planBounds) : null
  const structureExtent = structureBounds(structure)
  if (structureExtent !== null) boundsM = unionDrawingBounds(boundsM, structureExtent)
  if (boundsM === null) {
    notes.push('No plan bounds or structure were given; bounds were derived from the drawn content.')
    boundsM = boundsOfDrawingPoints([
      ...pipes.flatMap((pipe) => [pipe.start, pipe.end]),
      ...risers.map((riser) => riser.centre),
      ...fixtureResult.fixtures.map((fixture) => fixture.centre),
    ]) ?? { minXM: 0, minYM: 0, maxXM: 0, maxYM: 0 }
  }
  let pipeEndpointsOutsideBounds = 0
  for (const pipe of pipes) {
    if (!drawingPointInBounds(pipe.start, boundsM)) pipeEndpointsOutsideBounds += 1
    if (!drawingPointInBounds(pipe.end, boundsM)) pipeEndpointsOutsideBounds += 1
  }
  if (pipeEndpointsOutsideBounds > 0) {
    notes.push(`${pipeEndpointsOutsideBounds} pipe endpoint(s) lie outside the floor bounds (frame mismatch?).`)
  }

  return {
    model: {
      title: `${storeyLabel} — sanitary plan`,
      storeyLabel,
      boundsM,
      structure,
      fixtures: fixtureResult.fixtures,
      risers,
      pipes,
      sleeves: [],
    },
    diagnostics: {
      risers: { onStorey: stacks.length, tagsFromLabelIndex, tagsOrdinal },
      pipes: { drawn: pipes.length, collectors, branches, diametersMm, zeroLengthSkipped },
      fixtures: { drawn: fixtureResult.fixtures.length, skippedWithoutPosition: fixtureResult.skippedWithoutPosition.length },
      structure: { elements: structure.length },
      pipeEndpointsOutsideBounds,
      notes,
    },
  }
}
