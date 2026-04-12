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

export function WorkspacePage() {
  // --- file / model ---
  const webIfcModelIdRef = useRef<number | null>(null)
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
  const [isDownloadingIfc, setIsDownloadingIfc] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // --- sidebar ---
  const [activeTab, setActiveTab] = useState<SidebarTab>('risers')

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
      const webIfcModelId = api.OpenModel(data)
      webIfcModelIdRef.current = webIfcModelId

      const domainModelId = crypto.randomUUID()
      const parsed = await parseStoreys(api, webIfcModelId, domainModelId)
      startTransition(() => {
        setStoreys(parsed)
      })
      preloadFloorInspectionModules()
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to parse IFC file.',
      )
    } finally {
      setIsParsingStoreys(false)
    }
  }

  async function handleStoreySelect(id: StoreyId) {
    const webIfcModelId = webIfcModelIdRef.current
    if (webIfcModelId === null) return

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

      const meshes = await extractFloorMeshes(api, webIfcModelId, id)
      startTransition(() => {
        setFloorMeshes(meshes)
        setIsExtractingGeometry(false)
      })

      try {
        const [detectedFixtures, detectedKitchens] = await Promise.allSettled([
          detectFixtures(api, webIfcModelId, id),
          detectKitchens(api, webIfcModelId, id),
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
              storeys,
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

  async function handleDownloadIfc() {
    if (
      sourceIfcBytesRef.current === null ||
      selectedStoreyId === null ||
      modelFileName === null ||
      risers.length === 0
    ) {
      return
    }

    setIsDownloadingIfc(true)
    setDownloadError(null)

    try {
      const api = await getIfcApi()
      const { exportIfcWithRisers } = await import('@/shared/ifc/exportIfcWithRisers')
      const exportedBytes = await exportIfcWithRisers(
        api,
        sourceIfcBytesRef.current,
        selectedStoreyId,
        risers,
      )

      downloadBinary(
        exportedBytes,
        buildExportFileName(modelFileName, selectedStorey?.name ?? null),
      )
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Failed to generate the IFC download.',
      )
    } finally {
      setIsDownloadingIfc(false)
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

  const centerPanel = (
    shouldLoadViewer ? (
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
          />
        </ViewTransition>
      </Suspense>
    ) : (
      viewerFallback
    )
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
      isDownloadingIfc={isDownloadingIfc}
      downloadError={downloadError}
      onDownloadIfc={handleDownloadIfc}
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

function buildExportFileName(fileName: string, storeyName: string | null): string {
  const baseName = fileName.replace(/\.ifc$/i, '')
  const storeySegment = storeyName
    ? `-${storeyName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    : ''

  return `${baseName}${storeySegment}-risers.ifc`
}

function downloadBinary(bytes: Uint8Array, fileName: string) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
