import { startTransition, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import type { ThemeMode } from '@/app/App'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import type { Fixture, FixtureKind, KitchenArea, Riser, RiserId } from '@/domain/types'
import { ViewTransition } from '@/shared/reactViewTransition'
import './FloorViewer.css'

const HOVER_ACCENT = new THREE.Color(0xffb45f)
const SELECTED_ACCENT = new THREE.Color(0xff6a7f)

interface FloorViewerProps {
  floorMeshes: FloorMeshes | null
  isLoading: boolean
  error: string | null
  theme: ThemeMode
  onObjectHover: (expressId: number | null) => void
  onObjectSelect: (expressId: number | null) => void
  modelFileName?: string | null
  selectedStoreyElevation?: number | null
  storeyCount?: number
  hoveredExpressId?: number | null
  selectedExpressId?: number | null
  fixtures?: Fixture[]
  kitchens?: KitchenArea[]
  risers?: Riser[]
  isAddingFixture?: boolean
  pendingFixtureKind?: FixtureKind
  isAddingRiser?: boolean
  onFixtureAdd?: (pos: { x: number; y: number; z: number }) => void
  onRiserAdd?: (pos: { x: number; y: number; z: number }) => void
  onRiserMove?: (id: RiserId, pos: { x: number; y: number; z: number }) => void
  onSwitch3D?: () => void
}

export function FloorViewer({
  floorMeshes,
  isLoading,
  error,
  theme,
  onObjectHover,
  onObjectSelect,
  modelFileName = null,
  selectedStoreyElevation = null,
  storeyCount = 0,
  hoveredExpressId = null,
  selectedExpressId = null,
  fixtures = [],
  kitchens = [],
  risers = [],
  isAddingFixture = false,
  pendingFixtureKind = 'TOILETPAN',
  isAddingRiser = false,
  onFixtureAdd = () => {},
  onRiserAdd = () => {},
  onRiserMove = () => {},
  onSwitch3D,
}: FloorViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const controlsRef = useRef<MapControls | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const frameIdRef = useRef<number>(0)
  const renderQueuedRef = useRef(false)
  const scheduleRenderRef = useRef<() => void>(() => {})
  const hoveredMeshRef = useRef<THREE.Mesh | null>(null)
  const selectedMeshRef = useRef<THREE.Mesh | null>(null)
  const boundsRef = useRef<THREE.Box3 | null>(null)
  const floorGroupRef = useRef<THREE.Group | null>(null)
  const projectionVecRef = useRef(new THREE.Vector3())

  // Fixture overlay: map of expressId → positioned div element
  const fixtureMarkerRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  // Kitchen overlay: map of expressId → positioned div element
  const kitchenMarkerRefsRef = useRef<Map<number, HTMLDivElement>>(new Map())
  // Riser overlay: map of riserId → positioned div element
  const riserMarkerRefsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // Plane representing the floor surface — used to unproject click → world coords
  const planPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  // Drag state while the user is repositioning a riser
  const riserDragRef = useRef<{
    riserId: RiserId
    startClickWorld: THREE.Vector3
    startPos: { x: number; y: number; z: number }
  } | null>(null)
  // Pointer-down position — used to distinguish a click from a pan gesture
  const clickStartRef = useRef<{ x: number; y: number } | null>(null)

  function scheduleRender() {
    scheduleRenderRef.current()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(readViewerBackgroundColor(), 1)

    const scene = new THREE.Scene()
    scene.background = readViewerBackgroundColor()

    const w = canvas.clientWidth || 800
    const h = canvas.clientHeight || 600
    const aspect = w / h
    const frustum = 100

    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      20000,
    )
    camera.position.set(0, 10000, 0)
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)

    const controls = new MapControls(camera, canvas)
    controls.enableRotate = false
    controls.screenSpacePanning = true
    controls.zoomToCursor = true
    controls.minZoom = 0.01
    controls.maxZoom = 200

    renderer.setSize(w, h)

    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls
    sceneRef.current = scene

    const renderScene = () => {
      renderQueuedRef.current = false
      renderer.render(scene, camera)
      animateKitchenMarkers()
      animateFixtureMarkers()
      animateRiserMarkers()
    }

    const queueRender = () => {
      if (renderQueuedRef.current) return
      renderQueuedRef.current = true
      frameIdRef.current = requestAnimationFrame(renderScene)
    }

    scheduleRenderRef.current = queueRender
    controls.addEventListener('change', queueRender)
    queueRender()

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      renderer.setSize(width, height)
      renderer.setPixelRatio(window.devicePixelRatio)
      // Preserve the current vertical world extent and only re-derive the
      // horizontal extent from the new aspect — otherwise the camera bounds
      // set by fitCamera get clobbered with a stale `frustum = 100` base,
      // which makes the plan look mis-fitted until the user clicks Fit.
      const a = width / height
      const half = camera.top
      camera.left = -half * a
      camera.right = half * a
      camera.updateProjectionMatrix()
      queueRender()
    })
    observer.observe(canvas)

    return () => {
      clearInteractionState(hoveredMeshRef, selectedMeshRef)
      startTransition(() => onObjectHover(null))
      onObjectSelect(null)

      if (floorGroupRef.current) {
        scene.remove(floorGroupRef.current)
        disposeSceneObject(floorGroupRef.current)
        floorGroupRef.current = null
      }

      scheduleRenderRef.current = () => {}
      renderQueuedRef.current = false
      cancelAnimationFrame(frameIdRef.current)
      observer.disconnect()
      controls.removeEventListener('change', queueRender)
      controls.dispose()
      renderer.dispose()
    }
  }, [onObjectHover, onObjectSelect])

  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    if (!renderer || !scene) return

    const viewerBackground = readViewerBackgroundColor()
    renderer.setClearColor(viewerBackground, 1)
    scene.background = viewerBackground
    scheduleRender()
  }, [theme])

  useEffect(() => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const canvas = canvasRef.current
    if (!scene || !camera || !controls || !canvas) return

    clearInteractionState(hoveredMeshRef, selectedMeshRef)
    startTransition(() => onObjectHover(null))
    onObjectSelect(null)

    if (floorGroupRef.current) {
      scene.remove(floorGroupRef.current)
      disposeSceneObject(floorGroupRef.current)
      floorGroupRef.current = null
    }

    if (!floorMeshes) {
      boundsRef.current = null
      scheduleRender()
      return
    }

    const { group, boundingBox } = floorMeshes
    styleFloorGroup(group, theme)
    scene.add(group)
    floorGroupRef.current = group
    boundsRef.current = boundingBox

    fitCamera(camera, controls, boundingBox, canvas)

    // Set the plan plane for click→world unprojection.
    // Normal = unit vector from target toward camera (perpendicular to floor).
    const center = new THREE.Vector3()
    boundingBox.getCenter(center)
    const camNormal = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize()
    planPlaneRef.current.setFromNormalAndCoplanarPoint(camNormal, center)
    scheduleRender()
  }, [floorMeshes, onObjectHover, onObjectSelect, theme])

  useEffect(() => {
    const floorGroup = floorGroupRef.current
    if (!floorGroup) return

    const nextSelected =
      selectedExpressId === null ? null : findMeshByExpressId(floorGroup, selectedExpressId)
    const nextHovered =
      hoveredExpressId === null || hoveredExpressId === selectedExpressId
        ? null
        : findMeshByExpressId(floorGroup, hoveredExpressId)

    if (nextHovered === hoveredMeshRef.current && nextSelected === selectedMeshRef.current) return

    const previousHover = hoveredMeshRef.current
    const previousSelected = selectedMeshRef.current
    hoveredMeshRef.current = nextHovered
    selectedMeshRef.current = nextSelected

    applyInteractionStyles(
      [previousHover, previousSelected, nextHovered, nextSelected],
      hoveredMeshRef,
      selectedMeshRef,
      HOVER_ACCENT,
      SELECTED_ACCENT,
    )
    scheduleRender()
  }, [floorMeshes, hoveredExpressId, selectedExpressId])

  const plottedFixtures = useMemo(
    () =>
      fixtures.filter(
        (fixture): fixture is Fixture & { position: NonNullable<Fixture['position']> } =>
          fixture.position !== null,
      ),
    [fixtures],
  )
  const plottedKitchens = useMemo(
    () =>
      kitchens.filter(
        (kitchen): kitchen is KitchenArea & { position: NonNullable<KitchenArea['position']> } =>
          kitchen.position !== null,
      ),
    [kitchens],
  )
  const fixtureMarkerLabels = useMemo(
    () => buildFixtureMarkerLabels(plottedFixtures),
    [plottedFixtures],
  )
  const kitchenMarkerLabels = useMemo(
    () => buildKitchenMarkerLabels(plottedKitchens),
    [plottedKitchens],
  )

  useEffect(() => {
    scheduleRender()
  }, [floorMeshes, plottedFixtures, plottedKitchens, risers])

  const raycaster = useRef(new THREE.Raycaster())
  const pointer = useRef(new THREE.Vector2())

  /** Unproject a pointer event to a world position on the floor plane. */
  function eventToFloorWorld(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    if (!canvas || !camera) return null
    const rect = canvas.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    raycaster.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const worldPos = new THREE.Vector3()
    if (!raycaster.current.ray.intersectPlane(planPlaneRef.current, worldPos)) return null
    return worldPos
  }

  function handleRiserPointerDown(e: React.PointerEvent<HTMLButtonElement>, riser: Riser) {
    e.stopPropagation()
    const worldPos = eventToFloorWorld(e)
    if (!worldPos) return
    e.currentTarget.setPointerCapture(e.pointerId)
    riserDragRef.current = {
      riserId: riser.id,
      startClickWorld: worldPos,
      startPos: { ...riser.position },
    }
  }

  function handleRiserPointerMove(e: React.PointerEvent<HTMLButtonElement>, riser: Riser) {
    const drag = riserDragRef.current
    if (!drag || drag.riserId !== riser.id) return
    const currentWorld = eventToFloorWorld(e)
    if (!currentWorld) return
    onRiserMove(drag.riserId, {
      x: drag.startPos.x + (currentWorld.x - drag.startClickWorld.x),
      y: drag.startPos.y + (currentWorld.y - drag.startClickWorld.y),
      z: drag.startPos.z + (currentWorld.z - drag.startClickWorld.z),
    })
  }

  function handleRiserPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (riserDragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      riserDragRef.current = null
    }
  }

  function restoreHoveredMesh() {
    const previousHover = hoveredMeshRef.current
    hoveredMeshRef.current = null
    applyInteractionStyles(
      [previousHover, selectedMeshRef.current],
      hoveredMeshRef,
      selectedMeshRef,
      HOVER_ACCENT,
      SELECTED_ACCENT,
    )
    scheduleRender()
    startTransition(() => onObjectHover(null))
  }

  function pickAt(e: React.PointerEvent<HTMLCanvasElement>): THREE.Mesh | null {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    const scene = sceneRef.current
    if (!canvas || !camera || !scene) return null

    const rect = canvas.getBoundingClientRect()
    pointer.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
    raycaster.current.setFromCamera(pointer.current, camera)
    const hits = raycaster.current.intersectObjects(scene.children, true)
    const hit = hits.find((candidate) => candidate.object instanceof THREE.Mesh)
    return hit ? (hit.object as THREE.Mesh) : null
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    clickStartRef.current = { x: e.clientX, y: e.clientY }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    // Suppress hover detection while dragging a riser (handled by the riser button itself)
    if (riserDragRef.current) return

    const mesh = pickAt(e)
    const hoverTarget = mesh === selectedMeshRef.current ? null : mesh

    if (hoverTarget !== hoveredMeshRef.current) {
      const previousHover = hoveredMeshRef.current
      hoveredMeshRef.current = hoverTarget
      applyInteractionStyles(
        [previousHover, hoverTarget, selectedMeshRef.current],
        hoveredMeshRef,
        selectedMeshRef,
        HOVER_ACCENT,
        SELECTED_ACCENT,
      )
      scheduleRender()
      startTransition(() =>
        onObjectHover(
          hoverTarget ? ((hoverTarget.userData['expressID'] as number | undefined) ?? null) : null,
        ),
      )
    }
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // Ignore if this click followed a pan gesture
    const start = clickStartRef.current
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return

    if (isAddingFixture) {
      const worldPos = eventToFloorWorld(e)
      if (worldPos) onFixtureAdd({ x: worldPos.x, y: worldPos.y, z: worldPos.z })
      return
    }

    if (isAddingRiser) {
      const worldPos = eventToFloorWorld(e)
      if (worldPos) onRiserAdd({ x: worldPos.x, y: worldPos.y, z: worldPos.z })
      return
    }

    const mesh = pickAt(e as unknown as React.PointerEvent<HTMLCanvasElement>)
    const previousSelected = selectedMeshRef.current
    const nextSelected = mesh && mesh === selectedMeshRef.current ? null : mesh
    selectedMeshRef.current = nextSelected
    if (hoveredMeshRef.current === nextSelected) {
      hoveredMeshRef.current = null
      startTransition(() => onObjectHover(null))
    }
    applyInteractionStyles(
      [previousSelected, nextSelected, hoveredMeshRef.current],
      hoveredMeshRef,
      selectedMeshRef,
      HOVER_ACCENT,
      SELECTED_ACCENT,
    )
    scheduleRender()
    startTransition(() =>
      onObjectSelect(
        nextSelected ? ((nextSelected.userData['expressID'] as number | undefined) ?? null) : null,
      ),
    )
  }

  function handleFixtureHover(expressId: number | null) {
    startTransition(() => onObjectHover(expressId))
  }

  function handleFixtureSelect(expressId: number) {
    startTransition(() => onObjectSelect(selectedExpressId === expressId ? null : expressId))
  }

  function handleResetView() {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const canvas = canvasRef.current
    if (!camera || !controls || !canvas || !boundsRef.current) return
    fitCamera(camera, controls, boundsRef.current, canvas)
    scheduleRender()
  }

  const showOverlay = isLoading || !!error || !floorMeshes
  const overlayText = isLoading
    ? 'Extracting floor geometry...'
    : error
      ? error
      : modelFileName
        ? 'Choose a floor from the left panel to isolate its geometry.'
        : 'Upload an IFC file and select a floor.'

  return (
    <div className="floor-viewer">
      <canvas
        ref={canvasRef}
        className={[
          'floor-viewer__canvas',
          isAddingRiser || isAddingFixture ? 'floor-viewer__canvas--adding-riser' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={restoreHoveredMesh}
        onClick={handleClick}
      />

      <div className="floor-viewer__hud">
        <div className="floor-viewer__chips">
          <ViewTransition name="viewer-stage-status" share="morph" default="none">
            <span className="floor-viewer__chip floor-viewer__chip--accent">
              {isLoading
                ? 'Extracting geometry'
                : floorMeshes
                  ? 'Viewer ready'
                  : modelFileName
                    ? 'Model loaded'
                    : 'Awaiting IFC'}
            </span>
          </ViewTransition>

          {selectedStoreyElevation !== null && (
            <span className="floor-viewer__chip">
              {Math.round(selectedStoreyElevation).toLocaleString()} mm
            </span>
          )}

          {isAddingFixture && (
            <span className="floor-viewer__chip floor-viewer__chip--fixture">
              Add {getFixtureKindLabel(pendingFixtureKind)}
            </span>
          )}

          {plottedFixtures.length > 0 && (
            <span className="floor-viewer__chip floor-viewer__chip--fixture">
              {plottedFixtures.length} toilets
            </span>
          )}

          {plottedKitchens.length > 0 && (
            <span className="floor-viewer__chip floor-viewer__chip--kitchen">
              {plottedKitchens.length} kitchens
            </span>
          )}

          {risers.length > 0 && (
            <span className="floor-viewer__chip floor-viewer__chip--riser">
              {risers.length} risers
            </span>
          )}

          {storeyCount > 0 && (
            <span className="floor-viewer__chip">{storeyCount} storeys</span>
          )}
        </div>
      </div>

      {!showOverlay && (
        <>
          <div className="floor-viewer__fixture-overlay" aria-hidden="true">
            {plottedFixtures.map((fixture, index) => {
              const isSelected = fixture.expressId === selectedExpressId
              const isHovered = !isSelected && fixture.expressId === hoveredExpressId
              const markerLabel =
                fixtureMarkerLabels.get(fixture.expressId) ?? getFixtureKindCode(fixture)
              const enterDelay = `${Math.min(index, 16) * 40}ms`

              return (
                <div
                  key={fixture.expressId}
                  className={[
                    'floor-viewer__fixture-pin',
                    isSelected ? 'floor-viewer__fixture-pin--selected' : '',
                    isHovered ? 'floor-viewer__fixture-pin--hovered' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={(el) => {
                    if (el) fixtureMarkerRefsRef.current.set(fixture.expressId, el)
                    else fixtureMarkerRefsRef.current.delete(fixture.expressId)
                  }}
                  data-fixture-x={String(fixture.position.x)}
                  data-fixture-y={String(fixture.position.y)}
                  data-fixture-z={String(fixture.position.z)}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={[
                      'floor-viewer__fixture-btn',
                      fixture.expressId < 0 ? 'floor-viewer__fixture-btn--manual' : '',
                      isSelected ? 'floor-viewer__fixture-btn--selected' : '',
                      isHovered ? 'floor-viewer__fixture-btn--hovered' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => handleFixtureHover(fixture.expressId)}
                    onMouseLeave={() => {
                      if (hoveredExpressId === fixture.expressId) handleFixtureHover(null)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFixtureSelect(fixture.expressId)
                    }}
                    title={`${fixture.name} — ${getFixtureKindLabel(fixture)} — IFC #${fixture.expressId}`}
                    aria-label={`${fixture.name}, ${getFixtureKindLabel(fixture)}, IFC ${fixture.expressId}`}
                    style={{ animationDelay: enterDelay }}
                  >
                    <span className="floor-viewer__fixture-core">
                      <span className="floor-viewer__fixture-code">
                        {getFixtureKindCode(fixture)}
                      </span>
                    </span>
                    <span className="floor-viewer__fixture-label">{markerLabel}</span>
                  </button>
                </div>
              )
            })}
          </div>

          <div className="floor-viewer__kitchen-overlay" aria-hidden="true">
            {plottedKitchens.map((kitchen, index) => (
              <div
                key={kitchen.expressId}
                className="floor-viewer__kitchen-pin"
                ref={(el) => {
                  if (el) kitchenMarkerRefsRef.current.set(kitchen.expressId, el)
                  else kitchenMarkerRefsRef.current.delete(kitchen.expressId)
                }}
                data-kitchen-x={String(kitchen.position.x)}
                data-kitchen-y={String(kitchen.position.y)}
                data-kitchen-z={String(kitchen.position.z)}
              >
                <div
                  className="floor-viewer__kitchen-badge"
                  style={{ animationDelay: `${Math.min(index, 12) * 50}ms` }}
                >
                  <span className="floor-viewer__kitchen-core">KT</span>
                  <span className="floor-viewer__kitchen-label">
                    {kitchenMarkerLabels.get(kitchen.expressId) ?? 'KT'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Riser markers — positioned imperatively in the rAF loop via data-* attributes */}
          <div className="floor-viewer__riser-overlay" aria-hidden="true">
            {risers.map((riser, index) => (
              <div
                key={riser.id}
                className="floor-viewer__riser-pin"
                ref={(el) => {
                  if (el) riserMarkerRefsRef.current.set(riser.id, el)
                  else riserMarkerRefsRef.current.delete(riser.id)
                }}
                data-riser-x={String(riser.position.x)}
                data-riser-y={String(riser.position.y)}
                data-riser-z={String(riser.position.z)}
                style={{ '--riser-enter-delay': `${Math.min(index, 16) * 60}ms` } as CSSProperties}
              >
                <button
                  className="floor-viewer__riser-btn"
                  onPointerDown={(e) => handleRiserPointerDown(e, riser)}
                  onPointerMove={(e) => handleRiserPointerMove(e, riser)}
                  onPointerUp={handleRiserPointerUp}
                  aria-label={riser.stackLabel}
                >
                  {riser.stackLabel}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {showOverlay && (
        <div className="floor-viewer__overlay">
          <div className="floor-viewer__overlay-card">
            <p className="floor-viewer__overlay-kicker">
              {isLoading
                ? 'Preparing floor'
                : error
                  ? 'Geometry issue'
                  : modelFileName
                    ? 'Select a floor'
                    : 'Start with IFC'}
            </p>
            <p className="floor-viewer__overlay-text">{overlayText}</p>
          </div>
        </div>
      )}

      {!showOverlay && (
        <div className="floor-viewer__legend" aria-hidden="true">
          <span className="floor-viewer__legend-item floor-viewer__legend-item--fixture">
            Amber = toilets
          </span>
          <span className="floor-viewer__legend-item floor-viewer__legend-item--kitchen">
            Mint = kitchens
          </span>
          <span className="floor-viewer__legend-item floor-viewer__legend-item--riser">
            Blue = risers
          </span>
          {isAddingFixture && (
            <span className="floor-viewer__legend-item floor-viewer__legend-item--fixture">
              Click to place {getFixtureKindLabel(pendingFixtureKind).toLowerCase()}
            </span>
          )}
          <span className="floor-viewer__legend-item">Drag to pan</span>
          <span className="floor-viewer__legend-item">Scroll to zoom</span>
          <span className="floor-viewer__legend-item">Drag blue pins to reposition risers</span>
        </div>
      )}

      {(floorMeshes || onSwitch3D) && (
        <div className="floor-viewer__toolbar">
          {floorMeshes && (
            <button
              className="floor-viewer__btn"
              title="Reset view"
              aria-label="Reset view"
              onClick={handleResetView}
            >
              Fit
            </button>
          )}
          {onSwitch3D && (
            <button
              className="floor-viewer__btn"
              title="Show all floors with risers"
              onClick={onSwitch3D}
            >
              3D
            </button>
          )}
        </div>
      )}
    </div>
  )

  function animateRiserMarkers() {
    for (const [, el] of riserMarkerRefsRef.current) {
      const x = parseFloat(el.dataset['riserX'] ?? '0')
      const y = parseFloat(el.dataset['riserY'] ?? '0')
      const z = parseFloat(el.dataset['riserZ'] ?? '0')
      positionOverlayMarker(el, x, y, z)
    }
  }

  function animateKitchenMarkers() {
    for (const [, el] of kitchenMarkerRefsRef.current) {
      const x = parseFloat(el.dataset['kitchenX'] ?? '0')
      const y = parseFloat(el.dataset['kitchenY'] ?? '0')
      const z = parseFloat(el.dataset['kitchenZ'] ?? '0')
      positionOverlayMarker(el, x, y, z)
    }
  }

  function animateFixtureMarkers() {
    for (const [, el] of fixtureMarkerRefsRef.current) {
      const x = parseFloat(el.dataset['fixtureX'] ?? '0')
      const y = parseFloat(el.dataset['fixtureY'] ?? '0')
      const z = parseFloat(el.dataset['fixtureZ'] ?? '0')
      positionOverlayMarker(el, x, y, z)
    }
  }

  function positionOverlayMarker(el: HTMLDivElement, x: number, y: number, z: number) {
    const canvas = canvasRef.current
    const camera = cameraRef.current
    if (!canvas || !camera) return

    const vec = projectionVecRef.current
    vec.set(x, y, z)

    // Flatten markers onto the current plan plane so floor-to-floor Y drift
    // does not make otherwise valid plan markers disappear from the 2D view.
    const distanceToPlan = planPlaneRef.current.distanceToPoint(vec)
    if (Number.isFinite(distanceToPlan)) {
      vec.addScaledVector(planPlaneRef.current.normal, -distanceToPlan)
    }

    vec.project(camera)

    if (!Number.isFinite(vec.x) || !Number.isFinite(vec.y) || !Number.isFinite(vec.z) || vec.z < -1 || vec.z > 1) {
      el.style.opacity = '0'
      return
    }

    const sx = ((vec.x + 1) / 2) * canvas.clientWidth
    const sy = ((-vec.y + 1) / 2) * canvas.clientHeight
    el.style.opacity = '1'
    el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`
  }
}

function buildFixtureMarkerLabels(
  fixtures: Array<Fixture & { position: NonNullable<Fixture['position']> }>,
): Map<number, string> {
  const codeCounts = new Map<string, number>()
  const labels = new Map<number, string>()

  for (const fixture of fixtures) {
    const code = getFixtureKindCode(fixture)
    const nextCount = (codeCounts.get(code) ?? 0) + 1
    codeCounts.set(code, nextCount)
    labels.set(fixture.expressId, `${code}-${nextCount}`)
  }

  return labels
}

function buildKitchenMarkerLabels(
  kitchens: Array<KitchenArea & { position: NonNullable<KitchenArea['position']> }>,
): Map<number, string> {
  return new Map(kitchens.map((kitchen, index) => [kitchen.expressId, `KT-${index + 1}`]))
}

function findMeshByExpressId(root: THREE.Object3D, expressId: number): THREE.Mesh | null {
  let match: THREE.Mesh | null = null

  root.traverse((object) => {
    if (match || !(object instanceof THREE.Mesh)) return
    if ((object.userData['expressID'] as number | undefined) === expressId) {
      match = object
    }
  })

  return match
}

function getFixtureKindCode(fixture: Pick<Fixture, 'kind' | 'isKitchenSink'> | FixtureKind): string {
  const kind = typeof fixture === 'string' ? fixture : fixture.kind
  const isKitchenSink = typeof fixture === 'string' ? false : Boolean(fixture.isKitchenSink)

  if (kind === 'SINK' && isKitchenSink) return 'KS'

  switch (kind) {
    case 'TOILETPAN':
      return 'WC'
    case 'WASHHANDBASIN':
      return 'WB'
    case 'SINK':
      return 'SK'
    case 'BATH':
      return 'BT'
    case 'URINAL':
      return 'UR'
    case 'CISTERN':
      return 'CS'
    case 'BIDET':
      return 'BD'
    default:
      return 'FX'
  }
}

function getFixtureKindLabel(fixture: Pick<Fixture, 'kind' | 'isKitchenSink'> | FixtureKind): string {
  const kind = typeof fixture === 'string' ? fixture : fixture.kind
  const isKitchenSink = typeof fixture === 'string' ? false : Boolean(fixture.isKitchenSink)

  if (kind === 'SINK' && isKitchenSink) return 'Kitchen sink'

  switch (kind) {
    case 'TOILETPAN':
      return 'Toilet'
    case 'WASHHANDBASIN':
      return 'Wash basin'
    case 'SINK':
      return 'Sink'
    case 'BATH':
      return 'Bath'
    case 'URINAL':
      return 'Urinal'
    case 'CISTERN':
      return 'Cistern'
    case 'BIDET':
      return 'Bidet'
    default:
      return 'Fixture'
  }
}

function fitCamera(
  camera: THREE.OrthographicCamera,
  controls: MapControls,
  box: THREE.Box3,
  canvas: HTMLCanvasElement,
) {
  if (box.isEmpty()) return

  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)

  const extents = [
    { axis: 'x' as const, size: size.x },
    { axis: 'y' as const, size: size.y },
    { axis: 'z' as const, size: size.z },
  ].sort((a, b) => a.size - b.size)

  const upAxis = extents[0].axis
  const planAxes = [extents[1].axis, extents[2].axis]
  const planW = size[planAxes[0]]
  const planH = size[planAxes[1]]

  const aspect = canvas.clientWidth / canvas.clientHeight
  const padding = 0.1
  const fw = (planW * (1 + padding)) / aspect
  const fh = planH * (1 + padding)
  const frustum = Math.max(fw, fh, 1)
  const half = frustum / 2

  camera.left = -half * aspect
  camera.right = half * aspect
  camera.top = half
  camera.bottom = -half
  camera.zoom = 1

  const camOffset = frustum * 2
  const camPos = center.clone()
  camPos[upAxis] = box.max[upAxis] + camOffset

  camera.position.copy(camPos)

  const screenUp = new THREE.Vector3()
  screenUp[planAxes[1]] = 1
  camera.up.copy(screenUp)

  camera.lookAt(center)
  camera.near = camOffset * 0.01
  camera.far = camOffset * 3
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}

function styleFloorGroup(group: THREE.Group, theme: ThemeMode) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return

    const material = Array.isArray(object.material) ? object.material[0] : object.material
    if (!(material instanceof THREE.MeshBasicMaterial)) return

    const themedMaterial = material.clone()
    const surfaceColor = createSurfaceColor(material.color, theme)

    themedMaterial.color.copy(surfaceColor)
    themedMaterial.transparent = true
    themedMaterial.opacity = THREE.MathUtils.clamp(material.opacity * 0.12, 0.04, 0.18)
    themedMaterial.side = THREE.DoubleSide
    themedMaterial.polygonOffset = true
    themedMaterial.polygonOffsetFactor = 1
    themedMaterial.polygonOffsetUnits = 1
    object.material = themedMaterial
    object.renderOrder = 1
    object.updateMatrixWorld(true)
    object.userData['baseColor'] = surfaceColor.clone()
    object.userData['baseOpacity'] = themedMaterial.opacity

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(object.geometry as THREE.BufferGeometry, 28),
      new THREE.LineBasicMaterial({
        color: createEdgeColor(surfaceColor),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      }),
    )

    outline.renderOrder = 2
    object.userData['edgeMaterial'] = outline.material as THREE.LineBasicMaterial

    const geometry = object.geometry as THREE.BufferGeometry
    geometry.computeBoundingBox()
    if (geometry.boundingBox) {
      const anchor = geometry.boundingBox.getCenter(new THREE.Vector3())
      anchor.applyMatrix4(object.matrixWorld)
      object.userData['anchor'] = anchor
    }

    object.add(outline)
  })
}

function applyInteractionStyles(
  candidates: Array<THREE.Mesh | null>,
  hoveredMeshRef: React.MutableRefObject<THREE.Mesh | null>,
  selectedMeshRef: React.MutableRefObject<THREE.Mesh | null>,
  hoverAccent = new THREE.Color(0xffb45f),
  selectedAccent = new THREE.Color(0xff6a7f),
) {
  const uniqueMeshes = new Set(candidates.filter((mesh): mesh is THREE.Mesh => mesh !== null))
  uniqueMeshes.forEach((mesh) => {
    const isSelected = mesh === selectedMeshRef.current
    const isHovered = mesh === hoveredMeshRef.current
    setMeshVisualState(mesh, isSelected, isHovered, hoverAccent, selectedAccent)
  })
}

function setMeshVisualState(
  mesh: THREE.Mesh,
  isSelected: boolean,
  isHovered: boolean,
  hoverAccent: THREE.Color,
  selectedAccent: THREE.Color,
) {
  const material = mesh.material as THREE.MeshBasicMaterial
  const edgeMaterial = mesh.userData['edgeMaterial'] as THREE.LineBasicMaterial | undefined
  const baseColor = (mesh.userData['baseColor'] as THREE.Color | undefined)?.clone() ?? new THREE.Color(0x9cb5d8)
  const baseOpacity = (mesh.userData['baseOpacity'] as number | undefined) ?? material.opacity

  if (isSelected) {
    material.color.copy(selectedAccent)
    material.opacity = Math.min(baseOpacity + 0.42, 0.72)
    if (edgeMaterial) {
      edgeMaterial.color.copy(selectedAccent.clone().lerp(new THREE.Color(0xffffff), 0.18))
      edgeMaterial.opacity = 1
    }
    return
  }

  if (isHovered) {
    material.color.copy(hoverAccent)
    material.opacity = Math.min(baseOpacity + 0.22, 0.38)
    if (edgeMaterial) {
      edgeMaterial.color.copy(hoverAccent.clone().lerp(new THREE.Color(0xffffff), 0.2))
      edgeMaterial.opacity = 0.96
    }
    return
  }

  material.color.copy(baseColor)
  material.opacity = baseOpacity
  if (edgeMaterial) {
    edgeMaterial.color.copy(createEdgeColor(baseColor))
    edgeMaterial.opacity = 0.72
  }
}

function clearInteractionState(
  hoveredMeshRef: React.MutableRefObject<THREE.Mesh | null>,
  selectedMeshRef: React.MutableRefObject<THREE.Mesh | null>,
) {
  applyInteractionStyles(
    [hoveredMeshRef.current, selectedMeshRef.current],
    { current: null },
    { current: null },
  )

  hoveredMeshRef.current = null
  selectedMeshRef.current = null
}


function createSurfaceColor(source: THREE.Color, theme: ThemeMode): THREE.Color {
  // Preserve the original IFC hue while shifting lightness toward the active
  // viewer theme so plan geometry remains readable on both canvases.
  const hsl = { h: 0, s: 0, l: 0 }
  source.getHSL(hsl)
  const l = theme === 'dark'
    ? THREE.MathUtils.clamp(hsl.l + 0.45, 0.72, 0.96)
    : THREE.MathUtils.clamp(hsl.l - 0.08, 0.34, 0.62)
  const s = hsl.s * 0.35
  return new THREE.Color().setHSL(hsl.h, s, l)
}

function createEdgeColor(source: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 }
  source.getHSL(hsl)
  return new THREE.Color().setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l - 0.28, 0.18, 0.72))
}

function disposeSceneObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      object.geometry.dispose()

      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose())
      } else {
        object.material.dispose()
      }
    }
  })
}

function readViewerBackgroundColor(): THREE.Color {
  const viewerBackground = getComputedStyle(document.documentElement)
    .getPropertyValue('--viewer-bg')
    .trim()

  return new THREE.Color(viewerBackground || '#040609')
}
