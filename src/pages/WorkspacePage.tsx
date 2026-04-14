import { lazy, startTransition, Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { IfcUpload } from '@/features/ifc-upload/IfcUpload'
import { StoreyList } from '@/features/storey-list/StoreyList'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { ViewTransition } from '@/shared/reactViewTransition'
import { ViewerPlaceholder } from '@/viewer/ViewerPlaceholder'
import { WorkspaceLayout } from '@/widgets/WorkspaceLayout'
import { TopBar } from '@/widgets/TopBar'
import { getIfcApi } from '@/shared/ifc/ifcApi'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import type { Fixture, KitchenArea, Riser, RiserId, Storey, StoreyId, SidebarTab } from '@/domain/types'
import { buildRiserStack, removeRiserStack } from '@/shared/routes/buildRiserStacks'
import { suggestRiserPositions } from '@/shared/routes/suggestRisers'

let floorViewerModulePromise: Promise<typeof import('@/viewer/FloorViewer')> | null = null
let model3DViewerModulePromise: Promise<typeof import('@/viewer/Model3DViewer')> | null = null
let floorSelectionModulesPromise: Promise<
  [
    typeof import('@/shared/ifc/extractFloorMeshes'),
    typeof import('@/shared/ifc/detectFixtures'),
    typeof import('@/shared/ifc/detectKitchens'),
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

const FloorViewer = lazy(async () => {
  const mod = await loadFloorViewerModule()
  return { default: mod.FloorViewer }
})

const Model3DViewer = lazy(async () => {
  const mod = await loadModel3DViewerModule()
  return { default: mod.Model3DViewer }
})


export function WorkspacePage() {
  // --- file / model ---
  const webIfcModelIdRef = useRef<number | null>(null)
  const [webIfcModelId, setWebIfcModelId] = useState<number | null>(null)
  const sourceIfcBytesRef = useRef<Uint8Array | null>(null)
  const nextRiserLabelRef = useRef(1)
  const [modelFileName, setModelFileName] = useState<string | null>(null)

  // --- storey loading ---
  const [storeys, setStoreys] = useState<Storey[]>([])
  const [isParsingStoreys, setIsParsingStoreys] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // --- floor extraction ---
  const [selectedStoreyId, setSelectedStoreyId] = useState<StoreyId | null>(null)
  const [floorMeshes, setFloorMeshes] = useState<FloorMeshes | null>(null)
  const [isExtractingGeometry, setIsExtractingGeometry] = useState(false)
  const [geometryError, setGeometryError] = useState<string | null>(null)

  // --- viewer interaction ---
  const [hoveredExpressId, setHoveredExpressId] = useState<number | null>(null)
  const [selectedExpressId, setSelectedExpressId] = useState<number | null>(null)

  // --- fixtures ---
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [kitchens, setKitchens] = useState<KitchenArea[]>([])
  const [isDetectingFixtures, setIsDetectingFixtures] = useState(false)

  // --- risers ---
  const [risers, setRisers] = useState<Riser[]>([])
  const [isAddingRiser, setIsAddingRiser] = useState(false)
  const [downloadMode, setDownloadMode] = useState<'plumbing' | 'full' | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // --- sidebar ---
  const [activeTab, setActiveTab] = useState<SidebarTab>('risers')

  // --- view mode ---
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')

  // ---------------------------------------------------------------------------

  useEffect(() => {
    const normalized = ensureRiserStackLabels(risers, nextRiserLabelRef)
    if (normalized !== risers) {
      setRisers(normalized)
      return
    }

    nextRiserLabelRef.current = getNextRiserLabelNumber(risers)
  }, [risers])

  async function handleFileAccepted(file: File) {
    sourceIfcBytesRef.current = null
    nextRiserLabelRef.current = 1
    setIsParsingStoreys(true)
    setModelFileName(file.name)
    setUploadError(null)
    startTransition(() => {
      setStoreys([])
      setSelectedStoreyId(null)
      setFloorMeshes(null)
      setGeometryError(null)
      setHoveredExpressId(null)
      setSelectedExpressId(null)
      setFixtures([])
      setKitchens([])
      setRisers([])
      setIsAddingRiser(false)
      setActiveTab('risers')
      setDownloadError(null)
      setViewMode('2d')
      setWebIfcModelId(null)
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
      setWebIfcModelId(newModelId)

      const domainModelId = crypto.randomUUID()
      const parsed = await parseStoreys(api, newModelId, domainModelId)
      startTransition(() => {
        setStoreys(parsed)
      })
      preloadFloorInspectionModules()
      const defaultStoreyId = findDefaultStoreyId(parsed)
      if (defaultStoreyId !== null) {
        void openStorey(defaultStoreyId, parsed)
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to parse IFC file.',
      )
    } finally {
      setIsParsingStoreys(false)
    }
  }

  async function openStorey(id: StoreyId, availableStoreys: Storey[] = storeys) {
    const modelId = webIfcModelIdRef.current
    if (modelId === null) return

    // Keep the "opening floor" feedback urgent so the loader paints before IFC work begins.
    setSelectedStoreyId(id)
    setFloorMeshes(null)
    setGeometryError(null)
    setIsExtractingGeometry(true)
    setHoveredExpressId(null)
    setSelectedExpressId(null)
    setFixtures([])
    setKitchens([])
    setIsDetectingFixtures(true)
    // Risers are NOT cleared — they span all floors and persist across selection.
    setIsAddingRiser(false)
    setActiveTab('risers')
    setDownloadError(null)

    await waitForNextPaint()

    try {
      const [[{ extractFloorMeshes }, { detectFixtures }, { detectKitchens }], api] = await Promise.all([
        loadFloorSelectionModules(),
        getIfcApi(),
      ])

      const meshes = await extractFloorMeshes(api, modelId, id)
      startTransition(() => {
        setFloorMeshes(meshes)
        setIsExtractingGeometry(false)
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
        const toiletFixtures = fixturesResult.filter((fixture) => fixture.kind === 'TOILETPAN')

        startTransition(() => {
          setFixtures(toiletFixtures)
          setKitchens(kitchensResult)
          // Auto-suggest only if no risers have been placed yet (first floor opened).
          setRisers((prev) => {
            if (prev.length > 0) return prev
            nextRiserLabelRef.current = 1
            return buildSuggestedRisers(
              availableStoreys,
              id,
              toiletFixtures,
              kitchensResult,
              meshes,
              nextRiserLabelRef,
            )
          })
          setActiveTab('risers')
        })
      } catch {
        // Detection failure is non-fatal — floor plan stays visible, fixtures stay empty.
      } finally {
        startTransition(() => setIsDetectingFixtures(false))
      }
    } catch (err) {
      startTransition(() => {
        setGeometryError(
          err instanceof Error ? err.message : 'Failed to extract floor geometry.',
        )
        setIsExtractingGeometry(false)
        setIsDetectingFixtures(false)
      })
    }
  }

  async function handleStoreySelect(id: StoreyId) {
    await openStorey(id)
  }

  // --- riser handlers ---

  function handleAddRiser(pos: { x: number; y: number; z: number }) {
    if (!selectedStoreyId) return
    startTransition(() =>
      setRisers((prev) => [
        ...prev,
        ...buildRiserStack(storeys, selectedStoreyId, pos, takeNextRiserLabel(nextRiserLabelRef)),
      ]),
    )
  }

  function handleRemoveRiser(id: RiserId) {
    // Deleting a riser removes the whole vertical stack across all floors immediately.
    setRisers((prev) => removeRiserStack(prev, id))
  }

  function handleMoveRiser(id: RiserId, pos: { x: number; y: number; z: number }) {
    // Propagate X/Z to every floor in the same stack; preserve each floor's Y.
    setRisers((prev) => {
      const movedRiser = prev.find((r) => r.id === id)
      if (!movedRiser) return prev
      return prev.map((r) =>
        r.stackId === movedRiser.stackId
          ? { ...r, position: { x: pos.x, y: r.position.y, z: pos.z } }
          : r,
      )
    })
  }

  function handleToggleAddRiser() {
    startTransition(() => {
      setIsAddingRiser((v) => !v)
    })
  }

  function handleSuggestRisers() {
    if (!selectedStoreyId || (fixtures.length === 0 && kitchens.length === 0)) return
    startTransition(() => {
      nextRiserLabelRef.current = 1
      setRisers(
        buildSuggestedRisers(
          storeys,
          selectedStoreyId,
          fixtures,
          kitchens,
          floorMeshes,
          nextRiserLabelRef,
        ),
      )
      setIsAddingRiser(false)
      setActiveTab('risers')
    })
  }

  async function handleDownloadIfc(mode: 'plumbing' | 'full') {
    if (
      sourceIfcBytesRef.current === null ||
      selectedStoreyId === null ||
      modelFileName === null ||
      risers.length === 0
    ) {
      return
    }

    setDownloadMode(mode)
    setDownloadError(null)

    try {
      const api = await getIfcApi()
      const exportedBytes = mode === 'plumbing'
        ? await (await import('@/shared/ifc/exportIfcWithRisers')).exportIfcWithRisers(
            api,
            sourceIfcBytesRef.current,
            selectedStoreyId,
            risers,
          )
        : await (await import('@/shared/ifc/exportFullIfcWithRisers')).exportFullIfcWithRisers(
            api,
            sourceIfcBytesRef.current,
            selectedStoreyId,
            risers,
          )

      downloadBinary(
        exportedBytes,
        buildExportFileName(modelFileName, selectedStorey?.name ?? null, mode),
      )
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : mode === 'plumbing'
            ? 'Failed to generate the plumbing-only IFC.'
            : 'Failed to generate the full IFC.',
      )
    } finally {
      setDownloadMode(null)
    }
  }

  // ---------------------------------------------------------------------------

  const selectedStorey = storeys.find((storey) => storey.id === selectedStoreyId) ?? null
  const shouldLoadViewer =
    isExtractingGeometry || geometryError !== null || floorMeshes !== null

  // Risers for the currently-viewed floor only (viewer + panel display).
  // The full `risers` array spans all floors and is used for export.
  const currentFloorRisers =
    selectedStoreyId !== null
      ? risers.filter((r) => r.storeyId === selectedStoreyId)
      : []
  const viewerFixtures = isExtractingGeometry ? [] : fixtures
  const viewerKitchens = isExtractingGeometry ? [] : kitchens
  const viewerRisers = isExtractingGeometry ? [] : currentFloorRisers

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
        error={uploadError}
        fileName={modelFileName}
        storeyCount={storeys.length}
      />
      <StoreyList
        storeys={storeys}
        selectedId={selectedStoreyId}
        isLoading={isExtractingGeometry}
        onSelect={handleStoreySelect}
      />
    </>
  )

  function handleSwitch3D() {
    void loadModel3DViewerModule()
    setViewMode('3d')
  }

  const centerPanel = viewMode === '3d' && webIfcModelId !== null ? (
    <Suspense fallback={viewerFallback}>
      <Model3DViewer
        webIfcModelId={webIfcModelId}
        storeys={storeys}
        risers={risers}
        onSwitch2D={() => setViewMode('2d')}
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
          onObjectHover={setHoveredExpressId}
          onObjectSelect={setSelectedExpressId}
          modelFileName={modelFileName}
          selectedStoreyElevation={selectedStorey?.elevation ?? null}
          storeyCount={storeys.length}
          hoveredExpressId={hoveredExpressId}
          selectedExpressId={selectedExpressId}
          fixtures={viewerFixtures}
          kitchens={viewerKitchens}
          risers={viewerRisers}
          isAddingRiser={isAddingRiser}
          onRiserAdd={handleAddRiser}
          onRiserMove={handleMoveRiser}
          onSwitch3D={storeys.length > 0 ? handleSwitch3D : undefined}
        />
      </ViewTransition>
    </Suspense>
  ) : (
    viewerFallback
  )

  const rightPanel = (
    <Sidebar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      selectedStoreyName={selectedStorey?.name ?? null}
      storeyCount={storeys.length}
      hasModel={modelFileName !== null}
      fixtures={fixtures}
      kitchens={kitchens}
      isDetectingFixtures={isDetectingFixtures}
      risers={viewerRisers}
      isAddingRiser={isAddingRiser}
      onToggleAddRiser={handleToggleAddRiser}
      onSuggestRisers={handleSuggestRisers}
      onRemoveRiser={handleRemoveRiser}
      downloadMode={downloadMode}
      downloadError={downloadError}
      onDownloadPlumbingIfc={() => void handleDownloadIfc('plumbing')}
      onDownloadFullIfc={() => void handleDownloadIfc('full')}
    />
  )

  return (
    <WorkspaceLayout
      header={<TopBar modelFileName={modelFileName} currentStep={currentStep} />}
      leftPanel={leftPanel}
      centerPanel={centerPanel}
      rightPanel={rightPanel}
    />
  )
}

/**
 * Suggests riser positions from the fixtures/kitchens on `sourceStoreyId`, then
 * creates one `Riser` entry per storey while preserving the source floor's
 * vertical offset from its storey elevation.
 * All entries for the same physical pipe share a `stackId`.
 */
function buildSuggestedRisers(
  storeys: Storey[],
  sourceStoreyId: StoreyId,
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  floorMeshes: FloorMeshes | null,
  nextRiserLabelRef: MutableRefObject<number>,
): Riser[] {
  const floorPlanBounds = floorMeshes
    ? {
        minX: floorMeshes.boundingBox.min.x,
        maxX: floorMeshes.boundingBox.max.x,
        minZ: floorMeshes.boundingBox.min.z,
        maxZ: floorMeshes.boundingBox.max.z,
      }
    : null

  const positions = suggestRiserPositions(fixtures, kitchens, floorPlanBounds)
  return positions.flatMap((position) =>
    buildRiserStack(
      storeys,
      sourceStoreyId,
      position,
      takeNextRiserLabel(nextRiserLabelRef),
    ),
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
  mode: 'plumbing' | 'full',
): string {
  const baseName = fileName.replace(/\.ifc$/i, '')
  const storeySegment = storeyName
    ? `-${storeyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    : ''

  return mode === 'plumbing'
    ? `${baseName}${storeySegment}-plumbing.ifc`
    : `${baseName}${storeySegment}-full.ifc`
}

function downloadBinary(bytes: Uint8Array, fileName: string) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
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
