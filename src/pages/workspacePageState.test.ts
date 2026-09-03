import { describe, expect, it } from 'vitest'
import type { Fixture, KitchenArea, Riser, Storey } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import {
  createInitialWorkspacePageState,
  defaultContinuitySnapEnabled,
  initialWorkspacePageState,
  selectPreservedCoreIdsOnResuggest,
  selectPreservedRisersOnResuggest,
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

/** Fixed dispatch-time timestamp for adjust-log actions. */
const TS = '2026-09-01T12:00:00.000Z'

/** A state mid-session: model open, floor selected, fixtures detected, mixed risers. */
function makeLoadedState(): WorkspacePageState {
  return {
    ...initialWorkspacePageState,
    webIfcModelId: 101,
    modelFileName: 'tower.ifc',
    modelLengthUnit: 'cm',
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
      // Plain mode: continuity snapping defaults ON (V3).
      continuitySnapEnabled: true,
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
    expect(after.modelLengthUnit).toBeNull()

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
    state = workspacePageReducer(state, { type: 'storeys-parsed', storeys, modelLengthUnit: 'mm' })
    state = workspacePageReducer(state, { type: 'upload-parsing-finished' })

    expect(state.webIfcModelId).toBe(101)
    expect(state.storeys).toBe(storeys)
    expect(state.modelLengthUnit).toBe('mm')
    expect(state.isParsingStoreys).toBe(false)
    expect(state.uploadError).toBeNull()
  })

  it('storeys-parsed stores a null unit as-is: undeclared units are never guessed', () => {
    const after = workspacePageReducer(makeLoadedState(), {
      type: 'storeys-parsed',
      storeys: [makeStorey({ id: 4 })],
      modelLengthUnit: null,
    })
    expect(after.modelLengthUnit).toBeNull()
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
    const after = workspacePageReducer(before, { type: 'riser-stack-added', stackRisers: stack, ts: TS })

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
    const after = workspacePageReducer(before, { type: 'riser-removed', riserId: 'auto-1', ts: TS })

    expect(after.risers.map((riser) => riser.id)).toEqual(['manual-1'])
    // The manually placed riser (separate stack) is untouched.
    expect(after.risers[0]).toBe(before.risers[2])
  })

  it('riser-removed with an unknown id bails out with the identical state object', () => {
    const before = makeLoadedState()
    expect(workspacePageReducer(before, { type: 'riser-removed', riserId: 'ghost', ts: TS })).toBe(before)
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

  it('risers-suggested replaces untouched auto stacks, keeps manual stacks, and lands on the risers tab', () => {
    // Before V3 this action replaced `state.risers` wholesale, discarding the
    // user's manual stack on every re-suggest (AGENTS.md rule violation).
    const before = makeLoadedState()
    const suggested = [makeRiser({ id: 'sug-1', stackId: 'stack-s', stackLabel: 'R3', source: 'detected' })]
    const after = workspacePageReducer(before, { type: 'risers-suggested', risers: suggested })

    expect(after.risers.map((riser) => riser.stackId)).toEqual(['stack-m', 'stack-s'])
    expect(after.risers.find((riser) => riser.stackId === 'stack-m')).toBe(before.risers[2])
    expect(after.isAddingRiser).toBe(false)
    expect(after.activeTab).toBe('risers')
  })

  it('risers-suggested preserves a dragged (moved) auto stack as an override', () => {
    const before = makeLoadedState()
    const moved = workspacePageReducer(before, {
      type: 'riser-move-committed',
      riserId: 'auto-1',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 4, y: 0, z: 4 },
      ts: TS,
    })
    const suggested = [makeRiser({ id: 'sug-1', stackId: 'stack-s', stackLabel: 'R3', source: 'detected' })]
    const after = workspacePageReducer(moved, { type: 'risers-suggested', risers: suggested })

    // stack-a was moved → preserved on both floors; stack-m manual → preserved; stack-s new → added.
    expect(after.risers.map((riser) => riser.id)).toEqual(['auto-1', 'auto-1b', 'manual-1', 'sug-1'])
  })

  it('risers-suggested drops the new auto stack of a core whose moved stack is preserved (wet-core path)', () => {
    const initial = makeLoadedState()
    // First suggest through the wet-core path: stack-a belongs to core-1.
    const first = workspacePageReducer(
      { ...initial, risers: [] },
      {
        type: 'risers-suggested',
        risers: [
          makeRiser({ id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 2, source: 'detected' }),
          makeRiser({ id: 'a-3', stackId: 'stack-a', stackLabel: 'R1', storeyId: 3, source: 'detected' }),
          makeRiser({ id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 2, source: 'detected' }),
        ],
        stackCoreIds: [
          { stackId: 'stack-a', coreId: 'core-1' },
          { stackId: 'stack-b', coreId: 'core-2' },
        ],
      },
    )
    expect(first.autoStackCoreIds).toEqual(new Map([['stack-a', 'core-1'], ['stack-b', 'core-2']]))

    const moved = workspacePageReducer(first, {
      type: 'riser-move-committed',
      riserId: 'a-2',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 4, y: 0, z: 4 },
      ts: TS,
    })
    // Re-suggest proposes both cores again with fresh stack ids.
    const second = workspacePageReducer(moved, {
      type: 'risers-suggested',
      risers: [
        makeRiser({ id: 'a2-2', stackId: 'stack-a2', stackLabel: 'R1', storeyId: 2, source: 'detected' }),
        makeRiser({ id: 'b2-2', stackId: 'stack-b2', stackLabel: 'R2', storeyId: 2, source: 'detected' }),
      ],
      stackCoreIds: [
        { stackId: 'stack-a2', coreId: 'core-1' },
        { stackId: 'stack-b2', coreId: 'core-2' },
      ],
      wetCore: {
        sourceStoreyId: 2,
        stacks: [
          { anchor: 'kitchen', stackId: 'stack-a2', stackLabel: 'R1', storeyId: 2, kitchenExpressId: 1, snap: null, position: { x: 0, y: 0, z: 0 } },
          { anchor: 'kitchen', stackId: 'stack-b2', stackLabel: 'R2', storeyId: 2, kitchenExpressId: 2, snap: null, position: { x: 0, y: 0, z: 0 } },
        ],
        cores: [],
        diagnostics: [],
      },
    })

    // The moved stack-a survives as core-1's only stack; core-2's old stack is replaced by stack-b2.
    expect(second.risers.map((riser) => riser.stackId)).toEqual(['stack-a', 'stack-a', 'stack-b2'])
    expect(second.autoStackCoreIds).toEqual(new Map([['stack-a', 'core-1'], ['stack-b2', 'core-2']]))
    expect(second.wetCoreSuggestion).toMatchObject({
      supersededCoreIds: ['core-1'],
      preservedStackIds: ['stack-a'],
    })
    expect(second.wetCoreSuggestion?.stacks.map((stack) => stack.stackId)).toEqual(['stack-b2'])
  })

  it('a removed auto stack is not an override: the next suggest may propose its core again', () => {
    const first = workspacePageReducer(
      { ...makeLoadedState(), risers: [] },
      {
        type: 'risers-suggested',
        risers: [makeRiser({ id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', source: 'detected' })],
        stackCoreIds: [{ stackId: 'stack-a', coreId: 'core-1' }],
      },
    )
    const removed = workspacePageReducer(first, { type: 'riser-removed', riserId: 'a-2', ts: TS })
    expect(removed.autoStackCoreIds.size).toBe(0)

    const second = workspacePageReducer(removed, {
      type: 'risers-suggested',
      risers: [makeRiser({ id: 'a2-2', stackId: 'stack-a2', stackLabel: 'R1', source: 'detected' })],
      stackCoreIds: [{ stackId: 'stack-a2', coreId: 'core-1' }],
    })
    expect(second.risers.map((riser) => riser.stackId)).toEqual(['stack-a2'])
  })

  it('selectPreservedRisersOnResuggest exposes the same preserved set to the page (label numbering)', () => {
    const before = makeLoadedState()
    expect(selectPreservedRisersOnResuggest(before).map((riser) => riser.id)).toEqual(['manual-1'])
    const moved = workspacePageReducer(before, {
      type: 'riser-move-committed',
      riserId: 'auto-1b',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 1 },
      ts: TS,
    })
    expect(selectPreservedRisersOnResuggest(moved).map((riser) => riser.id)).toEqual(['auto-1', 'auto-1b', 'manual-1'])
  })

  it('selectPreservedCoreIdsOnResuggest names the cores of moved auto stacks only (manual stacks have no core)', () => {
    const first = workspacePageReducer(
      { ...makeLoadedState(), risers: [] },
      {
        type: 'risers-suggested',
        risers: [
          makeRiser({ id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 2, source: 'detected' }),
          makeRiser({ id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 2, source: 'detected' }),
        ],
        stackCoreIds: [
          { stackId: 'stack-a', coreId: 'core-1' },
          { stackId: 'stack-b', coreId: 'core-2' },
        ],
      },
    )
    expect(selectPreservedCoreIdsOnResuggest(first)).toEqual(new Set())

    const withManual = workspacePageReducer(first, {
      type: 'riser-stack-added',
      stackRisers: [makeRiser({ id: 'm-2', stackId: 'stack-m', stackLabel: 'R3', storeyId: 2, source: 'manual' })],
      ts: TS,
    })
    const moved = workspacePageReducer(withManual, {
      type: 'riser-move-committed',
      riserId: 'b-2',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 4, y: 0, z: 4 },
      ts: TS,
    })
    expect(selectPreservedCoreIdsOnResuggest(moved)).toEqual(new Set(['core-2']))
  })

  it('suggest lifecycle: started → progress → suggested/cancelled/failed are explicit', () => {
    const base = makeLoadedState()
    const started = workspacePageReducer(base, { type: 'suggest-started' })
    expect(started.isSuggestingRisers).toBe(true)
    const progressed = workspacePageReducer(started, { type: 'suggest-progress', processed: 2, total: 5, storeyName: 'קומה 2' })
    expect(progressed.suggestProgress).toEqual({ processed: 2, total: 5, storeyName: 'קומה 2' })

    const cancelled = workspacePageReducer(progressed, { type: 'suggest-cancelled' })
    expect(cancelled.isSuggestingRisers).toBe(false)
    expect(cancelled.suggestProgress).toBeNull()
    expect(cancelled.risers).toBe(base.risers)

    const failed = workspacePageReducer(progressed, { type: 'suggest-failed', message: 'boom' })
    expect(failed.isSuggestingRisers).toBe(false)
    expect(failed.suggestError).toBe('boom')

    const done = workspacePageReducer(progressed, { type: 'risers-suggested', risers: [] })
    expect(done.isSuggestingRisers).toBe(false)
    expect(done.suggestProgress).toBeNull()
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

describe('workspacePageReducer engineer baseline (W7)', () => {
  const baseline = {
    sourceFileName: 'plumbing.ifc',
    systemPrefixes: ['SW-GRV', 'VNT'],
    network: { metersPerSourceUnit: 0.01, storeys: [], segments: [] },
    riserClassification: {
      sanitaryStacks: [],
      ventStacks: [],
      stubs: [],
      minStackExtentM: 2.5,
      minStackExtentSource: 'fallback-constant' as const,
      storeyPitchM: null,
    },
  }

  it('extraction lifecycle: started sets the flag, loaded stores the baseline, failed keeps the reason', () => {
    const base = makeLoadedState()

    const started = workspacePageReducer(base, { type: 'engineer-extraction-started' })
    expect(started.isExtractingEngineerBaseline).toBe(true)
    expect(started.engineerBaselineError).toBeNull()

    const loaded = workspacePageReducer(started, { type: 'engineer-baseline-loaded', baseline })
    expect(loaded.engineerBaseline).toBe(baseline)
    expect(loaded.isExtractingEngineerBaseline).toBe(false)

    const failed = workspacePageReducer(started, {
      type: 'engineer-extraction-failed',
      message: 'No systems matching SW-GRV / VNT found in any loaded file.',
    })
    expect(failed.engineerBaseline).toBeNull()
    expect(failed.isExtractingEngineerBaseline).toBe(false)
    expect(failed.engineerBaselineError).toMatch(/SW-GRV/)
  })

  it('engineer-overlay-toggled defaults absent storeys to visible and flips per storey', () => {
    const base = makeLoadedState()

    const hidden = workspacePageReducer(base, { type: 'engineer-overlay-toggled', storeyId: 2 })
    expect(hidden.engineerOverlayVisibleByStorey.get(2)).toBe(false)

    const shown = workspacePageReducer(hidden, { type: 'engineer-overlay-toggled', storeyId: 2 })
    expect(shown.engineerOverlayVisibleByStorey.get(2)).toBe(true)
    expect(shown.engineerOverlayVisibleByStorey.has(3)).toBe(false)
  })

  it('upload-reset clears the engineer baseline and its per-floor visibility', () => {
    const loaded = workspacePageReducer(makeLoadedState(), {
      type: 'engineer-baseline-loaded',
      baseline,
    })
    const toggled = workspacePageReducer(loaded, { type: 'engineer-overlay-toggled', storeyId: 2 })

    const reset = workspacePageReducer(toggled, { type: 'upload-reset' })
    expect(reset.engineerBaseline).toBeNull()
    expect(reset.isExtractingEngineerBaseline).toBe(false)
    expect(reset.engineerBaselineError).toBeNull()
    expect(reset.engineerOverlayVisibleByStorey.size).toBe(0)
  })
})

describe('workspacePageReducer continuity map (W5)', () => {
  const continuityMap = {
    sourceFileName: 'architecture.ifc',
    map: { units: 'm' as const, cellSize: 0.25, grids: [], shaftCandidates: [], diagnostics: [] },
    diagnostics: ['note'],
    extractMs: 640,
    buildMs: 30,
    processedStoreyCount: 13,
  }

  it('build lifecycle: started sets the flag, progress updates, loaded stores the map, failed keeps the reason', () => {
    const base = makeLoadedState()

    const started = workspacePageReducer(base, { type: 'continuity-build-started' })
    expect(started.isBuildingContinuityMap).toBe(true)
    expect(started.continuityBuildError).toBeNull()
    expect(started.continuityBuildProgress).toBeNull()

    const progressed = workspacePageReducer(started, {
      type: 'continuity-build-progress',
      processed: 4,
      total: 13,
    })
    expect(progressed.continuityBuildProgress).toEqual({ processed: 4, total: 13 })

    const loaded = workspacePageReducer(progressed, { type: 'continuity-map-loaded', continuityMap })
    expect(loaded.continuityMap).toBe(continuityMap)
    expect(loaded.isBuildingContinuityMap).toBe(false)
    expect(loaded.continuityBuildProgress).toBeNull()

    const failed = workspacePageReducer(progressed, {
      type: 'continuity-build-failed',
      message: 'No walls found in any loaded file.',
    })
    expect(failed.continuityMap).toBeNull()
    expect(failed.isBuildingContinuityMap).toBe(false)
    expect(failed.continuityBuildProgress).toBeNull()
    expect(failed.continuityBuildError).toMatch(/No walls/)
  })

  it('continuity-overlay-toggled defaults absent storeys to visible and flips per storey', () => {
    const base = makeLoadedState()

    const hidden = workspacePageReducer(base, { type: 'continuity-overlay-toggled', storeyId: 2 })
    expect(hidden.continuityOverlayVisibleByStorey.get(2)).toBe(false)

    const shown = workspacePageReducer(hidden, { type: 'continuity-overlay-toggled', storeyId: 2 })
    expect(shown.continuityOverlayVisibleByStorey.get(2)).toBe(true)
    expect(shown.continuityOverlayVisibleByStorey.has(3)).toBe(false)
  })

  it('continuity-snap-toggled flips the flag', () => {
    const base = makeLoadedState()
    expect(base.continuitySnapEnabled).toBe(false)

    const on = workspacePageReducer(base, { type: 'continuity-snap-toggled' })
    expect(on.continuitySnapEnabled).toBe(true)
    const off = workspacePageReducer(on, { type: 'continuity-snap-toggled' })
    expect(off.continuitySnapEnabled).toBe(false)
  })

  it('risers-suggested records snap outcomes when present and clears them when omitted', () => {
    const base = makeLoadedState()
    const suggested = [makeRiser({ id: 'sug-1', stackId: 'stack-s', stackLabel: 'R1', source: 'detected' })]
    const outcomes = [
      { stackLabel: 'R1', snap: { status: 'snapMiss' as const, reason: 'no free cell within 1.5 m' } },
    ]

    const withOutcomes = workspacePageReducer(base, {
      type: 'risers-suggested',
      risers: suggested,
      snapOutcomes: outcomes,
    })
    expect(withOutcomes.riserSnapOutcomes).toBe(outcomes)

    const withoutOutcomes = workspacePageReducer(withOutcomes, {
      type: 'risers-suggested',
      risers: suggested,
    })
    expect(withoutOutcomes.riserSnapOutcomes).toBeNull()
  })

  it('upload-reset clears the continuity map, snap outcomes and wet-core state, and resets the snap flag to its mode default', () => {
    const base = makeLoadedState()
    const loaded = workspacePageReducer(base, { type: 'continuity-map-loaded', continuityMap })
    const toggled = workspacePageReducer(loaded, { type: 'continuity-overlay-toggled', storeyId: 2 })
    const snapOff = workspacePageReducer({ ...toggled, continuitySnapEnabled: true }, { type: 'continuity-snap-toggled' })
    expect(snapOff.continuitySnapEnabled).toBe(false)
    const suggested = workspacePageReducer(snapOff, {
      type: 'risers-suggested',
      risers: [],
      snapOutcomes: [],
      stackExtents: [],
      wetCore: { sourceStoreyId: 2, stacks: [], cores: [], diagnostics: [] },
    })
    expect(suggested.wetCoreSuggestion).not.toBeNull()
    expect(suggested.riserStackExtents).toEqual([])

    const reset = workspacePageReducer(suggested, { type: 'upload-reset' })
    expect(reset.continuityMap).toBeNull()
    expect(reset.isBuildingContinuityMap).toBe(false)
    expect(reset.continuityBuildProgress).toBeNull()
    expect(reset.continuityBuildError).toBeNull()
    expect(reset.continuityOverlayVisibleByStorey.size).toBe(0)
    // Plain mode: snapping is ON by default (V3); demo mode keeps it OFF.
    expect(reset.continuitySnapEnabled).toBe(true)
    expect(reset.riserSnapOutcomes).toBeNull()
    expect(reset.wetCoreSuggestion).toBeNull()
    expect(reset.riserStackExtents).toBeNull()
    expect(reset.autoStackCoreIds.size).toBe(0)

    const demoReset = workspacePageReducer(
      { ...suggested, demoRuntime: { enabled: true, config: {} as never } },
      { type: 'upload-reset' },
    )
    expect(demoReset.continuitySnapEnabled).toBe(false)
  })

  it('defaultContinuitySnapEnabled is ON in plain mode and OFF in demo mode', () => {
    expect(defaultContinuitySnapEnabled({ enabled: false })).toBe(true)
    expect(defaultContinuitySnapEnabled({ enabled: true, config: {} as never })).toBe(false)
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

describe('workspacePageReducer adjust log (W6)', () => {
  it('starts as an empty metre-unit log', () => {
    const state = createInitialWorkspacePageState()
    expect(state.adjustLog).toEqual({ units: 'm', entries: [] })
  })

  it('riser-stack-added appends one add entry anchored to the floor it was placed on', () => {
    const before = makeLoadedState()
    const stack = [
      makeRiser({ id: 'new-1', stackId: 'stack-n', storeyId: 2, source: 'manual', position: { x: 4, y: 0, z: 5 } }),
      makeRiser({ id: 'new-2', stackId: 'stack-n', storeyId: 3, source: 'manual', position: { x: 4, y: 3, z: 5 } }),
    ]
    const after = workspacePageReducer(before, { type: 'riser-stack-added', stackRisers: stack, ts: TS })

    // One entry per stack (not per floor), keyed to selectedStoreyId = 2.
    expect(after.adjustLog.entries).toEqual([
      {
        action: 'add',
        stackId: 'stack-n',
        storey: 2,
        from: { x: 4, y: 5 },
        to: { x: 4, y: 5 },
        ts: TS,
      },
    ])
  })

  it('riser-removed appends one remove entry with a null destination', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, { type: 'riser-removed', riserId: 'manual-1', ts: TS })

    expect(after.adjustLog.entries).toEqual([
      {
        action: 'remove',
        stackId: 'stack-m',
        storey: 2,
        from: { x: 0, y: 0 },
        to: null,
        ts: TS,
      },
    ])
  })

  it('riser-moved (continuous drag updates) never appends to the log', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, {
      type: 'riser-moved',
      riserId: 'auto-1',
      position: { x: 7, y: 0, z: 8 },
    })
    expect(after.adjustLog).toBe(before.adjustLog)
    expect(after.adjustLog.entries).toHaveLength(0)
  })

  it('riser-move-committed appends one move entry with the given from/to and leaves risers untouched', () => {
    const before = makeLoadedState()
    const after = workspacePageReducer(before, {
      type: 'riser-move-committed',
      riserId: 'auto-1',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 7, y: 0, z: 8 },
      ts: TS,
    })

    expect(after.risers).toBe(before.risers)
    expect(after.adjustLog.entries).toEqual([
      {
        action: 'move',
        stackId: 'stack-a',
        storey: 2,
        from: { x: 0, y: 0 },
        to: { x: 7, y: 8 },
        ts: TS,
      },
    ])
  })

  it('riser-move-committed with an unknown id bails out with the identical state object', () => {
    const before = makeLoadedState()
    const action = {
      type: 'riser-move-committed',
      riserId: 'ghost',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 1, y: 0, z: 1 },
      ts: TS,
    } as const
    expect(workspacePageReducer(before, action)).toBe(before)
  })

  it('accumulates entries in dispatch order across actions', () => {
    let state = makeLoadedState()
    state = workspacePageReducer(state, {
      type: 'riser-move-committed',
      riserId: 'auto-1',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 2, y: 0, z: 2 },
      ts: '2026-09-01T12:00:01.000Z',
    })
    state = workspacePageReducer(state, { type: 'riser-removed', riserId: 'manual-1', ts: '2026-09-01T12:00:02.000Z' })

    expect(state.adjustLog.entries.map((entry) => [entry.action, entry.ts])).toEqual([
      ['move', '2026-09-01T12:00:01.000Z'],
      ['remove', '2026-09-01T12:00:02.000Z'],
    ])
  })

  it('re-suggest (risers-suggested) does not append: only manual adjustments are logged', () => {
    const before = makeLoadedState()
    const suggested = [makeRiser({ id: 'sug-1', stackId: 'stack-s', source: 'placed' })]
    const after = workspacePageReducer(before, { type: 'risers-suggested', risers: suggested })
    expect(after.adjustLog).toBe(before.adjustLog)
  })

  it('upload-reset (model replace) starts a fresh empty log', () => {
    const withEntry = workspacePageReducer(makeLoadedState(), {
      type: 'riser-removed',
      riserId: 'manual-1',
      ts: TS,
    })
    expect(withEntry.adjustLog.entries).toHaveLength(1)

    const reset = workspacePageReducer(withEntry, { type: 'upload-reset' })
    expect(reset.adjustLog.entries).toEqual([])
    expect(reset.adjustLog.units).toBe('m')
  })
})

describe('workspacePageReducer model origin (W1 local frame)', () => {
  const farDecision = {
    origin: { x: 181_441, y: 0, z: -664_624 },
    detectedBy: 'site-placement',
  } as const

  it('model-origin-resolved stores the decision once per model', () => {
    const base = makeLoadedState()
    expect(base.modelOrigin).toBeNull()

    const resolved = workspacePageReducer(base, { type: 'model-origin-resolved', decision: farDecision })
    expect(resolved.modelOrigin).toEqual(farDecision)
  })

  it('ignores a second resolution so the frame can never drift mid-session', () => {
    const resolved = workspacePageReducer(makeLoadedState(), {
      type: 'model-origin-resolved',
      decision: farDecision,
    })
    const repeat = workspacePageReducer(resolved, {
      type: 'model-origin-resolved',
      decision: { origin: { x: 1, y: 0, z: 1 }, detectedBy: 'storey-geometry' },
    })

    expect(repeat).toBe(resolved)
    expect(repeat.modelOrigin).toEqual(farDecision)
  })

  it('upload-reset clears the origin so the next model resolves its own frame', () => {
    const resolved = workspacePageReducer(makeLoadedState(), {
      type: 'model-origin-resolved',
      decision: farDecision,
    })
    const reset = workspacePageReducer(resolved, { type: 'upload-reset' })
    expect(reset.modelOrigin).toBeNull()
  })

  it('floor-opened keeps the origin: it is per model, not per floor', () => {
    const resolved = workspacePageReducer(makeLoadedState(), {
      type: 'model-origin-resolved',
      decision: farDecision,
    })
    const nextFloor = workspacePageReducer(resolved, { type: 'floor-opened', storeyId: 3, hasRisers: true })
    expect(nextFloor.modelOrigin).toEqual(farDecision)
  })
})
