import type { IfcAPI } from 'web-ifc'
import { z } from 'zod'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { assignFixturesToRisers, type FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import type { FloorRoutes } from '@/domain/branchRouting'
import {
  buildContinuityMap,
  probeContinuityCell,
  type ContinuityCellProbe,
  type ContinuityMap,
  type ContinuityStoreyInput,
} from '@/domain/continuityMap'
import type { FloorDrawingModel } from '@/domain/drawing/floorDrawingModel'
import {
  computeEngineerComparison,
  type EngineerComparisonInput,
  type EngineerComparisonReport,
} from '@/domain/engineerComparisonMetrics'
import {
  classifyEngineerRiserStacks,
  selectEngineerBranchSegments,
  selectEngineerStoreyHorizontals,
  storeySlabBandM,
  type EngineerRiserClassification,
  type StoreySlabBandM,
} from '@/domain/engineerPipes'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea, PlanBounds, Storey, StoreyId } from '@/domain/types'
import type { WetCore } from '@/domain/wetCores'
import { alignEngineerStacksToViewerPlan } from '@/shared/frame/ifcSourceFrame'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import {
  convertContinuityElevationsToMeters,
  mergeContinuityStoreyInputs,
  remapContinuityStoreysToHost,
} from '@/shared/ifc/buildContinuityMapForModel'
import { detectMergedStoreyFixtures } from '@/shared/ifc/detectMergedStoreyFixtures'
import { extractContinuityStoreyInputs } from '@/shared/ifc/extractContinuityInputs'
import { extractEngineerPipeNetwork, type ExtractedEngineerPipeNetwork } from '@/shared/ifc/extractEngineerPipeNetwork'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { readBuildingPlacementSourcePoint } from '@/shared/ifc/readBuildingPlacement'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import { buildBranchRoutesFromAssignments } from '@/shared/routes/buildBranchRoutes'
import { buildWetCoreSuggestedRisers, type WetCoreSuggestedStack } from '@/shared/routes/buildSuggestedRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from '@/shared/routes/riserPlacementProfile'
import { buildEngineerFloorDrawing, type EngineerFloorDrawingDiagnostics } from './engineerFloorDrawing'
import { footprintToDrawingOutline } from './drawingFrame'
import { buildOurFloorDrawing, type OurFloorDrawingDiagnostics } from './ourSuggestionDrawing'

/**
 * One gauntlet floor end-to-end: the same steps the app runs for a loaded
 * host (sanitary/plumbing) file plus linked architecture/structure files —
 * storey alignment, merged fixture detection, ONE continuity map from every
 * file, wet-core stack suggestion (with the V4 extent when the whole building
 * is aggregated), wet-core fixture assignment and branch routing — followed by
 * the engineer network extraction and both drawing adapters. The setup mirrors
 * `wetCorePlacement.096.gated.test.ts` / `wetCorePlacement.shbj.gated.test.ts`
 * and the page's suggest handler; nothing here re-implements placement.
 *
 * Node-side only (web-ifc API handed in already opened; no file I/O here).
 */

const fileRefSchema = z.object({
  /** Path to the IFC file (absolute or relative to the repo root). */
  path: z.string().min(1),
  /** File code used in diagnostics and continuity ids (e.g. "096-P.ifc"); never a client name. */
  fileName: z.string().min(1),
})

export const gauntletFloorSpecSchema = z.object({
  /** Output folder name under `external/gauntlet/models/`, e.g. "096-01". */
  floor: z.string().regex(/^[A-Za-z0-9_-]+$/),
  /** Sanitary/plumbing model: source of the engineer network and the host storeys. */
  host: fileRefSchema,
  /** Linked architecture/structure files, upload order. */
  linked: z.array(fileRefSchema).default([]),
  /** Host storey selector: by name, or by elevation in the host file's own unit (±1). */
  storey: z
    .object({ name: z.string().optional(), elevationSource: z.number().optional() })
    .refine((value) => value.name !== undefined || value.elevationSource !== undefined, {
      message: 'storey needs a name or an elevationSource',
    }),
  /** Neutral sheet label, e.g. "Storey 01". No project/file names. */
  storeyLabel: z.string().min(1),
  /**
   * Building typology for the placement path (G3's `residential | office`
   * switch). Accepted and recorded; passed through once the suggestion path
   * exposes the option (see the TODO in `runGauntletFloorPipeline`).
   */
  typology: z.enum(['residential', 'office']).optional(),
  /** Aggregate whole-building fixtures for the V4 stack extent (the app does; default true). */
  wholeBuildingExtent: z.boolean().default(true),
})

export type GauntletFloorSpec = z.infer<typeof gauntletFloorSpecSchema>
export type GauntletFloorSpecInput = z.input<typeof gauntletFloorSpecSchema>

export function parseGauntletFloorSpec(value: unknown): GauntletFloorSpec {
  return gauntletFloorSpecSchema.parse(value)
}

export interface GauntletOpenedModels {
  host: number
  /** Same order as `spec.linked`. */
  linked: number[]
}

export interface GauntletContinuityProbe {
  stackId: string
  stackLabel: string
  anchor: WetCoreSuggestedStack['anchor']
  position: { x: number; y: number; z: number }
  placementRule: string | null
  flagged: boolean
  probe: ContinuityCellProbe
}

/** Everything `engineerComparisonMetrics` needs, plus the report and the scope facts, JSON-ready. */
export interface GauntletMetricsInput {
  spec: GauntletFloorSpec
  hostStorey: { id: StoreyId; name: string; elevationSource: number }
  storeyBandM: { bottomM: number; topM: number | null }
  /** `EngineerComparisonInput` with engineer stacks aligned to the viewer plan (as the page does). */
  comparisonInput: EngineerComparisonInput
  report: EngineerComparisonReport
  /** Engineer horizontals by storey rule (band vs. hang), for the harness. */
  engineerStoreyHorizontals: {
    hangDepthM: number
    inBand: number
    inHang: number
    both: number
    total: number
    literalBandSelection: { segments: number; byGeometry: number; byContainment: number }
  }
  cores: Array<Pick<WetCore, 'id' | 'memberExpressIds' | 'kindsFingerprint' | 'kindCounts' | 'bbox' | 'centroid'>>
  continuityProbes: GauntletContinuityProbe[]
  fixtures: { merged: number; byKind: Record<string, number>; duplicates: number }
  timingsMs: Record<string, number>
  diagnostics: string[]
}

export interface GauntletFloorResult {
  engineer: { model: FloorDrawingModel; diagnostics: EngineerFloorDrawingDiagnostics }
  ours: { model: FloorDrawingModel; diagnostics: OurFloorDrawingDiagnostics }
  metricsInput: GauntletMetricsInput
  /** Intermediate products for tests. */
  facts: {
    hostStorey: Storey
    hostStoreys: Storey[]
    network: ExtractedEngineerPipeNetwork
    classification: EngineerRiserClassification
    band: StoreySlabBandM
    mergedFixtures: Fixture[]
    mergedKitchens: KitchenArea[]
    continuityMap: ContinuityMap
    storeyInput: ContinuityStoreyInput | null
    stacks: WetCoreSuggestedStack[]
    cores: WetCore[]
    assignments: FixtureRiserAssignment[]
    routes: FloorRoutes[]
    planBounds: PlanBounds
  }
}

async function alignmentInput(api: IfcAPI, modelId: number, fileName: string, storeys: Storey[]): Promise<AlignmentModelInput> {
  return {
    fileName,
    lengthUnit: await resolveModelLengthUnit(api, modelId),
    storeys: storeys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
    buildingPlacement: await readBuildingPlacementSourcePoint(api, modelId),
  }
}

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

function selectHostStorey(storeys: Storey[], selector: GauntletFloorSpec['storey']): Storey {
  if (selector.name !== undefined) {
    const byName = storeys.find((storey) => storey.name === selector.name)
    if (byName !== undefined) return byName
  }
  if (selector.elevationSource !== undefined) {
    const byElevation = storeys.find((storey) => Math.abs(storey.elevation - selector.elevationSource!) < 1)
    if (byElevation !== undefined) return byElevation
  }
  throw new Error(`No host storey matches ${JSON.stringify(selector)}; storeys: ${storeys.map((s) => s.name).join(', ')}`)
}

function planBoundsFromBox(box: { min: { x: number; z: number }; max: { x: number; z: number } }): PlanBounds {
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }
}

function unionPlanBounds(a: PlanBounds, b: PlanBounds): PlanBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

export async function runGauntletFloorPipeline(
  api: IfcAPI,
  spec: GauntletFloorSpec,
  models: GauntletOpenedModels,
): Promise<GauntletFloorResult> {
  const diagnostics: string[] = []
  const timingsMs: Record<string, number> = {}
  const timed = async <T>(label: string, run: () => Promise<T> | T): Promise<T> => {
    const start = performance.now()
    const value = await run()
    timingsMs[label] = Math.round(performance.now() - start)
    return value
  }

  // --- storeys + alignment ---------------------------------------------------
  const hostStoreys = await parseStoreys(api, models.host, 'gauntlet-host')
  const hostStorey = selectHostStorey(hostStoreys, spec.storey)
  const hostInput = await alignmentInput(api, models.host, spec.host.fileName, hostStoreys)

  interface LinkedFile {
    fileName: string
    modelId: number
    storeys: Storey[]
    lengthUnit: Awaited<ReturnType<typeof resolveModelLengthUnit>>
    /** Linked storey aligned to the host storey; null when none aligns. */
    alignedStoreyId: StoreyId | null
    sourceToHost: Map<StoreyId, StoreyId>
  }
  const linkedFiles: LinkedFile[] = []
  for (const [index, ref] of spec.linked.entries()) {
    const modelId = models.linked[index]
    const storeys = await parseStoreys(api, modelId, `gauntlet-linked-${index}`)
    const input = await alignmentInput(api, modelId, ref.fileName, storeys)
    const alignment = alignStoreysByElevation(hostInput, input)
    if (alignment.status !== 'aligned') {
      diagnostics.push(`${ref.fileName}: storey alignment status "${alignment.status}"; the file is left out.`)
    }
    const sourceToHost = new Map(alignment.pairs.map((pair) => [pair.linked.storeyId, pair.host.storeyId]))
    const pair = alignment.pairs.find((entry) => entry.host.storeyId === hostStorey.id)
    if (pair === undefined) diagnostics.push(`${ref.fileName}: no storey aligns to the host storey "${hostStorey.name}".`)
    linkedFiles.push({
      fileName: ref.fileName,
      modelId,
      storeys,
      lengthUnit: input.lengthUnit,
      alignedStoreyId: pair?.linked.storeyId ?? null,
      sourceToHost,
    })
  }
  const linkedTargetsFor = (storeyId: StoreyId) =>
    linkedFiles.flatMap((file) => {
      const linkedStoreyId = [...file.sourceToHost.entries()].find(([, host]) => host === storeyId)?.[0]
      return linkedStoreyId === undefined ? [] : [{ webIfcModelId: file.modelId, storeyId: linkedStoreyId, fileName: file.fileName }]
    })

  // --- engineer network (host = plumbing model) -------------------------------
  const network = await timed('engineerNetwork', () =>
    extractEngineerPipeNetwork(api, models.host, { systemPrefixes: ['SW-GRV', 'VNT'] }),
  )
  const classification = classifyEngineerRiserStacks(network)
  const band = storeySlabBandM(network, hostStorey.id)
  if (band === null) throw new Error(`Host storey ${hostStorey.id} is missing from the engineer network storeys`)

  // --- merged fixtures on the host storey -------------------------------------
  const merged = await timed('mergedFixtures', () =>
    detectMergedStoreyFixtures(
      api,
      { webIfcModelId: models.host, storeyId: hostStorey.id, fileName: spec.host.fileName },
      linkedTargetsFor(hostStorey.id),
    ),
  )

  // --- ONE continuity map from every file, scoped to the storey ---------------
  // Same steps as `buildContinuityMapForModels`, kept apart so the merged
  // storey INPUT (wall/column/opening footprints) is available for the drawing
  // without a second tessellation pass.
  const perSource: Array<{ fileName: string; storeys: ContinuityStoreyInput[] }> = []
  await timed('continuityExtract', async () => {
    const sources = [
      { fileName: spec.host.fileName, modelId: models.host, lengthUnit: hostInput.lengthUnit, sourceToHost: null as Map<StoreyId, StoreyId> | null, storeyIds: new Set([hostStorey.id]) },
      ...linkedFiles
        .filter((file) => file.alignedStoreyId !== null)
        .map((file) => ({
          fileName: file.fileName,
          modelId: file.modelId,
          lengthUnit: file.lengthUnit,
          sourceToHost: file.sourceToHost as Map<StoreyId, StoreyId> | null,
          storeyIds: new Set([file.alignedStoreyId!]),
        })),
    ]
    for (const source of sources) {
      if (source.lengthUnit === null) {
        diagnostics.push(`${source.fileName} declares no supported length unit; left out of the continuity map.`)
        continue
      }
      const extraction = await extractContinuityStoreyInputs(api, source.modelId, { storeyIds: source.storeyIds })
      diagnostics.push(...extraction.diagnostics.map((line) => `${source.fileName}: ${line}`))
      let storeys = convertContinuityElevationsToMeters(extraction.storeys, source.lengthUnit)
      if (source.sourceToHost !== null) {
        const remap = remapContinuityStoreysToHost(storeys, source.sourceToHost)
        storeys = remap.storeys
        diagnostics.push(...remap.diagnostics.map((line) => `${source.fileName}: ${line}`))
      }
      perSource.push({ fileName: source.fileName, storeys })
    }
  })
  const mergedStoreyInputs = mergeContinuityStoreyInputs(perSource)
  const continuityMap = buildContinuityMap({ units: 'm', storeys: mergedStoreyInputs })
  const storeyInput = mergedStoreyInputs.find((entry) => entry.storeyId === hostStorey.id) ?? null
  const storeyShaftCandidates = continuityMap.shaftCandidates.filter((candidate) => candidate.storeyIds.includes(hostStorey.id))

  // --- whole-building fixtures for the V4 stack extent ------------------------
  let buildingFixtures: Fixture[] | null = null
  let buildingKitchens: KitchenArea[] | null = null
  if (spec.wholeBuildingExtent) {
    const aggregated = await timed('wholeBuildingAggregation', () =>
      aggregateStoreyDetections(api, models.host, hostStoreys, DEFAULT_RISER_PLACEMENT_RULE_PROFILE, undefined, {
        linkedTargetsFor,
        hostFileName: spec.host.fileName,
      }),
    )
    buildingFixtures = Object.values(aggregated.fixturesByStoreyId).flat()
    buildingKitchens = Object.values(aggregated.kitchensByStoreyId).flat()
  }

  // --- wet-core suggestion (the app's plain-mode path) ------------------------
  const floorMeshes = await timed('floorMeshes', () => extractFloorMeshes(api, models.host, hostStorey.id))
  // The page hands the suggestion the SOURCE-frame box (it mixes plan bounds with source-frame fixtures).
  const suggestionMeshes = { ...floorMeshes, boundingBox: floorMeshes.sourceBoundingBox }
  // TODO(G3): pass `spec.typology` through `wetCore.typology` /
  // `assignFixturesToRisers({ typology })` / `computeBranchRoutes({ rowCollectors })`
  // once G3's typology option lands on the suggestion path (not on this branch yet).
  if (spec.typology !== undefined) {
    diagnostics.push(`typology "${spec.typology}" recorded; the suggestion path exposes no typology option yet, so residential rules were applied.`)
  }
  const suggestion = buildWetCoreSuggestedRisers({
    storeys: hostStoreys,
    sourceStoreyId: hostStorey.id,
    fixtures: merged.fixtures,
    kitchens: merged.kitchens,
    floorMeshes: suggestionMeshes,
    nextLabel: labeler(),
    wetCore: { planUnits: 'm', continuityMap },
    stackExtent:
      buildingFixtures === null || buildingKitchens === null
        ? undefined
        : {
            buildingFixtures: toStackExtentFixtures(buildingFixtures, buildingKitchens),
            planUnits: 'm',
            continuityMap,
            collectorStoreyId: null,
          },
  })
  diagnostics.push(...suggestion.diagnostics)

  // --- assignment by wet core + branch routing --------------------------------
  const fixtureCoreIds = new Map<number, string>()
  for (const core of suggestion.cores) for (const expressId of core.memberExpressIds) fixtureCoreIds.set(expressId, core.id)
  const stackCoreIds = new Map<string, string>()
  for (const stack of suggestion.stacks) if (stack.anchor === 'wet-core') stackCoreIds.set(stack.stackId, stack.core.id)
  const storeyRisers = suggestion.risers.filter((riser) => riser.storeyId === hostStorey.id)
  const assignments = assignFixturesToRisers(
    merged.fixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
    storeyRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
    { units: 'm', coreMembership: { fixtureCoreIds, stackCoreIds } },
  )
  const routes = buildBranchRoutesFromAssignments(assignments)

  // --- comparison metrics (as the page computes them) -------------------------
  const literalBand = selectEngineerBranchSegments(network, band)
  const comparisonInput: EngineerComparisonInput = {
    ourRisers: suggestion.risers,
    ourRiserUnits: 'm',
    ourBranchRoutes: routes,
    ourAssignments: assignments,
    engineerRisers: {
      sanitaryStacks: alignEngineerStacksToViewerPlan(classification.sanitaryStacks),
      ventStacks: alignEngineerStacksToViewerPlan(classification.ventStacks),
      stubs: alignEngineerStacksToViewerPlan(classification.stubs),
      minStackExtentM: classification.minStackExtentM,
      minStackExtentSource: classification.minStackExtentSource,
    },
    storeyScope: { ourStoreyId: hostStorey.id, engineerBandM: band },
    engineerSegments: literalBand.segments,
  }
  const report = computeEngineerComparison(comparisonInput)
  const hangSelection = selectEngineerStoreyHorizontals(network, band)

  const continuityProbes: GauntletContinuityProbe[] = suggestion.stacks.map((stack) => ({
    stackId: stack.stackId,
    stackLabel: stack.stackLabel,
    anchor: stack.anchor,
    position: stack.position,
    placementRule: stack.anchor === 'wet-core' ? stack.placement.rule : null,
    flagged: stack.anchor === 'wet-core' ? stack.placement.flagged : false,
    probe: probeContinuityCell(continuityMap, hostStorey.id, stack.position),
  }))

  // --- drawings ----------------------------------------------------------------
  // Plan bounds: the host storey's robust floor bounds (identity frame → source
  // metres, what the 2D viewer FITs) widened by the slab footprints of the
  // linked files, which define the floor plate even though slabs are not drawn.
  let planBounds = planBoundsFromBox(floorMeshes.boundingBox)
  for (const obstruction of storeyInput?.obstructions ?? []) {
    if (obstruction.kind !== 'slab') continue
    const outline = footprintToDrawingOutline(obstruction.footprint)
    const xs = outline.map((p) => p.xM)
    const ys = outline.map((p) => -p.yM)
    planBounds = unionPlanBounds(planBounds, {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...ys),
      maxZ: Math.max(...ys),
    })
  }
  const structure = { storeyInput, shaftCandidates: storeyShaftCandidates }
  const engineer = buildEngineerFloorDrawing({
    network,
    classification,
    storeyId: hostStorey.id,
    storeyLabel: spec.storeyLabel,
    planBounds,
    structure,
    fixtures: merged.fixtures,
    fixtureStoreyId: hostStorey.id,
  })
  const ours = buildOurFloorDrawing({
    storeyId: hostStorey.id,
    storeyLabel: spec.storeyLabel,
    risers: suggestion.risers,
    routes,
    fixtures: merged.fixtures,
    structure,
    planBounds,
    storeys: hostStoreys,
  })

  const byKind: Record<string, number> = {}
  for (const fixture of merged.fixtures) byKind[fixture.kind] = (byKind[fixture.kind] ?? 0) + 1

  const metricsInput: GauntletMetricsInput = {
    spec,
    hostStorey: { id: hostStorey.id, name: hostStorey.name, elevationSource: hostStorey.elevation },
    storeyBandM: { bottomM: band.bottomM, topM: Number.isFinite(band.topM) ? band.topM : null },
    comparisonInput,
    report,
    engineerStoreyHorizontals: {
      hangDepthM: hangSelection.hangDepthM,
      inBand: hangSelection.inBandCount,
      inHang: hangSelection.inHangCount,
      both: hangSelection.bothCount,
      total: hangSelection.horizontals.length,
      literalBandSelection: {
        segments: literalBand.segments.length,
        byGeometry: literalBand.byGeometryCount,
        byContainment: literalBand.byContainmentCount,
      },
    },
    cores: suggestion.cores.map((core) => ({
      id: core.id,
      memberExpressIds: core.memberExpressIds,
      kindsFingerprint: core.kindsFingerprint,
      kindCounts: core.kindCounts,
      bbox: core.bbox,
      centroid: core.centroid,
    })),
    continuityProbes,
    fixtures: { merged: merged.fixtures.length, byKind, duplicates: merged.duplicates.length },
    timingsMs,
    diagnostics,
  }

  return {
    engineer,
    ours,
    metricsInput,
    facts: {
      hostStorey,
      hostStoreys,
      network,
      classification,
      band,
      mergedFixtures: merged.fixtures,
      mergedKitchens: merged.kitchens,
      continuityMap,
      storeyInput,
      stacks: suggestion.stacks,
      cores: suggestion.cores,
      assignments,
      routes,
      planBounds,
    },
  }
}
