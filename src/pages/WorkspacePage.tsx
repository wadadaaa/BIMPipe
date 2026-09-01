import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, type MutableRefObject } from 'react'
import { IfcUpload } from '@/features/ifc-upload/IfcUpload'
import { StoreyList } from '@/features/storey-list/StoreyList'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { ViewTransition } from '@/shared/reactViewTransition'
import { ViewerPlaceholder } from '@/viewer/ViewerPlaceholder'
import { WorkspaceLayout } from '@/widgets/WorkspaceLayout'
import { TopBar } from '@/widgets/TopBar'
import type { ThemeMode } from '@/app/App'
import { getIfcApi } from '@/shared/ifc/ifcApi'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import type { LengthUnit } from '@/shared/lengthUnits'
import type { Fixture, KitchenArea, PlanBounds, Riser, RiserId, Storey, StoreyId, SidebarTab } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'
import {
  IDENTITY_MODEL_FRAME,
  isIdentityModelFrame,
  toLocalPoint,
  toSourcePoint,
  type ModelFrame,
} from '@/shared/frame/modelFrame'
import { serializeAdjustLog } from '@/domain/adjustLog'
import { createInitialWorkspacePageState, workspacePageReducer } from './workspacePageState'
import { buildRiserStack } from '@/shared/routes/buildRiserStacks'
import { classifyFloors } from '@/shared/routes/floorClassification'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from '@/shared/routes/riserPlacementProfile'
import { buildSuggestedRisers } from '@/shared/routes/buildSuggestedRisers'
import { buildRiserValidationReport } from '@/shared/routes/buildRiserValidationReport'
import { buildDemoModeUploadError, isStoreyIncludedInDemoScope } from '@/shared/demoConfig'
import { buildSanitaryRoutingDemoPlan, buildSanitaryRoutingPlan } from '@/shared/routes/buildSanitaryRoutes'
import { buildBranchRoutesFromAssignments } from '@/shared/routes/buildBranchRoutes'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'

let floorViewerModulePromise: Promise<typeof import('@/viewer/FloorViewer')> | null = null
let model3DViewerModulePromise: Promise<typeof import('@/viewer/Model3DViewer')> | null = null
let floorSelectionModulesPromise: Promise<
  [
    typeof import('@/shared/ifc/extractFloorMeshes'),
    typeof import('@/shared/ifc/detectFixtures'),
    typeof import('@/shared/ifc/detectKitchens'),
    typeof import('@/shared/ifc/resolveModelOrigin'),
  ]
> | null = null

function loadFloorViewerModule() {
  floorViewerModulePromise ??= import('@/viewer/FloorViewer')
  return floorViewerModulePromise
}

function loadModel3DViewerModule() {
  model3DViewerModulePromise ??= import('@/viewer/Model3DViewer')
  return model3DViewerModulePromise
}

function loadFloorSelectionModules() {
  floorSelectionModulesPromise ??= Promise.all([
    import('@/shared/ifc/extractFloorMeshes'),
    import('@/shared/ifc/detectFixtures'),
    import('@/shared/ifc/detectKitchens'),
    import('@/shared/ifc/resolveModelOrigin'),
  ])
  return floorSelectionModulesPromise
}

function preloadFloorInspectionModules() {
  void loadFloorViewerModule()
  void loadFloorSelectionModules()
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

interface WorkspacePageProps {
  theme: ThemeMode
  onToggleTheme: () => void
}

const FloorViewer = lazy(async () => {
  const mod = await loadFloorViewerModule()
  return { default: mod.FloorViewer }
})

const Model3DViewer = lazy(async () => {
  const mod = await loadModel3DViewerModule()
  return { default: mod.Model3DViewer }
})


export function WorkspacePage({
  theme = 'dark',
  onToggleTheme = () => {},
}: Partial<WorkspacePageProps>) {
  // All domain state lives in the colocated reducer module; this component only
  // renders, derives memoized values, and dispatches actions.
  const [state, dispatch] = useReducer(workspacePageReducer, undefined, createInitialWorkspacePageState)
  const {
    webIfcModelId,
    modelFileName,
    storeys,
    modelLengthUnit,
    isParsingStoreys,
    uploadError,
    demoUploadError,
    demoAssetError,
    demoRuntime,
    demoRuntimeConfigError,
    selectedStoreyId,
    floorMeshes,
    isExtractingGeometry,
    geometryError,
    modelOrigin,
    hoveredExpressId,
    selectedExpressId,
    fixtures,
    kitchens,
    isDetectingFixtures,
    risers,
    isAddingRiser,
    adjustLog,
    downloadMode,
    downloadError,
    activeTab,
    viewMode,
    branchRoutesVisibleByStorey,
  } = state

  // Imperative viewer/export plumbing that intentionally stays outside the
  // reducer: web-ifc handles, raw source bytes, the riser label counter, and
  // detection debug output that is only read (never rendered reactively).
  const webIfcModelIdRef = useRef<number | null>(null)
  const sourceIfcBytesRef = useRef<Uint8Array | null>(null)
  const nextRiserLabelRef = useRef(1)
  const detectionDebugRef = useRef<Awaited<ReturnType<typeof aggregateStoreyDetections>> | null>(null)
  // Local-frame origin for rendering, mirrored from state so the async openStorey
  // flow can read the resolved frame across awaits. null = not resolved yet for
  // the current model (resolution happens on the first storey with geometry).
  const modelFrameRef = useRef<ModelFrame | null>(null)
  // Declared length unit mirrored from state for the same reason: openStorey
  // runs before the storeys-parsed transition flushes, so it reads the ref.
  const modelLengthUnitRef = useRef<LengthUnit | null>(null)

  // Rendering frame derived from the reducer state. Identity for near-origin
  // models, so localization below is a no-op that preserves array identities.
  const modelFrame = useMemo<ModelFrame>(
    () => (modelOrigin ? { origin: modelOrigin.origin } : IDENTITY_MODEL_FRAME),
    [modelOrigin],
  )

  // ---------------------------------------------------------------------------

  // Async handlers (handleFileAccepted, openStorey) need to read the latest
  // riser count to decide which sidebar phase to land on, but their closure
  // captures a snapshot from the render that defined them. A ref keeps the
  // current value visible across awaits and after queued state updates.
  const risersRef = useRef(risers)
  useEffect(() => {
    risersRef.current = risers
  }, [risers])

  useEffect(() => {
    const normalized = ensureRiserStackLabels(risers, nextRiserLabelRef)
    if (normalized !== risers) {
      dispatch({ type: 'risers-normalized', risers: normalized })
      return
    }

    nextRiserLabelRef.current = getNextRiserLabelNumber(risers)
  }, [risers])

  async function handleFileAccepted(file: File) {
    const uploadDemoError = buildDemoModeUploadError(file.name, demoRuntime)
    if (uploadDemoError) {
      dispatch({ type: 'demo-upload-rejected', message: uploadDemoError })
      return
    }
    sourceIfcBytesRef.current = null
    nextRiserLabelRef.current = 1
    // Sync the refs alongside the state update so openStorey sees the cleared
    // count and unresolved frame when it runs after this transition is queued.
    risersRef.current = []
    modelFrameRef.current = null
    modelLengthUnitRef.current = null
    dispatch({ type: 'upload-started', fileName: file.name })
    startTransition(() => {
      dispatch({ type: 'upload-reset' })
    })

    try {
      const [api, buffer] = await Promise.all([
        getIfcApi(),
        file.arrayBuffer(),
      ])

      // Close any previously opened model
      if (webIfcModelIdRef.current !== null) {
        api.CloseModel(webIfcModelIdRef.current)
      }

      const data = new Uint8Array(buffer)
      sourceIfcBytesRef.current = data.slice()
      const newModelId = api.OpenModel(data)
      webIfcModelIdRef.current = newModelId
      dispatch({ type: 'model-opened', webIfcModelId: newModelId })

      const domainModelId = crypto.randomUUID()
      const parsed = await parseStoreys(api, newModelId, domainModelId)
      // Declared IFC length unit for raw attribute values (storey elevations).
      // null = undeclared/unsupported — the UI then shows raw values, no guessing.
      const modelLengthUnit = await resolveModelLengthUnit(api, newModelId)
      modelLengthUnitRef.current = modelLengthUnit
      startTransition(() => {
        dispatch({ type: 'storeys-parsed', storeys: parsed, modelLengthUnit })
      })
      preloadFloorInspectionModules()
      const defaultStoreyId = findDefaultStoreyId(parsed)
      if (defaultStoreyId !== null) {
        void openStorey(defaultStoreyId)
      }
    } catch (err) {
      dispatch({
        type: 'upload-failed',
        message: err instanceof Error ? err.message : 'Failed to parse IFC file.',
      })
    } finally {
      dispatch({ type: 'upload-parsing-finished' })
    }
  }

  async function openStorey(id: StoreyId) {
    const modelId = webIfcModelIdRef.current
    if (modelId === null) return

    // Keep the "opening floor" feedback urgent so the loader paints before IFC work begins.
    // Risers are NOT cleared — they span all floors and persist across selection.
    dispatch({ type: 'floor-opened', storeyId: id, hasRisers: risersRef.current.length > 0 })

    await waitForNextPaint()

    try {
      const [
        [{ extractFloorMeshes }, { detectFixtures }, { detectKitchens }, { resolveModelOriginDecision }],
        api,
      ] = await Promise.all([
        loadFloorSelectionModules(),
        getIfcApi(),
      ])

      const knownFrame = modelFrameRef.current
      let meshes =
        knownFrame !== null && !isIdentityModelFrame(knownFrame)
          ? await extractFloorMeshes(api, modelId, id, knownFrame)
          : await extractFloorMeshes(api, modelId, id)

      if (knownFrame === null) {
        // First storey with geometry decides the model origin (once per model).
        // Null decision = no usable bounds on this floor; retry on the next one.
        // The declared unit (when known) replaces the placement probe's
        // magnitude heuristic for the far-from-origin verdict.
        const decision = await resolveModelOriginDecision(
          api,
          modelId,
          readSourcePlanBounds(meshes),
          modelLengthUnitRef.current,
        )
        if (decision !== null) {
          const frame: ModelFrame = { origin: decision.origin }
          modelFrameRef.current = frame
          dispatch({ type: 'model-origin-resolved', decision })
          if (!isIdentityModelFrame(frame)) {
            // Re-extract so the Float32 geometry is baked in the local frame.
            meshes = await extractFloorMeshes(api, modelId, id, frame)
          }
        }
      }

      startTransition(() => {
        dispatch({ type: 'floor-geometry-loaded', floorMeshes: meshes })
      })

      try {
        const [detectedFixtures, detectedKitchens] = await Promise.allSettled([
          detectFixtures(api, modelId, id),
          detectKitchens(api, modelId, id),
        ])

        const fixturesResult =
          detectedFixtures.status === 'fulfilled' ? detectedFixtures.value : []
        const kitchensResult =
          detectedKitchens.status === 'fulfilled' ? detectedKitchens.value : []

        startTransition(() => {
          dispatch({
            type: 'floor-fixtures-detected',
            fixtures: fixturesResult,
            kitchens: kitchensResult,
            hasRisers: risersRef.current.length > 0,
          })
        })
      } catch {
        // Detection failure is non-fatal — floor plan stays visible, fixtures stay empty.
      } finally {
        startTransition(() => dispatch({ type: 'fixture-detection-finished' }))
      }
    } catch (err) {
      startTransition(() => {
        dispatch({
          type: 'floor-open-failed',
          message: err instanceof Error ? err.message : 'Failed to extract floor geometry.',
        })
      })
    }
  }

  async function handleStoreySelect(id: StoreyId) {
    await openStorey(id)
  }

  // Stable callback identities: these replace setState functions that were
  // previously passed straight as props (FloorViewer re-runs effects when
  // onObjectHover/onObjectSelect change identity), so they must not churn.
  const handleObjectHover = useCallback((expressId: number | null) => {
    dispatch({ type: 'object-hovered', expressId })
  }, [])

  const handleObjectSelect = useCallback((expressId: number | null) => {
    dispatch({ type: 'object-selected', expressId })
  }, [])

  const handleTabChange = useCallback((tab: SidebarTab) => {
    dispatch({ type: 'active-tab-set', tab })
  }, [])

  // --- riser handlers ---
  // The viewer works in the local frame, so click/drag positions arrive local
  // and are converted back to source coordinates (local + origin) before they
  // touch domain state. Export therefore keeps writing source coordinates.

  function handleAddRiser(localPos: { x: number; y: number; z: number }) {
    if (!selectedStoreyId) return
    const pos = toSourcePoint(modelFrame, localPos)
    startTransition(() =>
      dispatch({
        type: 'riser-stack-added',
        stackRisers: buildRiserStack(storeys, selectedStoreyId, pos, takeNextRiserLabel(nextRiserLabelRef), 'manual'),
        ts: new Date().toISOString(),
      }),
    )
  }

  function handleRemoveRiser(id: RiserId) {
    // Deleting a riser removes the whole vertical stack across all floors immediately.
    dispatch({ type: 'riser-removed', riserId: id, ts: new Date().toISOString() })
  }

  function handleMoveRiser(id: RiserId, localPos: { x: number; y: number; z: number }) {
    // Propagate X/Z to every floor in the same stack; preserve each floor's Y.
    dispatch({ type: 'riser-moved', riserId: id, position: toSourcePoint(modelFrame, localPos) })
  }

  function handleMoveRiserCommit(
    id: RiserId,
    localFrom: { x: number; y: number; z: number },
    localTo: { x: number; y: number; z: number },
  ) {
    // Adjust-log entries are recorded in SOURCE coordinates (local + origin),
    // the same frame riser positions are stored and exported in.
    dispatch({
      type: 'riser-move-committed',
      riserId: id,
      from: toSourcePoint(modelFrame, localFrom),
      to: toSourcePoint(modelFrame, localTo),
      ts: new Date().toISOString(),
    })
  }

  function handleToggleAddRiser() {
    startTransition(() => {
      dispatch({ type: 'add-riser-toggled' })
    })
  }

  function handleToggleBranchRoutes() {
    if (selectedStoreyId === null) return
    dispatch({ type: 'branch-routes-toggled', storeyId: selectedStoreyId })
  }

  function handleSuggestRisers() {
    if (!selectedStoreyId || (fixtures.length === 0 && kitchens.length === 0)) return

    if (demoRuntime.enabled) {
      const scopedStoreyIds = new Set(
        storeys.filter((storey) => isStoreyIncludedInDemoScope(storey.name, demoRuntime.config)).map((storey) => storey.id),
      )
      const excludedFixtureCount = fixtures.filter((fixture) => !scopedStoreyIds.has(fixture.storeyId)).length
      const excludedKitchenCount = kitchens.filter((kitchen) => !scopedStoreyIds.has(kitchen.storeyId)).length
      if (excludedFixtureCount > 0 || excludedKitchenCount > 0) {
        dispatch({
          type: 'demo-asset-error-set',
          message: `Demo scope excluded ${excludedFixtureCount} fixture(s) and ${excludedKitchenCount} kitchen area(s) outside included floors.`,
        })
      } else {
        dispatch({ type: 'demo-asset-error-set', message: null })
      }
    } else {
      dispatch({ type: 'demo-asset-error-set', message: null })
    }

    const modelId = webIfcModelIdRef.current
    if (modelId !== null) {
      void getIfcApi()
        .then((api) => {
          const profile = DEFAULT_RISER_PLACEMENT_RULE_PROFILE
          return aggregateStoreyDetections(api, modelId, storeys, profile)
        })
        .then((result) => {
          detectionDebugRef.current = result
        })
        .catch(() => {
          // Keep suggest flow non-fatal even when full-building detection aggregation fails.
        })
    }
    startTransition(() => {
      nextRiserLabelRef.current = 1
      dispatch({
        type: 'risers-suggested',
        risers: buildSuggestedRisers(
          storeys,
          selectedStoreyId,
          fixtures,
          kitchens,
          // Suggestion mixes plan bounds with source-frame fixture positions,
          // so it must see the source-frame bounding box, not the local one.
          floorMeshes ? { ...floorMeshes, boundingBox: pickSourceBoundingBox(floorMeshes) } : null,
          () => takeNextRiserLabel(nextRiserLabelRef),
          demoRuntime,
        ),
      })
    })
  }

  async function handleDownloadIfc() {
    if (
      sourceIfcBytesRef.current === null ||
      selectedStoreyId === null ||
      modelFileName === null ||
      risers.length === 0
    ) {
      return
    }

    dispatch({ type: 'download-started' })

    try {
      const api = await getIfcApi()
      const exportRunId = createExportRunId()
      const timestamp = new Date().toISOString()
      const { exportFullIfcWithRisersWithDebug } = await import('@/shared/ifc/exportFullIfcWithRisers')
      const fullExport = await exportFullIfcWithRisersWithDebug(
        api,
        sourceIfcBytesRef.current,
        selectedStoreyId,
        risers,
        floorMeshes ? readSourcePlanBounds(floorMeshes) : null,
        {
          exportRunId,
          timestamp,
          sourceIfcName: modelFileName,
          storeys: storeys.map((storey) => ({
            id: storey.id,
            name: storey.name,
            elevation: storey.elevation,
          })),
        },
        sanitaryRoutesForExport,
      )

      downloadBinary(
        fullExport.ifcBytes,
        buildExportFileName(modelFileName, selectedStorey?.name ?? null),
      )
      const floorClassification = classifyFloors(storeys)
      downloadJson(
        {
          ...fullExport.debugMapping,
          placementRuleProfile: DEFAULT_RISER_PLACEMENT_RULE_PROFILE,
          floorClassification,
          validationReport: buildRiserValidationReport({
            exportRunId,
            timestamp,
            sourceIfcName: modelFileName,
            storeys,
            floorClassifications: floorClassification,
            detectionAggregation: detectionDebugRef.current,
            risers,
          }),
          sanitaryRouteDebugGroups: sanitaryRoutingPreview.debugGroups,
          sanitaryRouteLimitations: sanitaryRoutingPreview.limitations,
        },
        buildExportDebugFileName(modelFileName, selectedStorey?.name ?? null),
      )
      if (adjustLog.entries.length > 0) {
        // Manual adjustments travel with the IFC as a JSON artifact so the
        // engineer's decisions survive outside the session.
        downloadBinary(
          serializeAdjustLog(adjustLog),
          buildAdjustmentsFileName(modelFileName),
          'application/json',
        )
      }
    } catch (err) {
      dispatch({
        type: 'download-failed',
        message: err instanceof Error ? err.message : 'Failed to generate the IFC.',
      })
    } finally {
      dispatch({ type: 'download-finished' })
    }
  }

  // ---------------------------------------------------------------------------


  // Fixture-to-riser assignment for the active floor (toilets anchor risers,
  // everything else attaches to the nearest in-range riser). Only computed once
  // risers exist on the floor — before placement the panel shows detection state
  // without misleading "unassigned" flags.
  const fixtureAssignments = useMemo(() => {
    if (selectedStoreyId === null) return []
    if (!risers.some((riser) => riser.storeyId === selectedStoreyId)) return []
    return assignFixturesToRisers(fixtures, risers)
  }, [fixtures, risers, selectedStoreyId])

  // Branch routes (T3): pure derivation from the T2 assignments above. The
  // adapter drops unassigned entries — those stay visible in the fixtures panel
  // with an explicit reason and have no riser to route toward.
  const branchRouteFloors = useMemo(
    () => buildBranchRoutesFromAssignments(fixtureAssignments),
    [fixtureAssignments],
  )

  const sanitaryRoutingPreview = useMemo(() => {
    if (selectedStoreyId === null) return { routes: [], limitations: [], debugGroups: [] }
    const floorFixtures = fixtures.filter((fixture) => fixture.storeyId === selectedStoreyId)
    const floorRisers = risers.filter((riser) => riser.storeyId === selectedStoreyId)
    if (demoRuntime.enabled) {
      return buildSanitaryRoutingDemoPlan(floorFixtures, floorRisers, demoRuntime.config)
    }
    return buildSanitaryRoutingPlan(floorFixtures, floorRisers, modelFileName)
  }, [demoRuntime, fixtures, modelFileName, risers, selectedStoreyId])

  // Export the same selected-floor route plan currently shown in the viewer. Download IFC is scoped
  // to the active included demo floor (`selectedStoreyId`); `buildSanitaryRoutingDemoPlan` can still
  // duplicate that floor's routes across same-stack demo risers when the plan requires it. Do not
  // recompute a separate all-demo-floor export plan here: duplicate/independent planning can drift
  // from the preview and hide missing routes in the downloaded IFC/debug JSON.
  const sanitaryRoutesForExport = sanitaryRoutingPreview.routes

  const selectedStorey = storeys.find((storey) => storey.id === selectedStoreyId) ?? null
  const demoFloorOpened =
    demoRuntime.enabled && selectedStorey !== null
      ? isStoreyIncludedInDemoScope(selectedStorey.name, demoRuntime.config)
      : false
  const shouldLoadViewer =
    isExtractingGeometry || geometryError !== null || floorMeshes !== null

  // Risers for the currently-viewed floor only (panel display, source frame).
  // The full `risers` array spans all floors and is used for export.
  const currentFloorRisers =
    selectedStoreyId !== null
      ? risers.filter((r) => r.storeyId === selectedStoreyId)
      : []
  const sidebarRisers = isExtractingGeometry ? [] : currentFloorRisers

  // --- viewer boundary: convert to the local rendering frame ---
  // Everything the viewers consume gets the model origin subtracted; domain
  // state stays in source coordinates. With the identity frame these helpers
  // return the original references, so near-origin models are untouched.
  const localViewerFixtures = useMemo(
    () => (isExtractingGeometry ? [] : localizeFixtures(fixtures, modelFrame)),
    [isExtractingGeometry, fixtures, modelFrame],
  )
  const localViewerKitchens = useMemo(
    () => (isExtractingGeometry ? [] : localizeKitchens(kitchens, modelFrame)),
    [isExtractingGeometry, kitchens, modelFrame],
  )
  const localViewerRisers = useMemo(() => {
    if (isExtractingGeometry || selectedStoreyId === null) return []
    return localizeRisers(
      risers.filter((riser) => riser.storeyId === selectedStoreyId),
      modelFrame,
    )
  }, [isExtractingGeometry, risers, selectedStoreyId, modelFrame])
  const localAllRisers = useMemo(() => localizeRisers(risers, modelFrame), [risers, modelFrame])
  const localSanitaryRoutes = useMemo(
    () => localizeSanitaryRoutes(sanitaryRoutingPreview.routes, modelFrame),
    [sanitaryRoutingPreview.routes, modelFrame],
  )
  const localViewerBranchRouteSegments = useMemo(() => {
    if (isExtractingGeometry || selectedStoreyId === null) return []
    const segments =
      branchRouteFloors.find((floor) => floor.storeyId === selectedStoreyId)?.segments ?? []
    return localizeBranchSegments(segments, modelFrame)
  }, [isExtractingGeometry, branchRouteFloors, selectedStoreyId, modelFrame])
  const localBranchRouteFloors = useMemo(
    () => localizeBranchRouteFloors(branchRouteFloors, modelFrame),
    [branchRouteFloors, modelFrame],
  )
  const branchRoutesVisibleOnSelectedFloor =
    selectedStoreyId === null || (branchRoutesVisibleByStorey.get(selectedStoreyId) ?? true)


  const validationReport =
    modelFileName === null
      ? null
      : buildRiserValidationReport({
          exportRunId: 'workspace-preview',
          timestamp: new Date(0).toISOString(),
          sourceIfcName: modelFileName,
          storeys,
          detectionAggregation: detectionDebugRef.current,
          risers,
        })

  const currentStep: 1 | 2 | 3 | 4 = !modelFileName
    ? 1
    : selectedStoreyId === null
      ? 2
      : currentFloorRisers.length === 0
        ? 3
        : 4

  const viewerFallback = (
    <ViewerPlaceholder
      modelFileName={modelFileName}
      selectedStoreyName={selectedStorey?.name ?? null}
      isViewerLoading={shouldLoadViewer}
      error={geometryError}
      storeyCount={storeys.length}
    />
  )

  const leftPanel = (
    <>
      <IfcUpload
        onFileAccepted={handleFileAccepted}
        isLoading={isParsingStoreys}
        error={uploadError ?? demoUploadError ?? demoRuntimeConfigError}
        fileName={modelFileName}
        storeyCount={storeys.length}
        // Demo mode only accepts the configured demo model, so the bundled
        // sample would always be rejected — hide the affordance instead.
        showSampleModel={!demoRuntime.enabled}
      />
      {demoAssetError ? (
        <p style={{ marginTop: 8, color: 'var(--color-warning, #f59e0b)', fontSize: 13 }} role="status">
          {demoAssetError}
        </p>
      ) : null}
      <StoreyList
        storeys={storeys}
        selectedId={selectedStoreyId}
        isLoading={isExtractingGeometry}
        onSelect={handleStoreySelect}
        modelLengthUnit={modelLengthUnit}
      />
    </>
  )

  function handleSwitch3D() {
    void loadModel3DViewerModule()
    dispatch({ type: 'view-mode-set', viewMode: '3d' })
  }

  const centerPanel = viewMode === '3d' && webIfcModelId !== null ? (
    <Suspense fallback={viewerFallback}>
      <Model3DViewer
        webIfcModelId={webIfcModelId}
        storeys={storeys}
        risers={localAllRisers}
        theme={theme}
        onSwitch2D={() => dispatch({ type: 'view-mode-set', viewMode: '2d' })}
        branchRouteFloors={localBranchRouteFloors}
        branchRouteVisibility={branchRoutesVisibleByStorey}
        modelFrame={modelFrame}
      />
    </Suspense>
  ) : shouldLoadViewer ? (
    <Suspense
      fallback={
        <ViewTransition exit="slide-down" default="none">
          {viewerFallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="slide-up" default="none">
        <FloorViewer
          floorMeshes={floorMeshes}
          isLoading={isExtractingGeometry}
          error={geometryError}
          theme={theme}
          onObjectHover={handleObjectHover}
          onObjectSelect={handleObjectSelect}
          modelFileName={modelFileName}
          selectedStoreyElevation={selectedStorey?.elevation ?? null}
          modelLengthUnit={modelLengthUnit}
          storeyCount={storeys.length}
          hoveredExpressId={hoveredExpressId}
          selectedExpressId={selectedExpressId}
          fixtures={localViewerFixtures}
          kitchens={localViewerKitchens}
          risers={localViewerRisers}
          isAddingRiser={isAddingRiser}
          onRiserAdd={handleAddRiser}
          onRiserMove={handleMoveRiser}
          onRiserMoveCommit={handleMoveRiserCommit}
          onSwitch3D={storeys.length > 0 ? handleSwitch3D : undefined}
          sanitaryRoutes={localSanitaryRoutes}
          demoFlowEnabled={demoRuntime.enabled}
          branchRouteSegments={localViewerBranchRouteSegments}
          branchRoutesVisible={branchRoutesVisibleOnSelectedFloor}
          onToggleBranchRoutes={handleToggleBranchRoutes}
        />
      </ViewTransition>
    </Suspense>
  ) : (
    viewerFallback
  )

  const rightPanel = (
    <Sidebar
      activeTab={activeTab}
      onTabChange={handleTabChange}
      selectedStoreyName={selectedStorey?.name ?? null}
      storeyCount={storeys.length}
      hasModel={modelFileName !== null}
      fixtures={fixtures}
      kitchens={kitchens}
      fixtureAssignments={fixtureAssignments}
      isDetectingFixtures={isDetectingFixtures}
      risers={sidebarRisers}
      isAddingRiser={isAddingRiser}
      onToggleAddRiser={handleToggleAddRiser}
      onSuggestRisers={handleSuggestRisers}
      onRemoveRiser={handleRemoveRiser}
      canDownloadIfc={risers.length > 0}
      downloadMode={downloadMode}
      downloadError={downloadError}
      onDownloadFullIfc={() => void handleDownloadIfc()}
      validationReport={validationReport}
      detectionAggregation={detectionDebugRef.current}
      sanitaryRouteLimitations={sanitaryRoutingPreview.limitations}
      demoFlowEnabled={demoRuntime.enabled}
      demoFloorOpened={demoFloorOpened}
      sanitaryRouteCount={sanitaryRoutesForExport.length}
      modelLengthUnit={modelLengthUnit}
    />
  )

  return (
    <WorkspaceLayout
      header={
        <TopBar
          modelFileName={modelFileName}
          currentStep={currentStep}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
      }
      leftPanel={leftPanel}
      centerPanel={centerPanel}
      rightPanel={rightPanel}
    />
  )
}

function takeNextRiserLabel(nextRiserLabelRef: MutableRefObject<number>): string {
  const label = `R${nextRiserLabelRef.current}`
  nextRiserLabelRef.current += 1
  return label
}

function getNextRiserLabelNumber(risers: Riser[]): number {
  let next = 1

  for (const riser of risers) {
    const match = /^R(\d+)$/.exec(riser.stackLabel ?? '')
    if (!match) continue
    next = Math.max(next, Number(match[1]) + 1)
  }

  return next
}

function ensureRiserStackLabels(
  risers: Riser[],
  nextRiserLabelRef: MutableRefObject<number>,
): Riser[] {
  if (risers.length === 0) {
    nextRiserLabelRef.current = 1
    return risers
  }

  const stackLabelById = new Map<string, string>()
  let nextLabelNumber = 1

  for (const riser of risers) {
    if (!riser.stackLabel) continue
    stackLabelById.set(riser.stackId, riser.stackLabel)
    const match = /^R(\d+)$/.exec(riser.stackLabel)
    if (match) nextLabelNumber = Math.max(nextLabelNumber, Number(match[1]) + 1)
  }

  let changed = false
  const normalized = risers.map((riser) => {
    const existingLabel = stackLabelById.get(riser.stackId)
    const stackLabel = existingLabel ?? `R${nextLabelNumber++}`
    stackLabelById.set(riser.stackId, stackLabel)

    if (riser.stackLabel === stackLabel) return riser
    changed = true
    return { ...riser, stackLabel }
  })

  nextRiserLabelRef.current = nextLabelNumber
  return changed ? normalized : risers
}

function buildExportFileName(
  fileName: string,
  storeyName: string | null,
): string {
  const baseName = fileName.replace(/\.ifc$/i, '')
  const storeySegment = storeyName
    ? `-${storeyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    : ''

  return `${baseName}${storeySegment}-full.ifc`
}

function buildExportDebugFileName(
  fileName: string,
  storeyName: string | null,
): string {
  return buildExportFileName(fileName, storeyName).replace(/\.ifc$/i, '-riser-mapping.json')
}

function buildAdjustmentsFileName(fileName: string): string {
  return `${fileName.replace(/\.ifc$/i, '')}.adjustments.json`
}

function createExportRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `riser-export-${Date.now().toString(36)}`
}

function downloadBinary(bytes: Uint8Array, fileName: string, mimeType = 'application/octet-stream') {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: mimeType })
  downloadBlob(blob, fileName)
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  downloadBlob(blob, fileName)
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

function findDefaultStoreyId(storeys: Storey[]): StoreyId | null {
  const preferredStorey = storeys
    .map((storey) => ({
      storey,
      score: getSecondFloorMatchScore(storey),
    }))
    .filter((candidate): candidate is { storey: Storey; score: number } => candidate.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return left.storey.elevation - right.storey.elevation
    })[0]?.storey

  return preferredStorey?.id ?? null
}

function getSecondFloorMatchScore(storey: Storey): number | null {
  const normalizedName = storey.name.trim().toLowerCase()
  const numericTokens = extractSignedNumericTokens(normalizedName)
  const hasTwoToken = numericTokens.some((token) => token === 2)

  if (!hasTwoToken) return null
  if (isBasementStoreyName(normalizedName)) return null

  let score = storey.elevation >= 0 ? 1 : 0
  if (hasAboveGroundFloorKeyword(normalizedName)) score += 3
  else score += 2

  return score
}

function isBasementStoreyName(name: string): boolean {
  return /מרתף|basement|cellar|\bb\s*0*\d+\b|[-−]\s*0*\d+\b/i.test(name)
}

function hasAboveGroundFloorKeyword(name: string): boolean {
  return /קומה|מפלס|level|floor|storey|story/i.test(name)
}

function extractSignedNumericTokens(name: string): number[] {
  return (name.match(/[-−]?\s*\d+/g) ?? [])
    .map((token) => Number(token.replace(/\s+/g, '').replace('−', '-')))
    .filter((value) => Number.isFinite(value))
}

// ─────────────────────────────────────────────────────────────────────────────
// Local-frame helpers (viewer boundary)
//
// Domain state is kept in source coordinates; the viewers render in a local
// frame (source minus model origin). These pure helpers convert viewer-bound
// props. With the identity frame they return the input reference unchanged,
// so near-origin models keep referential equality and skip re-renders.
// ─────────────────────────────────────────────────────────────────────────────

function pickSourceBoundingBox(meshes: FloorMeshes): FloorMeshes['sourceBoundingBox'] {
  // Fallback covers FloorMeshes stubs (tests) created before sourceBoundingBox
  // existed; for real extractions both boxes are always present.
  return meshes.sourceBoundingBox ?? meshes.boundingBox
}

function readSourcePlanBounds(meshes: FloorMeshes): PlanBounds | null {
  const box = pickSourceBoundingBox(meshes)
  const bounds = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)) return null
  return bounds
}

function localizeFixtures(fixtures: Fixture[], frame: ModelFrame): Fixture[] {
  if (isIdentityModelFrame(frame)) return fixtures
  return fixtures.map((fixture) =>
    fixture.position === null ? fixture : { ...fixture, position: toLocalPoint(frame, fixture.position) },
  )
}

function localizeKitchens(kitchens: KitchenArea[], frame: ModelFrame): KitchenArea[] {
  if (isIdentityModelFrame(frame)) return kitchens
  return kitchens.map((kitchen) => ({
    ...kitchen,
    position: kitchen.position === null ? null : toLocalPoint(frame, kitchen.position),
    planBounds: kitchen.planBounds && {
      minX: kitchen.planBounds.minX - frame.origin.x,
      maxX: kitchen.planBounds.maxX - frame.origin.x,
      minZ: kitchen.planBounds.minZ - frame.origin.z,
      maxZ: kitchen.planBounds.maxZ - frame.origin.z,
    },
    planCorners: kitchen.planCorners?.map((corner) => ({
      x: corner.x - frame.origin.x,
      z: corner.z - frame.origin.z,
    })),
  }))
}

function localizeRisers(risers: Riser[], frame: ModelFrame): Riser[] {
  if (isIdentityModelFrame(frame)) return risers
  return risers.map((riser) => ({ ...riser, position: toLocalPoint(frame, riser.position) }))
}

function localizeSanitaryRoutes(
  routes: SanitaryFixtureRoute[],
  frame: ModelFrame,
): SanitaryFixtureRoute[] {
  if (isIdentityModelFrame(frame)) return routes
  return routes.map((route) => ({
    ...route,
    segments: route.segments.map((segment) => ({
      ...segment,
      from: toLocalPoint(frame, segment.from),
      to: toLocalPoint(frame, segment.to),
    })),
  }))
}

function localizeBranchSegments(segments: RouteSegment[], frame: ModelFrame): RouteSegment[] {
  if (isIdentityModelFrame(frame)) return segments
  return segments.map((segment) => ({
    ...segment,
    // Endpoint elevations are relative to the riser junction on the storey,
    // so only the plan axes shift between frames.
    start: { ...segment.start, x: segment.start.x - frame.origin.x, z: segment.start.z - frame.origin.z },
    end: { ...segment.end, x: segment.end.x - frame.origin.x, z: segment.end.z - frame.origin.z },
  }))
}

function localizeBranchRouteFloors(floors: FloorRoutes[], frame: ModelFrame): FloorRoutes[] {
  if (isIdentityModelFrame(frame)) return floors
  return floors.map((floor) => ({
    ...floor,
    segments: localizeBranchSegments(floor.segments, frame),
  }))
}
