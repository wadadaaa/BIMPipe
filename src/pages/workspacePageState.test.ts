import { describe, expect, it } from 'vitest'
import type { Fixture, KitchenArea, Riser, Storey } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import {
  createInitialWorkspacePageState,
  initialWorkspacePageState,
  workspacePageReducer,
  type WorkspacePageState,
} from './workspacePageState'

function makeRiser(overrides: Partial<Riser> & Pick<Riser, 'id'>): Riser {
  return {
    stackId: `stack-${overrides.id}`,
    stackLabel: 'R1',
    storeyId: 2,
    position: { x: 0, y: 0, z: 0 },
    systemType: 'sanitary',
    source: 'placed',
    ...overrides,
  }
}

function makeStorey(overrides: Partial<Storey> & Pick<Storey, 'id'>): Storey {
  return { name: `Storey ${overrides.id}`, elevation: 0, modelId: 'model-1', ...overrides }
}

const fixtureA: Fixture = {
  expressId: 11,
  name: 'WC-11',
  kind: 'TOILETPAN',
  storeyId: 2,
  position: { x: 1, y: 0, z: 1 },
}

const kitchenA: KitchenArea = {
  expressId: 21,
  name: 'Kitchen-21',
  storeyId: 2,
  position: { x: 9, y: 0, z: 9 },
}

const floorMeshesStub = {
  group: null,
  boundingBox: { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } },
} as unknown as FloorMeshes

/** A state mid-session: model open, floor selected, fixtures detected, mixed risers. */
function makeLoadedState(): WorkspacePageState {
  return {
    ...initialWorkspacePageState,
    webIfcModelId: 101,
    modelFileName: 'tower.ifc',
    storeys: [makeStorey({ id: 2, elevation: 3 }), makeStorey({ id: 3, elevation: 6 })],
    selectedStoreyId: 2,
    floorMeshes: floorMeshesStub,
    fixtures: [fixtureA],
    kitchens: [kitchenA],
    risers: [
      makeRiser({ id: 'auto-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 2, source: 'placed' }),
      makeRiser({ id: 'auto-1b', stackId: 'stack-a', stackLabel: 'R1', storeyId: 3, source: 'placed' }),
      makeRiser({ id: 'manual-1', stackId: 'stack-m', stackLabel: 'R2', storeyId: 2, source: 'manual' }),
    ],
    isAddingRiser: true,
    activeTab: 'risers',
    viewMode: '3d',
    downloadMode: 'full',
    downloadError: 'previous failure',
    demoAssetError: 'previous demo warning',
    branchRoutesVisibleByStorey: new Map([[2, false]]),
    hoveredExpressId: 11,
    selectedExpressId: 12,
  }
}

describe('createInitialWorkspacePageState', () => {
  it('starts from the documented initial state with the resolved demo runtime', () => {
    // DEMO_MODE is not set in the test env, so the runtime resolves to disabled.
    expect(createInitialWorkspacePageState()).toEqual({
      ...initialWorkspacePageState,
      demoRuntime: { enabled: false },
      demoRuntimeConfigError: null,
    })
  })
})

describe('workspacePageReducer upload flow', () => {
  it('upload-started shows the loader and clears upload/demo errors without touching model state yet', () => {
    const before = { ...makeLoadedState(), uploadError: 'boom', demoUploadError: 'wrong file' }
    const after = workspacePageReducer(before, { type: 'upload-started', fileName: 'next.ifc' })

    expect(after.isParsingStoreys).toBe(true)
    expect(after.modelFileName).toBe('next.ifc')
    expect(after.uploadError).toBeNull()
    expect(after.demoUploadError).toBeNull()
    // The reset happens in a separate transition-lane action.
    expect(after.storeys).toBe(before.storeys)
    expect(after.risers).toBe(before.risers)
    expect(after.selectedStoreyId).toBe(2)
  })

  it('upload-reset clears exactly the model-derived slices and preserves the rest', () => {
    const before = workspacePageReducer(
      { ...makeLoadedState(), uploadError: null, isParsingStoreys: true },
      { type: 'upload-started', fileName: 'next.ifc' },
    )
    const after = workspacePageReducer(before, { type: 'upload-reset' })

    // Cleared (same list the pre-reducer upload transition cleared):
    expect(after.storeys).toEqual([])
    expect(after.selectedStoreyId).toBeNull()
    expect(after.floorMeshes).toBeNull()
    expect(after.geometryError).toBeNull()
    expect(after.hoveredExpressId).toBeNull()
    expect(after.selectedExpressId).toBeNull()
    expect(after.fixtures).toEqual([])
    expect(after.kitchens).toEqual([])
    expect(after.risers).toEqual([])
    expect(after.isAddingRiser).toBe(false)
    expect(after.activeTab).toBe('fixtures')
    expect(after.downloadError).toBeNull()
    expect(after.demoAssetError).toBeNull()
    expect(after.viewMode).toBe('2d')
    expect(after.branchRoutesVisibleByStorey.size).toBe(0)
    expect(after.webIfcModelId).toBeNull()

    // Preserved (owned by other actions or immutable per mount):
    expect(after.modelFileName).toBe('next.ifc')
    expect(after.isParsingStoreys).toBe(true)
    expect(after.downloadMode).toBe('full')
    expect(after.demoRuntime).toBe(before.demoRuntime)
    expect(after.demoRuntimeConfigError).toBe(before.demoRuntimeConfigError)
  })

  it('walks the happy upload path deterministically', () => {
    const storeys = [makeStorey({ id: 2 })]
    let state = workspacePageReducer(createInitialWorkspacePageState(), {
      type: 'upload-started',
      fileName: 'tower.ifc',
    })
    state = workspacePageReducer(state, { type: 'upload-reset' })
    state = workspacePageReducer(state, { type: 'model-opened', webIfcModelId: 101 })
    state = workspacePageReducer(state, { type: 'storeys-parsed', storeys })
    state = workspacePageReducer(state, { type: 'upload-parsing-finished' })

    expect(state.webIfcModelId).toBe(101)
    expect(state.storeys).toBe(storeys)
    expect(state.isParsingStoreys).toBe(false)
    expect(state.uploadError).toBeNull()
  })

  it('upload-failed and demo-upload-rejected only touch their error slice', () => {
    const base = makeLoadedState()

    const failed = workspacePageReducer(base, { type: 'upload-failed', message: 'bad ifc' })
    expect(failed.uploadError).toBe('bad ifc')
    expect(failed.risers).toBe(base.risers)

    const rejected = workspacePageReducer(base, { type: 'demo-upload-rejected', message: 'wrong model' })
    expect(rejected.demoUploadError).toBe('wrong model')
    expect(rejected.modelFileName).toBe(base.modelFileName)
    expect(rejected.risers).toBe(base.risers)
  })
})

describe('workspacePageReducer floor flow', () => {
  it('floor-opened resets floor-scoped slices but keeps risers (they span all floors)', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, { type: 'floor-opened', storeyId: 3, hasRisers: true })

    expect(after.selectedStoreyId).toBe(3)
    expect(after.floorMeshes).toBeNull()
    expect(after.geometryError).toBeNull()
    expect(after.isExtractingGeometry).toBe(true)
    expect(after.hoveredExpressId).toBeNull()
    expect(after.selectedExpressId).toBeNull()
    expect(after.fixtures).toEqual([])
    expect(after.kitchens).toEqual([])
    expect(after.isDetectingFixtures).toBe(true)
    expect(after.isAddingRiser).toBe(false)
    expect(after.downloadError).toBeNull()
    expect(after.demoAssetError).toBeNull()
    expect(after.activeTab).toBe('risers')
    // Load-bearing: risers persist across floor selection, untouched.
    expect(after.risers).toBe(before.risers)
    // Per-floor branch-route visibility also survives floor changes.
    expect(after.branchRoutesVisibleByStorey).toBe(before.branchRoutesVisibleByStorey)
  })

  it('floor-opened lands on the fixtures tab when no risers exist yet', () => {
    const after = workspacePageReducer(makeLoadedState(), { type: 'floor-opened', storeyId: 3, hasRisers: false })
    expect(after.activeTab).toBe('fixtures')
  })

  it('floor geometry and detection results land without disturbing the risers tab when risers exist', () => {
    let state = workspacePageReducer(makeLoadedState(), { type: 'floor-opened', storeyId: 3, hasRisers: true })
    state = workspacePageReducer(state, { type: 'floor-geometry-loaded', floorMeshes: floorMeshesStub })
    expect(state.floorMeshes).toBe(floorMeshesStub)
    expect(state.isExtractingGeometry).toBe(false)

    state = workspacePageReducer(state, {
      type: 'floor-fixtures-detected',
      fixtures: [fixtureA],
      kitchens: [kitchenA],
      hasRisers: true,
    })
    expect(state.fixtures).toEqual([fixtureA])
    expect(state.kitchens).toEqual([kitchenA])
    expect(state.activeTab).toBe('risers')

    state = workspacePageReducer(state, { type: 'fixture-detection-finished' })
    expect(state.isDetectingFixtures).toBe(false)
  })

  it('floor-fixtures-detected falls back to the fixtures tab when no risers exist', () => {
    const opened = workspacePageReducer(makeLoadedState(), { type: 'floor-opened', storeyId: 3, hasRisers: false })
    const after = workspacePageReducer(opened, {
      type: 'floor-fixtures-detected',
      fixtures: [fixtureA],
      kitchens: [],
      hasRisers: false,
    })
    expect(after.activeTab).toBe('fixtures')
  })

  it('floor-open-failed surfaces the reason and stops both loaders', () => {
    const opened = workspacePageReducer(makeLoadedState(), { type: 'floor-opened', storeyId: 3, hasRisers: true })
    const after = workspacePageReducer(opened, { type: 'floor-open-failed', message: 'no geometry' })
    expect(after.geometryError).toBe('no geometry')
    expect(after.isExtractingGeometry).toBe(false)
    expect(after.isDetectingFixtures).toBe(false)
  })
})

describe('workspacePageReducer riser actions', () => {
  it('riser-stack-added appends without touching existing manual or suggested risers', () => {
    const before = makeLoadedState()
    const stack = [
      makeRiser({ id: 'new-1', stackId: 'stack-n', stackLabel: 'R3', storeyId: 2, source: 'manual' }),
      makeRiser({ id: 'new-2', stackId: 'stack-n', stackLabel: 'R3', storeyId: 3, source: 'manual' }),
    ]
    const after = workspacePageReducer(before, { type: 'riser-stack-added', stackRisers: stack })

    expect(after.risers).toEqual([...before.risers, ...stack])
    // Prior entries keep their identity and their source discrimination.
    expect(after.risers[0]).toBe(before.risers[0])
    expect(after.risers.map((riser) => riser.source)).toEqual([
      'placed',
      'placed',
      'manual',
      'manual',
      'manual',
    ])
  })

  it('riser-removed drops the whole vertical stack and leaves other stacks alone', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, { type: 'riser-removed', riserId: 'auto-1' })

    expect(after.risers.map((riser) => riser.id)).toEqual(['manual-1'])
    // The manually placed riser (separate stack) is untouched.
    expect(after.risers[0]).toBe(before.risers[2])
  })

  it('riser-removed with an unknown id bails out with the identical state object', () => {
    const before = makeLoadedState()
    expect(workspacePageReducer(before, { type: 'riser-removed', riserId: 'ghost' })).toBe(before)
  })

  it('riser-moved propagates X/Z across the stack and preserves each floor Y', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, {
      type: 'riser-moved',
      riserId: 'auto-1',
      position: { x: 7, y: 99, z: 8 },
    })

    const stackA = after.risers.filter((riser) => riser.stackId === 'stack-a')
    expect(stackA).toHaveLength(2)
    for (const [index, riser] of stackA.entries()) {
      expect(riser.position.x).toBe(7)
      expect(riser.position.z).toBe(8)
      expect(riser.position.y).toBe(before.risers[index].position.y)
    }
    // Other stacks keep their exact object identity.
    expect(after.risers[2]).toBe(before.risers[2])
  })

  it('riser-moved with an unknown id bails out with the identical state object', () => {
    const before = makeLoadedState()
    expect(workspacePageReducer(before, { type: 'riser-moved', riserId: 'ghost', position: { x: 1, y: 1, z: 1 } })).toBe(
      before,
    )
  })

  it('risers-suggested replaces the riser set and lands on the risers tab', () => {
    const before = makeLoadedState()
    const suggested = [makeRiser({ id: 'sug-1', stackId: 'stack-s', stackLabel: 'R1', source: 'placed' })]
    const after = workspacePageReducer(before, { type: 'risers-suggested', risers: suggested })

    expect(after.risers).toBe(suggested)
    expect(after.isAddingRiser).toBe(false)
    expect(after.activeTab).toBe('risers')
  })

  it('risers-normalized swaps in the normalized array as-is', () => {
    const before = makeLoadedState()
    const normalized = before.risers.map((riser) => ({ ...riser, stackLabel: riser.stackLabel }))
    const after = workspacePageReducer(before, { type: 'risers-normalized', risers: normalized })
    expect(after.risers).toBe(normalized)
  })

  it('add-riser-toggled flips placement mode', () => {
    const before = makeLoadedState()
    const once = workspacePageReducer(before, { type: 'add-riser-toggled' })
    expect(once.isAddingRiser).toBe(false)
    const twice = workspacePageReducer(once, { type: 'add-riser-toggled' })
    expect(twice.isAddingRiser).toBe(true)
  })
})

describe('workspacePageReducer branch routes and misc', () => {
  it('branch-routes-toggled defaults absent storeys to visible and flips per storey', () => {
    const base = { ...makeLoadedState(), branchRoutesVisibleByStorey: new Map<number, boolean>() }

    const hidden = workspacePageReducer(base, { type: 'branch-routes-toggled', storeyId: 2 })
    expect(hidden.branchRoutesVisibleByStorey.get(2)).toBe(false)

    const shown = workspacePageReducer(hidden, { type: 'branch-routes-toggled', storeyId: 2 })
    expect(shown.branchRoutesVisibleByStorey.get(2)).toBe(true)

    // Other storeys stay untouched by the per-floor toggle.
    expect(shown.branchRoutesVisibleByStorey.has(3)).toBe(false)
  })

  it('download lifecycle transitions match the previous setter sequence', () => {
    const base = { ...makeLoadedState(), downloadMode: null as 'full' | null, downloadError: 'stale' }

    const started = workspacePageReducer(base, { type: 'download-started' })
    expect(started.downloadMode).toBe('full')
    expect(started.downloadError).toBeNull()

    const failed = workspacePageReducer(started, { type: 'download-failed', message: 'export blew up' })
    expect(failed.downloadError).toBe('export blew up')
    expect(failed.downloadMode).toBe('full')

    const finished = workspacePageReducer(failed, { type: 'download-finished' })
    expect(finished.downloadMode).toBeNull()
    expect(finished.downloadError).toBe('export blew up')
  })

  it('value-identical updates bail out with the same state object, like useState did', () => {
    const base = makeLoadedState()

    expect(workspacePageReducer(base, { type: 'object-hovered', expressId: base.hoveredExpressId })).toBe(base)
    expect(workspacePageReducer(base, { type: 'object-selected', expressId: base.selectedExpressId })).toBe(base)
    expect(workspacePageReducer(base, { type: 'active-tab-set', tab: base.activeTab })).toBe(base)
    expect(workspacePageReducer(base, { type: 'view-mode-set', viewMode: base.viewMode })).toBe(base)
    const noDemoError = { ...base, demoAssetError: null }
    expect(workspacePageReducer(noDemoError, { type: 'demo-asset-error-set', message: null })).toBe(noDemoError)
  })

  it('is deterministic: the same state and action produce equal results', () => {
    const base = makeLoadedState()
    const action = { type: 'floor-opened', storeyId: 3, hasRisers: true } as const
    expect(workspacePageReducer(base, action)).toEqual(workspacePageReducer(base, action))

    const move = { type: 'riser-moved', riserId: 'auto-1', position: { x: 4, y: 5, z: 6 } } as const
    expect(workspacePageReducer(base, move)).toEqual(workspacePageReducer(base, move))
  })
})
