import type { Fixture, KitchenArea, Riser, RiserId, Storey, StoreyId, SidebarTab } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
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
  hoveredExpressId: null,
  selectedExpressId: null,
  fixtures: [],
  kitchens: [],
  isDetectingFixtures: false,
  risers: [],
  isAddingRiser: false,
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
  | { type: 'storeys-parsed'; storeys: Storey[] }
  | { type: 'upload-failed'; message: string }
  | { type: 'upload-parsing-finished' }
  // `hasRisers` is sampled from the live riser ref at dispatch time because the
  // async openStorey flow reads it across awaits (see WorkspacePage).
  | { type: 'floor-opened'; storeyId: StoreyId; hasRisers: boolean }
  | { type: 'floor-geometry-loaded'; floorMeshes: FloorMeshes }
  | { type: 'floor-fixtures-detected'; fixtures: Fixture[]; kitchens: KitchenArea[]; hasRisers: boolean }
  | { type: 'fixture-detection-finished' }
  | { type: 'floor-open-failed'; message: string }
  | { type: 'object-hovered'; expressId: number | null }
  | { type: 'object-selected'; expressId: number | null }
  // Stack risers are built at dispatch time (label counter lives in a ref).
  | { type: 'riser-stack-added'; stackRisers: Riser[] }
  | { type: 'riser-removed'; riserId: RiserId }
  | { type: 'riser-moved'; riserId: RiserId; position: { x: number; y: number; z: number } }
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
      }

    case 'model-opened':
      return { ...state, webIfcModelId: action.webIfcModelId }

    case 'storeys-parsed':
      return { ...state, storeys: action.storeys }

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

    case 'riser-stack-added':
      return { ...state, risers: [...state.risers, ...action.stackRisers] }

    case 'riser-removed': {
      // Deleting a riser removes the whole vertical stack across all floors immediately.
      const risers = removeRiserStack(state.risers, action.riserId)
      if (risers === state.risers) return state
      return { ...state, risers }
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

function shallowEqual(a: WorkspacePageState, b: WorkspacePageState): boolean {
  for (const key of Object.keys(a) as Array<keyof WorkspacePageState>) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}
