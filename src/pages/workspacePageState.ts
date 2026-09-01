import type { Fixture, KitchenArea, Riser, RiserId, Storey, StoreyId, SidebarTab } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import type { InitialStoreyDecision } from '@/shared/ifc/scanStoreyFixtures'
import type { ModelOriginDecision } from '@/shared/frame/modelFrame'
import type { LengthUnit } from '@/shared/lengthUnits'
import { appendAdjustment, createAdjustLog, type AdjustLog } from '@/domain/adjustLog'
import { getDemoRuntimeConfig, type DemoRuntimeConfig } from '@/shared/demoConfig'
import { removeRiserStack } from '@/shared/routes/buildRiserStacks'

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

  // --- floor extraction ---
  selectedStoreyId: StoreyId | null
  floorMeshes: FloorMeshes | null
  isExtractingGeometry: boolean
  geometryError: string | null

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
  selectedStoreyId: null,
  floorMeshes: null,
  isExtractingGeometry: false,
  geometryError: null,
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
}

// Lazy initializer for useReducer: resolves the demo runtime config exactly once
// per mount, keeping the invalid-config fallback identical to the previous
// useState initializer.
export function createInitialWorkspacePageState(): WorkspacePageState {
  try {
    return {
      ...initialWorkspacePageState,
      demoRuntime: getDemoRuntimeConfig(),
      demoRuntimeConfigError: null,
    }
  } catch (error) {
    return {
      ...initialWorkspacePageState,
      demoRuntime: { enabled: false },
      demoRuntimeConfigError: error instanceof Error ? error.message : 'Demo mode config is invalid.',
    }
  }
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
  | { type: 'floor-fixtures-detected'; fixtures: Fixture[]; kitchens: KitchenArea[]; hasRisers: boolean }
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
  | { type: 'risers-suggested'; risers: Riser[] }
  | { type: 'add-riser-toggled' }
  | { type: 'branch-routes-toggled'; storeyId: StoreyId }
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
      }

    case 'model-opened':
      return { ...state, webIfcModelId: action.webIfcModelId }

    case 'storeys-parsed':
      return { ...state, storeys: action.storeys, modelLengthUnit: action.modelLengthUnit }

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

    case 'floor-fixtures-detected':
      // Detection and placement are split into two distinct phases.
      // Risers are placed only when the user explicitly clicks Suggest.
      return {
        ...state,
        fixtures: action.fixtures,
        kitchens: action.kitchens,
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
      return {
        ...state,
        risers,
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

    case 'risers-suggested':
      return { ...state, risers: action.risers, isAddingRiser: false, activeTab: 'risers' }

    case 'add-riser-toggled':
      return { ...state, isAddingRiser: !state.isAddingRiser }

    case 'branch-routes-toggled': {
      const next = new Map(state.branchRoutesVisibleByStorey)
      next.set(action.storeyId, !(state.branchRoutesVisibleByStorey.get(action.storeyId) ?? true))
      return { ...state, branchRoutesVisibleByStorey: next }
    }

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
