import type { Fixture, KitchenArea, Riser, RiserId, Storey, StoreyId, SidebarTab } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { ModelOriginDecision } from '@/shared/frame/modelFrame'
import type { LengthUnit } from '@/shared/lengthUnits'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { EngineerPipeNetwork, EngineerRiserClassification } from '@/domain/engineerPipes'
import type { ContinuityMap } from '@/domain/continuityMap'
import type { WetCore } from '@/domain/wetCores'
import type {
  SuggestedRiserSnapOutcome,
  SuggestedRiserStackExtent,
  WetCoreSuggestedStack,
} from '@/shared/routes/buildSuggestedRisers'
import { appendAdjustment, createAdjustLog, type AdjustLog } from '@/domain/adjustLog'
import { getDemoRuntimeConfig, type DemoRuntimeConfig } from '@/shared/demoConfig'
import { removeRiserStack } from '@/shared/routes/buildRiserStacks'
import { resolveRoutingModel, type RoutingModel } from '@/shared/routes/routingModel'

/** A non-host model opened alongside the host in a multi-file upload (W4). */
export interface LinkedModelState {
  fileName: string
  webIfcModelId: number
  lengthUnit: LengthUnit | null
  storeyCount: number
  /** True when the file contains wall elements — the underlay source signal. */
  hasWalls: boolean
}

/** Architecture walls/columns of the aligned storey, rendered beneath the plan. */
export interface StoreyUnderlayState {
  meshes: FloorMeshes
  sourceFileName: string
}

/**
 * Engineer plumbing baseline extracted on demand (W7): the prefix-filtered
 * pipe network of one loaded model plus its classified vertical runs
 * (sanitary stacks / vent stacks / stubs, V1). Endpoints stay in IFC SOURCE
 * coordinates; the viewer boundary converts them through
 * `src/shared/frame/ifcSourceFrame.ts`.
 */
export interface EngineerBaselineState {
  sourceFileName: string
  systemPrefixes: readonly string[]
  network: EngineerPipeNetwork
  riserClassification: EngineerRiserClassification
}

/**
 * Continuity map built on demand (W5): obstruction grids + shaft candidates in
 * metres, keyed by HOST storey IDs (linked-model storeys are remapped through
 * the W4 alignment before they land here). Timings feed the Decisions tab.
 */
export interface ContinuityMapState {
  /**
   * Files the walls/voids/spaces were extracted from, '+'-joined when several
   * loaded files contributed (V3 multi-model build).
   */
  sourceFileName: string
  map: ContinuityMap
  /** Adapter/remap diagnostics + map.diagnostics, already combined. */
  diagnostics: string[]
  extractMs: number
  buildMs: number
  processedStoreyCount: number
}

/**
 * Outcome of the last wet-core suggest run (V3), for the Risers/Decisions
 * panels and the debug JSON. Null in demo mode (toilet-anchored path) and
 * before the first suggest.
 */
export interface WetCoreSuggestionState {
  sourceStoreyId: StoreyId
  /** Stacks that landed in state (override-superseded stacks are NOT here). */
  stacks: WetCoreSuggestedStack[]
  /** Every wet core of the source storey, including ones whose stack was superseded. */
  cores: WetCore[]
  /** Core ids whose new auto stack was dropped because a moved stack of the same core exists. */
  supersededCoreIds: string[]
  /** Stack ids kept from the previous state (manual / moved) during the merge. */
  preservedStackIds: string[]
  diagnostics: string[]
}

/** Progress of the async suggest flow (whole-building detection scan). */
export interface SuggestProgress {
  processed: number
  total: number
  /** Raw storey name being scanned (render with dir="auto"). */
  storeyName: string | null
}

// All WorkspacePage state in one place. Pure module: no React imports, no side
// effects in the reducer. Async orchestration (IFC parsing, geometry extraction,
// detection, export) stays in the page; the reducer only owns the transitions.
export interface WorkspacePageState {
  // --- file / model ---
  webIfcModelId: number | null
  modelFileName: string | null

  // --- storey loading ---
  storeys: Storey[]
  // Declared IFC length unit for RAW attribute values (storey elevations), read
  // from IfcUnitAssignment once per model right after parseStoreys. null = the
  // model does not declare a supported unit — display raw values, never guess.
  modelLengthUnit: LengthUnit | null
  isParsingStoreys: boolean
  uploadError: string | null
  demoUploadError: string | null
  demoAssetError: string | null
  // Resolved once at mount and never changed by any action.
  demoRuntime: DemoRuntimeConfig
  demoRuntimeConfigError: string | null
  // The single horizontal-routing switch (V5), derived from demoRuntime once at
  // mount: 'branch-runs' in plain mode, 'demo-chains' for the demo runtime.
  routingModel: RoutingModel

  // --- linked models (multi-IFC ingest) ---
  // Non-host files of a multi-file upload, in upload order. Empty for a
  // single-file upload, which keeps that flow byte-identical to before.
  linkedModels: LinkedModelState[]
  // One alignment per linked file (host storey ↔ linked storey by absolute
  // elevation), including explicitly blocked ones so failures stay visible.
  storeyAlignments: StoreyAlignment[]

  // --- floor extraction ---
  selectedStoreyId: StoreyId | null
  floorMeshes: FloorMeshes | null
  isExtractingGeometry: boolean
  geometryError: string | null
  // Architecture underlay for the open storey; null when no linked file maps
  // to it or the extraction failed (then underlayError carries the reason).
  underlay: StoreyUnderlayState | null
  underlayError: string | null
  // Cross-file fixture merge accounting for the open storey (Decisions tab +
  // debug JSON); null on single-file uploads and before detection completes.
  crossFileMerge: MergedStoreyDetection | null

  // --- initial floor auto-select (plain mode) ---
  // Why the chooser auto-opened a floor after upload, surfaced in the
  // Decisions tab and the exported debug JSON. null in demo mode (demo keeps
  // its legacy floor-selection semantics) and before any model is loaded.
  initialStoreyDecision: InitialStoreyDecision | null

  // --- model frame ---
  // Origin for local-frame rendering (viewer metres, Y-up), resolved once per
  // model from the first storey with usable geometry. null = not resolved yet.
  // Domain state (fixtures, risers, routes) always stays in SOURCE coordinates;
  // only the props handed to the viewers are converted through this origin.
  modelOrigin: ModelOriginDecision | null

  // --- viewer interaction ---
  hoveredExpressId: number | null
  selectedExpressId: number | null

  // --- fixtures ---
  fixtures: Fixture[]
  kitchens: KitchenArea[]
  isDetectingFixtures: boolean

  // --- risers ---
  // Single array spanning all floors. Manual placements are distinguished from
  // auto suggestions by `Riser.source` ('manual' vs 'placed'/'detected'); the
  // reducer never rewrites `source`, so that separation survives every action.
  risers: Riser[]
  isAddingRiser: boolean
  // Log of manual riser adjustments (add / drag-commit move / remove), offered
  // as a JSON download alongside the exported IFC. Coordinate frame: SOURCE
  // plan coordinates (the same frame riser positions are stored and exported
  // in — viewer metres BEFORE the W1 local-origin subtraction), mapped to the
  // adjust-log convention x = plan X, y = plan Z. Re-suggest and continuous
  // drag updates do NOT append; upload-reset starts a fresh log.
  adjustLog: AdjustLog
  downloadMode: 'full' | null
  downloadError: string | null

  // --- sidebar ---
  activeTab: SidebarTab

  // --- view mode ---
  viewMode: '2d' | '3d'

  // --- branch routes ---
  // Per-storey visibility of the T3 branch route overlay. Absent storeys default
  // to visible so routes show right after suggestion.
  branchRoutesVisibleByStorey: Map<StoreyId, boolean>

  // --- engineer baseline (W7) ---
  // Loaded on demand via the Decisions tab; null until then and after reset.
  engineerBaseline: EngineerBaselineState | null
  isExtractingEngineerBaseline: boolean
  engineerBaselineError: string | null
  // Per-storey visibility of the engineer overlay; absent = visible so the
  // layer shows right after loading (same convention as branch routes).
  engineerOverlayVisibleByStorey: Map<StoreyId, boolean>

  // --- continuity map (W5) ---
  // Built on demand via the Decisions tab; null until then and after reset.
  continuityMap: ContinuityMapState | null
  isBuildingContinuityMap: boolean
  // Extraction progress (storeys processed / total) while building; null when idle.
  continuityBuildProgress: { processed: number; total: number } | null
  continuityBuildError: string | null
  // Per-storey visibility of the continuity debug overlay; absent = visible.
  continuityOverlayVisibleByStorey: Map<StoreyId, boolean>
  // Snap flag: ON by default in plain mode (V3 wet-core placement consults the
  // continuity map whenever one is built), OFF in demo mode where the
  // toilet-anchored suggestions stay byte-identical to the pre-W5 behaviour.
  continuitySnapEnabled: boolean
  // Snap outcomes of the LAST suggest run (one per suggested stack); null when
  // the last run had snapping off. Misses stay visible here, never dropped.
  riserSnapOutcomes: SuggestedRiserSnapOutcome[] | null

  // --- wet-core suggestion + override bookkeeping (V3) ---
  // Auto stack id → wet-core id for stacks produced by the wet-core path. Lets a
  // re-suggest recognise "the moved stack of THIS core already exists" and skip
  // the fresh auto stack for it. Manual stacks never appear here.
  autoStackCoreIds: Map<string, string>
  // Per-stack vertical extent decisions of the last suggest run (V4); null when
  // the run did not bound stacks (demo mode / no whole-building fixtures).
  riserStackExtents: SuggestedRiserStackExtent[] | null
  wetCoreSuggestion: WetCoreSuggestionState | null
  // Async suggest lifecycle: the whole-building detection scan runs before the
  // stacks are built; progress is visible and the scan is cancellable.
  isSuggestingRisers: boolean
  suggestProgress: SuggestProgress | null
  suggestError: string | null
}

export const initialWorkspacePageState: WorkspacePageState = {
  webIfcModelId: null,
  modelFileName: null,
  storeys: [],
  modelLengthUnit: null,
  isParsingStoreys: false,
  uploadError: null,
  demoUploadError: null,
  demoAssetError: null,
  demoRuntime: { enabled: false },
  demoRuntimeConfigError: null,
  routingModel: 'branch-runs',
  linkedModels: [],
  storeyAlignments: [],
  selectedStoreyId: null,
  floorMeshes: null,
  isExtractingGeometry: false,
  geometryError: null,
  underlay: null,
  underlayError: null,
  crossFileMerge: null,
  initialStoreyDecision: null,
  modelOrigin: null,
  hoveredExpressId: null,
  selectedExpressId: null,
  fixtures: [],
  kitchens: [],
  isDetectingFixtures: false,
  risers: [],
  isAddingRiser: false,
  adjustLog: createAdjustLog(),
  downloadMode: null,
  downloadError: null,
  activeTab: 'fixtures',
  viewMode: '2d',
  branchRoutesVisibleByStorey: new Map(),
  engineerBaseline: null,
  isExtractingEngineerBaseline: false,
  engineerBaselineError: null,
  engineerOverlayVisibleByStorey: new Map(),
  continuityMap: null,
  isBuildingContinuityMap: false,
  continuityBuildProgress: null,
  continuityBuildError: null,
  continuityOverlayVisibleByStorey: new Map(),
  continuitySnapEnabled: false,
  riserSnapOutcomes: null,
  autoStackCoreIds: new Map(),
  riserStackExtents: null,
  wetCoreSuggestion: null,
  isSuggestingRisers: false,
  suggestProgress: null,
  suggestError: null,
}

// Lazy initializer for useReducer: resolves the demo runtime config exactly once
// per mount, keeping the invalid-config fallback identical to the previous
// useState initializer.
export function createInitialWorkspacePageState(): WorkspacePageState {
  try {
    const demoRuntime = getDemoRuntimeConfig()
    return {
      ...initialWorkspacePageState,
      demoRuntime,
      demoRuntimeConfigError: null,
      routingModel: resolveRoutingModel(demoRuntime),
      continuitySnapEnabled: defaultContinuitySnapEnabled(demoRuntime),
    }
  } catch (error) {
    return {
      ...initialWorkspacePageState,
      demoRuntime: { enabled: false },
      demoRuntimeConfigError: error instanceof Error ? error.message : 'Demo mode config is invalid.',
      routingModel: resolveRoutingModel({ enabled: false }),
      continuitySnapEnabled: defaultContinuitySnapEnabled({ enabled: false }),
    }
  }
}

/**
 * V3: snapping is ON by default in plain mode — whenever a continuity map is
 * built, the wet-core placement consults it. Demo mode keeps the W5 default
 * (OFF) so its suggestions stay byte-identical; the toggle remains for debug.
 */
export function defaultContinuitySnapEnabled(demoRuntime: DemoRuntimeConfig): boolean {
  return !demoRuntime.enabled
}

export type WorkspacePageAction =
  // Demo mode rejected the picked file before any parsing started.
  | { type: 'demo-upload-rejected'; message: string }
  // Urgent part of accepting a file: loader + file name visible immediately.
  | { type: 'upload-started'; fileName: string }
  // Transition part of accepting a file: clear all model-derived state.
  | { type: 'upload-reset' }
  | { type: 'model-opened'; webIfcModelId: number }
  // Carries the declared length unit alongside the storeys: both are read from
  // the same freshly-opened model, so they land in state atomically.
  | { type: 'storeys-parsed'; storeys: Storey[]; modelLengthUnit: LengthUnit | null }
  // Non-host files of a multi-file upload finished parsing; alignments carry
  // both successful mappings and explicitly blocked/failed linked files.
  | { type: 'linked-models-loaded'; linkedModels: LinkedModelState[]; alignments: StoreyAlignment[] }
  // Plain-mode floor auto-select outcome (chooser or its fallback), recorded
  // for the Decisions tab / debug JSON before the floor actually opens.
  | { type: 'initial-storey-chosen'; decision: InitialStoreyDecision }
  | { type: 'upload-failed'; message: string }
  | { type: 'upload-parsing-finished' }
  // `hasRisers` is sampled from the live riser ref at dispatch time because the
  // async openStorey flow reads it across awaits (see WorkspacePage).
  | { type: 'floor-opened'; storeyId: StoreyId; hasRisers: boolean }
  // Resolved once per model from the first storey with usable geometry; the
  // reducer ignores repeats so the origin can never drift mid-session.
  | { type: 'model-origin-resolved'; decision: ModelOriginDecision }
  | { type: 'floor-geometry-loaded'; floorMeshes: FloorMeshes }
  // Architecture underlay outcome for the open storey. null underlay with an
  // error keeps the failure visible; null with no error means "no aligned
  // linked storey with walls" (a normal state, not a failure).
  | { type: 'underlay-loaded'; underlay: StoreyUnderlayState | null }
  | { type: 'underlay-failed'; message: string }
  | {
      type: 'floor-fixtures-detected'
      fixtures: Fixture[]
      kitchens: KitchenArea[]
      hasRisers: boolean
      // Cross-file merge accounting; omitted/null on the single-file path.
      crossFileMerge?: MergedStoreyDetection | null
    }
  | { type: 'fixture-detection-finished' }
  | { type: 'floor-open-failed'; message: string }
  | { type: 'object-hovered'; expressId: number | null }
  | { type: 'object-selected'; expressId: number | null }
  // Stack risers are built at dispatch time (label counter lives in a ref).
  // `ts` is the ISO timestamp for the adjust-log entry, created at dispatch
  // time by the component so the reducer stays pure.
  | { type: 'riser-stack-added'; stackRisers: Riser[]; ts: string }
  | { type: 'riser-removed'; riserId: RiserId; ts: string }
  // Continuous drag update — positions only, never logged (see riser-move-committed).
  | { type: 'riser-moved'; riserId: RiserId; position: { x: number; y: number; z: number } }
  // Drag commit (pointer-up): appends one 'move' adjust-log entry. `from`/`to`
  // are SOURCE-frame positions; the risers themselves were already moved by the
  // continuous riser-moved dispatches during the drag.
  | {
      type: 'riser-move-committed'
      riserId: RiserId
      from: { x: number; y: number; z: number }
      to: { x: number; y: number; z: number }
      ts: string
    }
  // Label normalization computed by the page effect from the current risers.
  | { type: 'risers-normalized'; risers: Riser[] }
  // `snapOutcomes` is present (possibly empty) when the suggest run used the
  // continuity-snap flag, null/omitted when the flag was off. `risers` are the
  // NEW auto stacks only; the reducer merges them with the preserved manual /
  // moved stacks (see mergeSuggestedRisers). `stackCoreIds` / `wetCore` /
  // `stackExtents` come from the wet-core path (V3) and are omitted in demo mode.
  | {
      type: 'risers-suggested'
      risers: Riser[]
      snapOutcomes?: SuggestedRiserSnapOutcome[] | null
      stackExtents?: SuggestedRiserStackExtent[] | null
      stackCoreIds?: Array<{ stackId: string; coreId: string }>
      wetCore?: {
        sourceStoreyId: StoreyId
        stacks: WetCoreSuggestedStack[]
        cores: WetCore[]
        diagnostics: string[]
      } | null
    }
  // Async suggest lifecycle (V3): the whole-building scan before the stacks are
  // built. `suggest-cancelled` / `suggest-failed` are explicit, never silent.
  | { type: 'suggest-started' }
  | { type: 'suggest-progress'; processed: number; total: number; storeyName: string | null }
  | { type: 'suggest-cancelled' }
  | { type: 'suggest-failed'; message: string }
  | { type: 'add-riser-toggled' }
  | { type: 'branch-routes-toggled'; storeyId: StoreyId }
  // Engineer baseline extraction lifecycle (W7). Extraction is async in the
  // page; the reducer only tracks the in-flight flag, the result, and the
  // explicit failure message (never a silent no-op).
  | { type: 'engineer-extraction-started' }
  | { type: 'engineer-baseline-loaded'; baseline: EngineerBaselineState }
  | { type: 'engineer-extraction-failed'; message: string }
  | { type: 'engineer-overlay-toggled'; storeyId: StoreyId }
  // Continuity map lifecycle (W5). Building is async in the page; the reducer
  // tracks the in-flight flag, per-storey progress, the result, and explicit
  // failures (never a silent no-op).
  | { type: 'continuity-build-started' }
  | { type: 'continuity-build-progress'; processed: number; total: number }
  | { type: 'continuity-map-loaded'; continuityMap: ContinuityMapState }
  | { type: 'continuity-build-failed'; message: string }
  | { type: 'continuity-overlay-toggled'; storeyId: StoreyId }
  | { type: 'continuity-snap-toggled' }
  | { type: 'demo-asset-error-set'; message: string | null }
  | { type: 'download-started' }
  | { type: 'download-failed'; message: string }
  | { type: 'download-finished' }
  | { type: 'active-tab-set'; tab: SidebarTab }
  | { type: 'view-mode-set'; viewMode: '2d' | '3d' }

export function workspacePageReducer(
  state: WorkspacePageState,
  action: WorkspacePageAction,
): WorkspacePageState {
  const next = reduce(state, action)
  // Preserve the bail-out semantics the previous per-field useState calls had:
  // dispatching a value-identical update (e.g. hovering the same object) must
  // not produce a new state object, so React can skip the re-render.
  if (next !== state && shallowEqual(next, state)) return state
  return next
}

function reduce(state: WorkspacePageState, action: WorkspacePageAction): WorkspacePageState {
  switch (action.type) {
    case 'demo-upload-rejected':
      return { ...state, demoUploadError: action.message }

    case 'upload-started':
      return {
        ...state,
        isParsingStoreys: true,
        modelFileName: action.fileName,
        uploadError: null,
        demoUploadError: null,
      }

    case 'upload-reset':
      // Clears exactly what the pre-reducer upload transition cleared. It does
      // NOT touch modelFileName/uploadError/isParsingStoreys (owned by
      // 'upload-started'), downloadMode, the in-flight extraction/detection
      // flags, or the immutable demo runtime config.
      return {
        ...state,
        storeys: [],
        selectedStoreyId: null,
        floorMeshes: null,
        geometryError: null,
        hoveredExpressId: null,
        selectedExpressId: null,
        fixtures: [],
        kitchens: [],
        risers: [],
        isAddingRiser: false,
        activeTab: 'fixtures',
        downloadError: null,
        demoAssetError: null,
        viewMode: '2d',
        branchRoutesVisibleByStorey: new Map(),
        webIfcModelId: null,
        modelOrigin: null,
        modelLengthUnit: null,
        initialStoreyDecision: null,
        adjustLog: createAdjustLog(),
        linkedModels: [],
        storeyAlignments: [],
        underlay: null,
        underlayError: null,
        crossFileMerge: null,
        engineerBaseline: null,
        isExtractingEngineerBaseline: false,
        engineerBaselineError: null,
        engineerOverlayVisibleByStorey: new Map(),
        continuityMap: null,
        isBuildingContinuityMap: false,
        continuityBuildProgress: null,
        continuityBuildError: null,
        continuityOverlayVisibleByStorey: new Map(),
        continuitySnapEnabled: defaultContinuitySnapEnabled(state.demoRuntime),
        riserSnapOutcomes: null,
        autoStackCoreIds: new Map(),
        riserStackExtents: null,
        wetCoreSuggestion: null,
        isSuggestingRisers: false,
        suggestProgress: null,
        suggestError: null,
      }

    case 'model-opened':
      return { ...state, webIfcModelId: action.webIfcModelId }

    case 'storeys-parsed':
      return { ...state, storeys: action.storeys, modelLengthUnit: action.modelLengthUnit }

    case 'linked-models-loaded':
      return { ...state, linkedModels: action.linkedModels, storeyAlignments: action.alignments }

    case 'initial-storey-chosen':
      return { ...state, initialStoreyDecision: action.decision }

    case 'upload-failed':
      return { ...state, uploadError: action.message }

    case 'upload-parsing-finished':
      return { ...state, isParsingStoreys: false }

    case 'floor-opened':
      // Risers are NOT cleared — they span all floors and persist across selection.
      return {
        ...state,
        selectedStoreyId: action.storeyId,
        floorMeshes: null,
        geometryError: null,
        underlay: null,
        underlayError: null,
        crossFileMerge: null,
        isExtractingGeometry: true,
        hoveredExpressId: null,
        selectedExpressId: null,
        fixtures: [],
        kitchens: [],
        isDetectingFixtures: true,
        isAddingRiser: false,
        activeTab: action.hasRisers ? 'risers' : 'fixtures',
        downloadError: null,
        demoAssetError: null,
      }

    case 'model-origin-resolved':
      // Computed once per model: a second resolution (e.g. re-opening a floor)
      // must never move the frame under existing localized state.
      if (state.modelOrigin !== null) return state
      return { ...state, modelOrigin: action.decision }

    case 'floor-geometry-loaded':
      return { ...state, floorMeshes: action.floorMeshes, isExtractingGeometry: false }

    case 'underlay-loaded':
      return { ...state, underlay: action.underlay, underlayError: null }

    case 'underlay-failed':
      return { ...state, underlay: null, underlayError: action.message }

    case 'floor-fixtures-detected':
      // Detection and placement are split into two distinct phases.
      // Risers are placed only when the user explicitly clicks Suggest.
      return {
        ...state,
        fixtures: action.fixtures,
        kitchens: action.kitchens,
        crossFileMerge: action.crossFileMerge ?? null,
        activeTab: action.hasRisers ? state.activeTab : 'fixtures',
      }

    case 'fixture-detection-finished':
      return { ...state, isDetectingFixtures: false }

    case 'floor-open-failed':
      return {
        ...state,
        geometryError: action.message,
        isExtractingGeometry: false,
        isDetectingFixtures: false,
      }

    case 'object-hovered':
      return { ...state, hoveredExpressId: action.expressId }

    case 'object-selected':
      return { ...state, selectedExpressId: action.expressId }

    case 'riser-stack-added': {
      // One 'add' log entry per stack, anchored to the floor it was placed on
      // (the whole stack shares the same plan position).
      const placed =
        action.stackRisers.find((riser) => riser.storeyId === state.selectedStoreyId) ??
        action.stackRisers[0]
      return {
        ...state,
        risers: [...state.risers, ...action.stackRisers],
        adjustLog: placed
          ? appendAdjustment(state.adjustLog, {
              action: 'add',
              stackId: placed.stackId,
              storey: placed.storeyId,
              from: toAdjustPlanPoint(placed.position),
              to: toAdjustPlanPoint(placed.position),
              ts: action.ts,
            })
          : state.adjustLog,
      }
    }

    case 'riser-removed': {
      // Deleting a riser removes the whole vertical stack across all floors immediately.
      const removed = state.risers.find((riser) => riser.id === action.riserId)
      const risers = removeRiserStack(state.risers, action.riserId)
      if (risers === state.risers || !removed) return state
      // Removal is not an override: the next suggest may propose the core again.
      const autoStackCoreIds = new Map(state.autoStackCoreIds)
      autoStackCoreIds.delete(removed.stackId)
      return {
        ...state,
        risers,
        autoStackCoreIds,
        adjustLog: appendAdjustment(state.adjustLog, {
          action: 'remove',
          stackId: removed.stackId,
          storey: removed.storeyId,
          from: toAdjustPlanPoint(removed.position),
          to: null,
          ts: action.ts,
        }),
      }
    }

    case 'riser-moved': {
      // Propagate X/Z to every floor in the same stack; preserve each floor's Y.
      const movedRiser = state.risers.find((r) => r.id === action.riserId)
      if (!movedRiser) return state
      return {
        ...state,
        risers: state.risers.map((r) =>
          r.stackId === movedRiser.stackId
            ? { ...r, position: { x: action.position.x, y: r.position.y, z: action.position.z } }
            : r,
        ),
      }
    }

    case 'riser-move-committed': {
      // Drag already applied the position via riser-moved; here we only record
      // the adjustment. from/to arrive in SOURCE plan coordinates (see the
      // adjustLog field comment), so no conversion happens in the reducer.
      const moved = state.risers.find((riser) => riser.id === action.riserId)
      if (!moved) return state
      return {
        ...state,
        adjustLog: appendAdjustment(state.adjustLog, {
          action: 'move',
          stackId: moved.stackId,
          storey: moved.storeyId,
          from: toAdjustPlanPoint(action.from),
          to: toAdjustPlanPoint(action.to),
          ts: action.ts,
        }),
      }
    }

    case 'risers-normalized':
      return { ...state, risers: action.risers }

    case 'risers-suggested': {
      const merge = mergeSuggestedRisers(state, action.risers, action.stackCoreIds ?? [])
      const wetCore = action.wetCore ?? null
      return {
        ...state,
        risers: merge.risers,
        autoStackCoreIds: merge.autoStackCoreIds,
        isAddingRiser: false,
        activeTab: 'risers',
        riserSnapOutcomes: action.snapOutcomes ?? null,
        riserStackExtents: action.stackExtents ?? null,
        wetCoreSuggestion:
          wetCore === null
            ? null
            : {
                sourceStoreyId: wetCore.sourceStoreyId,
                stacks: wetCore.stacks.filter((stack) => !merge.supersededStackIds.has(stack.stackId)),
                cores: wetCore.cores,
                supersededCoreIds: merge.supersededCoreIds,
                preservedStackIds: merge.preservedStackIds,
                diagnostics: wetCore.diagnostics,
              },
        isSuggestingRisers: false,
        suggestProgress: null,
        suggestError: null,
      }
    }

    case 'suggest-started':
      return { ...state, isSuggestingRisers: true, suggestProgress: null, suggestError: null }

    case 'suggest-progress':
      return {
        ...state,
        suggestProgress: { processed: action.processed, total: action.total, storeyName: action.storeyName },
      }

    case 'suggest-cancelled':
      return { ...state, isSuggestingRisers: false, suggestProgress: null, suggestError: null }

    case 'suggest-failed':
      return { ...state, isSuggestingRisers: false, suggestProgress: null, suggestError: action.message }

    case 'add-riser-toggled':
      return { ...state, isAddingRiser: !state.isAddingRiser }

    case 'branch-routes-toggled': {
      const next = new Map(state.branchRoutesVisibleByStorey)
      next.set(action.storeyId, !(state.branchRoutesVisibleByStorey.get(action.storeyId) ?? true))
      return { ...state, branchRoutesVisibleByStorey: next }
    }

    case 'engineer-extraction-started':
      return { ...state, isExtractingEngineerBaseline: true, engineerBaselineError: null }

    case 'engineer-baseline-loaded':
      return {
        ...state,
        engineerBaseline: action.baseline,
        isExtractingEngineerBaseline: false,
        engineerBaselineError: null,
      }

    case 'engineer-extraction-failed':
      return {
        ...state,
        engineerBaseline: null,
        isExtractingEngineerBaseline: false,
        engineerBaselineError: action.message,
      }

    case 'engineer-overlay-toggled': {
      const next = new Map(state.engineerOverlayVisibleByStorey)
      next.set(action.storeyId, !(state.engineerOverlayVisibleByStorey.get(action.storeyId) ?? true))
      return { ...state, engineerOverlayVisibleByStorey: next }
    }

    case 'continuity-build-started':
      return {
        ...state,
        isBuildingContinuityMap: true,
        continuityBuildProgress: null,
        continuityBuildError: null,
      }

    case 'continuity-build-progress':
      return {
        ...state,
        continuityBuildProgress: { processed: action.processed, total: action.total },
      }

    case 'continuity-map-loaded':
      return {
        ...state,
        continuityMap: action.continuityMap,
        isBuildingContinuityMap: false,
        continuityBuildProgress: null,
        continuityBuildError: null,
      }

    case 'continuity-build-failed':
      return {
        ...state,
        continuityMap: null,
        isBuildingContinuityMap: false,
        continuityBuildProgress: null,
        continuityBuildError: action.message,
      }

    case 'continuity-overlay-toggled': {
      const next = new Map(state.continuityOverlayVisibleByStorey)
      next.set(action.storeyId, !(state.continuityOverlayVisibleByStorey.get(action.storeyId) ?? true))
      return { ...state, continuityOverlayVisibleByStorey: next }
    }

    case 'continuity-snap-toggled':
      return { ...state, continuitySnapEnabled: !state.continuitySnapEnabled }

    case 'demo-asset-error-set':
      return { ...state, demoAssetError: action.message }

    case 'download-started':
      return { ...state, downloadMode: 'full', downloadError: null }

    case 'download-failed':
      return { ...state, downloadError: action.message }

    case 'download-finished':
      return { ...state, downloadMode: null }

    case 'active-tab-set':
      return { ...state, activeTab: action.tab }

    case 'view-mode-set':
      return { ...state, viewMode: action.viewMode }
  }
}

// ---------------------------------------------------------------------------
// Re-suggest merge rule (AGENTS.md / CLAUDE.md "manual override must always win")
// ---------------------------------------------------------------------------

/**
 * Stack ids that survive a re-suggest: user-added stacks (`source: 'manual'`)
 * and auto stacks the user dragged (a 'move' entry in the adjust log — the
 * override marker; the reducer never rewrites `source`). Removed stacks are
 * not overrides: the next suggest may propose the core again.
 */
export function selectOverriddenStackIds(state: Pick<WorkspacePageState, 'risers' | 'adjustLog'>): Set<string> {
  const movedStackIds = new Set(
    state.adjustLog.entries.filter((entry) => entry.action === 'move').map((entry) => entry.stackId),
  )
  const preserved = new Set<string>()
  for (const riser of state.risers) {
    if (riser.source === 'manual' || movedStackIds.has(riser.stackId)) preserved.add(riser.stackId)
  }
  return preserved
}

/** Risers that a re-suggest keeps untouched (see {@link selectOverriddenStackIds}). */
export function selectPreservedRisersOnResuggest(
  state: Pick<WorkspacePageState, 'risers' | 'adjustLog'>,
): Riser[] {
  const preserved = selectOverriddenStackIds(state)
  return state.risers.filter((riser) => preserved.has(riser.stackId))
}

/**
 * Wet cores whose auto stack was moved by the user: the builder skips them on
 * re-suggest (no fresh stack, no label consumed) so labels stay contiguous.
 * Manual stacks have no core and never appear here.
 */
export function selectPreservedCoreIdsOnResuggest(
  state: Pick<WorkspacePageState, 'risers' | 'adjustLog' | 'autoStackCoreIds'>,
): Set<string> {
  const preserved = new Set<string>()
  for (const stackId of selectOverriddenStackIds(state)) {
    const coreId = state.autoStackCoreIds.get(stackId)
    if (coreId !== undefined) preserved.add(coreId)
  }
  return preserved
}

export interface MergeSuggestedRisersResult {
  /** Preserved stacks first (in their existing order), then the accepted new auto stacks. */
  risers: Riser[]
  autoStackCoreIds: Map<string, string>
  preservedStackIds: string[]
  /** New auto stacks dropped because a preserved (moved) stack already represents their core. */
  supersededStackIds: Set<string>
  supersededCoreIds: string[]
}

/**
 * Final riser set = (auto risers without an override → replaced by the new
 * suggestion) + (overridden auto risers, i.e. moved) + (user-added risers).
 * A new auto stack whose wet-core id matches a preserved auto stack's core is
 * dropped so the moved stack stays the only stack of that core. Without core
 * ids (demo / toilet-anchored path) every new auto stack is accepted next to
 * the preserved ones.
 */
export function mergeSuggestedRisers(
  state: Pick<WorkspacePageState, 'risers' | 'adjustLog' | 'autoStackCoreIds'>,
  incoming: Riser[],
  stackCoreIds: Array<{ stackId: string; coreId: string }>,
): MergeSuggestedRisersResult {
  const preservedStackIdSet = selectOverriddenStackIds(state)
  const preservedRisers = state.risers.filter((riser) => preservedStackIdSet.has(riser.stackId))
  const preservedCoreIds = new Set<string>()
  const autoStackCoreIds = new Map<string, string>()
  for (const stackId of preservedStackIdSet) {
    const coreId = state.autoStackCoreIds.get(stackId)
    if (coreId !== undefined) {
      preservedCoreIds.add(coreId)
      autoStackCoreIds.set(stackId, coreId)
    }
  }

  const incomingCoreByStack = new Map(stackCoreIds.map((entry) => [entry.stackId, entry.coreId]))
  const supersededStackIds = new Set<string>()
  const supersededCoreIds: string[] = []
  for (const [stackId, coreId] of incomingCoreByStack) {
    if (preservedCoreIds.has(coreId)) {
      supersededStackIds.add(stackId)
      supersededCoreIds.push(coreId)
    } else {
      autoStackCoreIds.set(stackId, coreId)
    }
  }
  const accepted = incoming.filter((riser) => !supersededStackIds.has(riser.stackId))

  return {
    risers: [...preservedRisers, ...accepted],
    autoStackCoreIds,
    preservedStackIds: [...new Set(preservedRisers.map((riser) => riser.stackId))],
    supersededStackIds,
    supersededCoreIds,
  }
}

/** Adjust-log plan point from a 3D riser position: x = plan X, y = plan Z. */
function toAdjustPlanPoint(position: { x: number; z: number }): { x: number; y: number } {
  return { x: position.x, y: position.z }
}

function shallowEqual(a: WorkspacePageState, b: WorkspacePageState): boolean {
  for (const key of Object.keys(a) as Array<keyof WorkspacePageState>) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}
