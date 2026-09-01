import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { MergedStoreyDetection } from '@/domain/mergeFixturesAcrossFiles'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import {
  initialWorkspacePageState,
  workspacePageReducer,
  type LinkedModelState,
  type StoreyUnderlayState,
  type WorkspacePageState,
} from './workspacePageState'

const linkedModel: LinkedModelState = {
  fileName: 'arch.ifc',
  webIfcModelId: 7,
  lengthUnit: 'cm',
  storeyCount: 13,
  hasWalls: true,
}

const alignment: StoreyAlignment = {
  hostFileName: 'host.ifc',
  linkedFileName: 'arch.ifc',
  status: 'aligned',
  blockedReason: null,
  toleranceMm: 150,
  pairs: [
    {
      host: { storeyId: 1, storeyName: 'GF', absoluteElevationM: 23.65 },
      linked: { storeyId: 10, storeyName: '00', absoluteElevationM: 23.65 },
      deltaMm: 0,
    },
  ],
  unmappedHost: [],
  unmappedLinked: [],
  originAgreement: { status: 'shared', distanceMm: 0, warning: null },
}

const mergeResult: MergedStoreyDetection = {
  fixtures: [],
  kitchens: [],
  duplicates: [],
  perFile: [
    {
      fileName: 'host.ifc',
      detectedFixtureCount: 0,
      mergedFixtureCount: 0,
      duplicateFixtureCount: 0,
      kitchenCount: 0,
    },
  ],
  dedupeToleranceMm: 120,
}

const underlay: StoreyUnderlayState = {
  meshes: { group: {}, boundingBox: {}, sourceBoundingBox: {} } as unknown as FloorMeshes & {
    group: THREE.Group
  },
  sourceFileName: 'arch.ifc',
}

function stateWithMultiModel(): WorkspacePageState {
  let state = workspacePageReducer(initialWorkspacePageState, {
    type: 'linked-models-loaded',
    linkedModels: [linkedModel],
    alignments: [alignment],
  })
  state = workspacePageReducer(state, { type: 'underlay-loaded', underlay })
  state = workspacePageReducer(state, {
    type: 'floor-fixtures-detected',
    fixtures: [],
    kitchens: [],
    hasRisers: false,
    crossFileMerge: mergeResult,
  })
  return state
}

describe('workspacePageReducer multi-model actions', () => {
  it('stores linked models and alignments together', () => {
    const state = workspacePageReducer(initialWorkspacePageState, {
      type: 'linked-models-loaded',
      linkedModels: [linkedModel],
      alignments: [alignment],
    })

    expect(state.linkedModels).toEqual([linkedModel])
    expect(state.storeyAlignments).toEqual([alignment])
  })

  it('underlay-loaded sets the underlay and clears a previous error', () => {
    let state = workspacePageReducer(initialWorkspacePageState, {
      type: 'underlay-failed',
      message: 'boom',
    })
    expect(state.underlayError).toBe('boom')

    state = workspacePageReducer(state, { type: 'underlay-loaded', underlay })
    expect(state.underlay).toBe(underlay)
    expect(state.underlayError).toBeNull()
  })

  it('floor-fixtures-detected without crossFileMerge keeps the single-file shape (null)', () => {
    const state = workspacePageReducer(initialWorkspacePageState, {
      type: 'floor-fixtures-detected',
      fixtures: [],
      kitchens: [],
      hasRisers: false,
    })

    expect(state.crossFileMerge).toBeNull()
  })

  it('floor-fixtures-detected stores the cross-file merge accounting', () => {
    const state = stateWithMultiModel()
    expect(state.crossFileMerge).toBe(mergeResult)
  })

  it('floor-opened clears per-floor underlay and merge state but keeps linked models', () => {
    const state = workspacePageReducer(stateWithMultiModel(), {
      type: 'floor-opened',
      storeyId: 2,
      hasRisers: false,
    })

    expect(state.underlay).toBeNull()
    expect(state.underlayError).toBeNull()
    expect(state.crossFileMerge).toBeNull()
    expect(state.linkedModels).toEqual([linkedModel])
    expect(state.storeyAlignments).toEqual([alignment])
  })

  it('upload-reset clears all multi-model state', () => {
    const state = workspacePageReducer(stateWithMultiModel(), { type: 'upload-reset' })

    expect(state.linkedModels).toEqual([])
    expect(state.storeyAlignments).toEqual([])
    expect(state.underlay).toBeNull()
    expect(state.underlayError).toBeNull()
    expect(state.crossFileMerge).toBeNull()
  })
})
