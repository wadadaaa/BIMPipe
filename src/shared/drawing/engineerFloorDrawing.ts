import type {
  DrawingBoundsM,
  DrawingPipeRun,
  DrawingRiser,
  FloorDrawingModel,
} from '@/domain/drawing/floorDrawingModel'
import {
  classifyEngineerRunRoles,
  ENGINEER_FITTING_BRIDGE_TOLERANCE_M,
  ENGINEER_JUNCTION_TOLERANCE_M,
  ENGINEER_SANITARY_SYSTEM_PREFIXES,
  ENGINEER_VENT_SYSTEM_PREFIXES,
  engineerSegmentSlopePercent,
  selectEngineerServedStacks,
  selectEngineerStoreyHorizontals,
  stacksIntersectingBand,
  storeySlabBandM,
  type EngineerPipeNetwork,
  type EngineerPipeSegment,
  type EngineerRiserClassification,
  type EngineerRiserStack,
  type EngineerRunRole,
  type EngineerStoreyHorizontal,
  type EngineerStoreyHorizontalRule,
} from '@/domain/engineerPipes'
import type { Fixture, PlanBounds, StoreyId } from '@/domain/types'
import { buildDrawingFixtures } from './drawingFixtures'
import {
  boundsOfDrawingPoints,
  drawingPointInBounds,
  ifcSourceToDrawing,
  unionDrawingBounds,
  viewerBoundsToDrawing,
} from './drawingFrame'
import { buildDrawingStructure, structureBounds, type DrawingStructureInput } from './drawingStructure'
import { resolveRiserTag } from './riserTag'

/**
 * Engineer side of the A/B: one storey of the extracted plumbing network as a
 * `FloorDrawingModel`.
 *
 * - Risers: sanitary stacks whose Z-range intersects the storey band
 *   (`stackIntersectsBand`, V1's honest definition) plus vent stacks as
 *   `system: 'vent'`; diameter = largest member segment; tag from the sheet
 *   convention, or the engineer's own tag when it is a bare sheet number.
 * - Pipes: horizontal SW-GRV (and VNT) runs ON the storey — Z in the storey
 *   band or in the hang band under its slab (`ENGINEER_HANG_DEPTH_M`); each
 *   rule's count is reported. Runs are oriented upstream → downstream (start
 *   is the higher end) so `slopePercent` is the fall along the run.
 * - Structure / fixtures / bounds are passed through from the continuity
 *   inputs, the merged storey detections and the floor plan bounds.
 *
 * Everything the model does not carry (rule counts, slope coverage, outliers,
 * junction counts, skipped items) is returned in `diagnostics`.
 */
export interface EngineerFloorDrawingInput {
  network: Pick<EngineerPipeNetwork, 'segments' | 'storeys' | 'metersPerSourceUnit'>
  classification: Pick<EngineerRiserClassification, 'sanitaryStacks' | 'ventStacks'>
  /** Engineer-model storey (express id in the plumbing file). */
  storeyId: StoreyId
  /** Neutral label, e.g. "Storey 01". Never a file or project name. */
  storeyLabel: string
  /** Floor plan bounds in the viewer frame (metres), e.g. `FloorMeshes.boundingBox` with the identity frame. */
  planBounds?: PlanBounds | null
  structure?: DrawingStructureInput
  /** Merged storey detections (viewer frame, metres) keyed by the HOST storey id given in `fixtureStoreyId`. */
  fixtures?: readonly Fixture[]
  /** Host storey id the fixtures are tagged with (differs from `storeyId` when the plumbing file is linked). */
  fixtureStoreyId?: StoreyId
  /** Overrides `ENGINEER_HANG_DEPTH_M`; 0 = literal storey band only. */
  hangDepthM?: number
  /** Overrides the strict junction tolerance used for the collector role. */
  junctionToleranceM?: number
  /** Include VNT horizontals as `system: 'vent'` pipes (default true). */
  includeVentPipes?: boolean
  /** System-name prefixes; default the engineer network constants (must match the classification's). */
  sanitarySystemPrefixes?: readonly string[]
  ventSystemPrefixes?: readonly string[]
}

export interface EngineerFloorDrawingDiagnostics {
  storeyBandM: { bottomM: number; topM: number | null }
  hangDepthM: number
  risers: {
    /** Sanitary stacks drawn: intersecting the band AND joined by a horizontal of the storey. */
    sanitary: number
    /** Sanitary stacks intersecting the band with no joining horizontal (not drawn), with the join tolerance. */
    sanitaryPassThrough: number
    sanitaryJoinToleranceM: number
    vent: number
    tagsFromEngineer: number
  }
  pipes: {
    /** Drawn sanitary + vent runs. */
    drawn: number
    sanitary: { inBand: number; inHang: number; both: number; total: number; unresolved: number }
    vent: { inBand: number; inHang: number; both: number; total: number; unresolved: number }
    /** Runs whose original geometry rose from start to end and were flipped. */
    flipped: number
    diametersMm: Record<string, number>
  }
  slope: {
    /** Runs with a non-null slope (including measured 0 % flats). */
    withSlope: number
    /** Runs ≥ 100 mm long whose fall is below 1 mm: reported as 0 %. */
    flat: number
    /** Runs too short (< 100 mm) to resolve a slope at 1 mm, or shorter than 1 mm: null slope. */
    belowResolution: number
    /** Runs with |slope| > 10 %, listed with the raw value (drawn with null slope). */
    outliers: Array<{ pipeId: string; rawPercent: number }>
    /** withSlope / (runs derived from an extrusion axis), 0–1; null when there are none. */
    extrusionCoverage: number | null
    extrusionRuns: number
  }
  collectors: {
    toleranceM: number
    count: number
    junctions: number
    /** Same classification at the fitting-bridged tolerance, for comparison. */
    bridged: { toleranceM: number; count: number; junctions: number }
  }
  fixtures: { drawn: number; skippedWithoutPosition: number }
  structure: { elements: number }
  /** Pipe endpoints outside `boundsM` (should be 0; a frame bug otherwise). */
  pipeEndpointsOutsideBounds: number
  notes: string[]
}

export interface EngineerFloorDrawingResult {
  model: FloorDrawingModel
  diagnostics: EngineerFloorDrawingDiagnostics
}

function countRules(horizontals: readonly EngineerStoreyHorizontal[]): Record<EngineerStoreyHorizontalRule, number> {
  const counts: Record<EngineerStoreyHorizontalRule, number> = { 'in-band': 0, 'in-hang': 0, both: 0 }
  for (const entry of horizontals) counts[entry.rule] += 1
  return counts
}

export function buildEngineerFloorDrawing(input: EngineerFloorDrawingInput): EngineerFloorDrawingResult {
  const { network, classification, storeyId, storeyLabel } = input
  const scale = network.metersPerSourceUnit
  const notes: string[] = []

  const band = storeySlabBandM(network, storeyId)
  if (band === null) {
    throw new Error(`Storey ${storeyId} is not in the engineer network's storey list`)
  }
  const storeyNameById = new Map(network.storeys.map((storey) => [storey.id, storey.name]))

  // --- pipes (selected first: the served-stack rule needs the storey's horizontals) ---
  const hangDepthM = input.hangDepthM
  const sanitary = selectEngineerStoreyHorizontals(network, band, {
    hangDepthM,
    systemPrefixes: input.sanitarySystemPrefixes ?? ENGINEER_SANITARY_SYSTEM_PREFIXES,
  })
  const vent = selectEngineerStoreyHorizontals(network, band, {
    hangDepthM,
    systemPrefixes: input.ventSystemPrefixes ?? ENGINEER_VENT_SYSTEM_PREFIXES,
  })

  // --- risers -------------------------------------------------------------
  // Sanitary stacks: only those a horizontal of this storey joins (R1); a
  // stack merely passing through the band (roof drain, other storeys' stacks)
  // is not part of the storey's sanitary plan. Vent stacks are drawn as they
  // intersect the band (a vent legitimately has no horizontal here).
  const intersectingSanitary = stacksIntersectingBand(classification.sanitaryStacks, band)
  const servedSelection = selectEngineerServedStacks(intersectingSanitary, sanitary.horizontals, scale)
  const sanitaryStacks = servedSelection.served
  const ventStacks = stacksIntersectingBand(classification.ventStacks, band)
  const segmentById = new Map(network.segments.map((segment) => [segment.expressId, segment]))
  let tagsFromEngineer = 0
  const toRiser = (stack: EngineerRiserStack, index: number): DrawingRiser => {
    const engineerTexts = stack.segmentExpressIds.flatMap((expressId) => {
      const segment = segmentById.get(expressId)
      return segment === undefined ? [] : [segment.tag, segment.name]
    })
    const resolved = resolveRiserTag({ storeyLabel, stackIndex: index, engineerTexts })
    if (resolved.source === 'engineer-sheet-number') tagsFromEngineer += 1
    return {
      id: stack.id,
      system: stack.systemClass,
      centre: { xM: stack.xM, yM: stack.yM },
      diameterMm: stack.diameterMm,
      tag: resolved.tag,
      spansStoreyLabels: stack.spannedStoreyIds.map((id) => storeyNameById.get(id) ?? `Storey ${id}`),
    }
  }
  // Sanitary stacks first (classification order: xM, yM, zMinM), vents continue the index.
  const risers: DrawingRiser[] = [
    ...sanitaryStacks.map((stack, i) => toRiser(stack, i + 1)),
    ...ventStacks.map((stack, i) => toRiser(stack, sanitaryStacks.length + i + 1)),
  ]

  // --- pipes ------------------------------------------------------------
  const includeVent = input.includeVentPipes ?? true
  const drawnHorizontals: Array<{ entry: EngineerStoreyHorizontal; system: 'sanitary' | 'vent' }> = [
    ...sanitary.horizontals.map((entry) => ({ entry, system: 'sanitary' as const })),
    ...(includeVent ? vent.horizontals.map((entry) => ({ entry, system: 'vent' as const })) : []),
  ]
  const drawnSegments: EngineerPipeSegment[] = drawnHorizontals.map(({ entry }) => entry.segment)

  const junctionToleranceM = input.junctionToleranceM ?? ENGINEER_JUNCTION_TOLERANCE_M
  const roles = classifyEngineerRunRoles(drawnSegments, scale, junctionToleranceM)
  const bridged = classifyEngineerRunRoles(drawnSegments, scale, ENGINEER_FITTING_BRIDGE_TOLERANCE_M)

  let flipped = 0
  let withSlope = 0
  let flat = 0
  let belowResolution = 0
  let extrusionRuns = 0
  let extrusionWithSlope = 0
  const outliers: Array<{ pipeId: string; rawPercent: number }> = []
  const diametersMm: Record<string, number> = {}
  const pipes: DrawingPipeRun[] = drawnHorizontals.map(({ entry, system }) => {
    const segment = entry.segment
    const id = `engineer-pipe-${segment.expressId}`
    // Orient upstream → downstream: start is the higher end.
    let start = segment.start!
    let end = segment.end!
    if (end.z > start.z) {
      ;[start, end] = [end, start]
      flipped += 1
    }
    const slope = engineerSegmentSlopePercent({ start, end, invertElevationM: segment.invertElevationM }, scale)
    if (segment.endpointSource === 'extrusion-axis') extrusionRuns += 1
    if (slope.slopePercent !== null) {
      withSlope += 1
      if (slope.flat) flat += 1
      if (segment.endpointSource === 'extrusion-axis') extrusionWithSlope += 1
    } else if (slope.outlier) {
      outliers.push({ pipeId: id, rawPercent: slope.rawPercent })
    } else {
      belowResolution += 1
    }
    const diameterKey = segment.outerDiameterMm === null ? 'null' : String(Math.round(segment.outerDiameterMm))
    diametersMm[diameterKey] = (diametersMm[diameterKey] ?? 0) + 1
    const role: EngineerRunRole = roles.roles.get(segment.expressId) ?? 'branch'
    return {
      id,
      system,
      diameterMm: segment.outerDiameterMm,
      slopePercent: slope.slopePercent,
      start: ifcSourceToDrawing(start, scale),
      end: ifcSourceToDrawing(end, scale),
      role,
    }
  })

  // --- structure, fixtures, bounds ----------------------------------------
  const structure = buildDrawingStructure(input.structure)
  const fixtureResult = buildDrawingFixtures(input.fixtures ?? [], input.fixtureStoreyId ?? storeyId)

  let boundsM: DrawingBoundsM | null = input.planBounds ? viewerBoundsToDrawing(input.planBounds) : null
  const structureExtent = structureBounds(structure)
  if (structureExtent !== null) boundsM = unionDrawingBounds(boundsM, structureExtent)
  if (boundsM === null) {
    // No floor bounds and no structure: frame the content itself (honest fallback, noted).
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
  if (sanitary.unresolvedCount + vent.unresolvedCount > 0) {
    notes.push(
      `${sanitary.unresolvedCount + vent.unresolvedCount} matching segment(s) have no resolved centreline anywhere in the model and cannot be placed on a storey.`,
    )
  }

  const sanitaryRules = countRules(sanitary.horizontals)
  const ventRules = countRules(vent.horizontals)
  const model: FloorDrawingModel = {
    title: `${storeyLabel} — sanitary plan`,
    storeyLabel,
    boundsM,
    structure,
    fixtures: fixtureResult.fixtures,
    risers,
    pipes,
    sleeves: [],
  }
  const diagnostics: EngineerFloorDrawingDiagnostics = {
    storeyBandM: { bottomM: band.bottomM, topM: Number.isFinite(band.topM) ? band.topM : null },
    hangDepthM: sanitary.hangDepthM,
    risers: {
      sanitary: sanitaryStacks.length,
      sanitaryPassThrough: servedSelection.passThrough.length,
      sanitaryJoinToleranceM: servedSelection.joinToleranceM,
      vent: ventStacks.length,
      tagsFromEngineer,
    },
    pipes: {
      drawn: pipes.length,
      sanitary: {
        inBand: sanitary.inBandCount,
        inHang: sanitary.inHangCount,
        both: sanitaryRules.both,
        total: sanitary.horizontals.length,
        unresolved: sanitary.unresolvedCount,
      },
      vent: {
        inBand: vent.inBandCount,
        inHang: vent.inHangCount,
        both: ventRules.both,
        total: vent.horizontals.length,
        unresolved: vent.unresolvedCount,
      },
      flipped,
      diametersMm,
    },
    slope: {
      withSlope,
      flat,
      belowResolution,
      outliers,
      extrusionCoverage: extrusionRuns === 0 ? null : extrusionWithSlope / extrusionRuns,
      extrusionRuns,
    },
    collectors: {
      toleranceM: roles.toleranceM,
      count: roles.collectorCount,
      junctions: roles.junctions.length,
      bridged: { toleranceM: bridged.toleranceM, count: bridged.collectorCount, junctions: bridged.junctions.length },
    },
    fixtures: { drawn: fixtureResult.fixtures.length, skippedWithoutPosition: fixtureResult.skippedWithoutPosition.length },
    structure: { elements: structure.length },
    pipeEndpointsOutsideBounds,
    notes,
  }
  return { model, diagnostics }
}
