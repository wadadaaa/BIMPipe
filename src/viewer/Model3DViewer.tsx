import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Riser, Storey, StoreyId } from '@/domain/types'
import { getIfcApi } from '@/shared/ifc/ifcApi'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import './Model3DViewer.css'

interface Model3DViewerProps {
  webIfcModelId: number
  storeys: Storey[]
  /** All risers across all floors. */
  risers: Riser[]
  onSwitch2D: () => void
}

// Tints per floor level, cycling through blue-cyan palette
const FLOOR_TINTS = [
  new THREE.Color(0x67ddff),
  new THREE.Color(0x4facff),
  new THREE.Color(0x44c8f5),
  new THREE.Color(0x5bcfe8),
  new THREE.Color(0x3daed0),
  new THREE.Color(0x7ad8ff),
]
const FILL_OPACITY = 0.04
const WIRE_OPACITY = 0.32
const RISER_COLOR = new THREE.Color(0xffb45f)

// ─────────────────────────────────────────────────────────────────────────────

export function Model3DViewer({
  webIfcModelId,
  storeys,
  risers,
  onSwitch2D,
}: Model3DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const frameIdRef = useRef<number>(0)
  const floorGroupRef = useRef<THREE.Group | null>(null)
  const riserGroupRef = useRef<THREE.Group | null>(null)
  const buildingBoxRef = useRef<THREE.Box3 | null>(null)
  const storeyYCentersRef = useRef<Map<StoreyId, number>>(new Map())
  const risersRef = useRef(risers)

  const [loadedCount, setLoadedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  risersRef.current = risers

  // ── Scene setup (mount once) ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const w = canvas.clientWidth || 800
    const h = canvas.clientHeight || 600

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x05070d, 1)
    renderer.sortObjects = true

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070d)

    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 2_000_000)
    camera.position.set(0, 50000, 100000)
    camera.lookAt(0, 10000, 0)

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 500
    controls.maxDistance = 1_500_000

    rendererRef.current = renderer
    cameraRef.current = camera
    controlsRef.current = controls
    sceneRef.current = scene

    let running = true
    const animate = () => {
      if (!running) return
      frameIdRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })
    ro.observe(canvas)

    return () => {
      running = false
      cancelAnimationFrame(frameIdRef.current)
      if (floorGroupRef.current) {
        scene.remove(floorGroupRef.current)
        disposeGroup(floorGroupRef.current)
        floorGroupRef.current = null
      }
      if (riserGroupRef.current) {
        scene.remove(riserGroupRef.current)
        disposeGroup(riserGroupRef.current)
        riserGroupRef.current = null
      }
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
    }
  }, [])

  // ── Geometry loading ──────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!scene || !camera || !controls || storeys.length === 0) return
    const activeScene: THREE.Scene = scene
    // Capture non-null for use inside async closure
    const activeCamera: THREE.PerspectiveCamera = camera
    const activeControls: OrbitControls = controls

    let cancelled = false

    // Clear previous geometry and its dependent riser overlay.
    if (floorGroupRef.current) {
      scene.remove(floorGroupRef.current)
      disposeGroup(floorGroupRef.current)
      floorGroupRef.current = null
    }
    if (riserGroupRef.current) {
      scene.remove(riserGroupRef.current)
      disposeGroup(riserGroupRef.current)
      riserGroupRef.current = null
    }
    const floorRoot = new THREE.Group()
    scene.add(floorRoot)
    floorGroupRef.current = floorRoot
    buildingBoxRef.current = null
    storeyYCentersRef.current = new Map()

    setIsLoading(true)
    setLoadedCount(0)
    setError(null)

    async function load() {
      try {
        const api = await getIfcApi()
        const combinedBox = new THREE.Box3()
        // Sort storeys bottom-to-top so tint indices go upwards
        const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation)
        const storeyYCenters = new Map<StoreyId, number>()

        for (let i = 0; i < sorted.length; i++) {
          if (cancelled) return

          const { group, boundingBox } = await extractFloorMeshes(
            api,
            webIfcModelId,
            sorted[i].id,
          )
          if (cancelled) { disposeGroup(group); return }

          const tint = FLOOR_TINTS[i % FLOOR_TINTS.length]
          // Merge all element geometries → 2 draw calls per floor instead of hundreds
          buildWirefloor(group, floorRoot, tint)
          // Source meshes no longer needed; free WASM-backed buffers
          disposeGroup(group)

          // Record geometry-derived Y center so risers can reference real 3D coords
          if (!boundingBox.isEmpty()) {
            storeyYCenters.set(sorted[i].id, (boundingBox.min.y + boundingBox.max.y) / 2)
          }

          combinedBox.union(boundingBox)
          setLoadedCount(i + 1)

          // Yield to the browser so the canvas re-renders and the UI stays responsive
          await yieldFrame()
        }

        if (cancelled) return

        buildingBoxRef.current = combinedBox.isEmpty() ? null : combinedBox.clone()
        storeyYCentersRef.current = storeyYCenters
        replaceRiserGroup(
          activeScene,
          riserGroupRef,
          buildingBoxRef.current,
          storeyYCentersRef.current,
          risersRef.current,
        )
        if (!combinedBox.isEmpty()) fitCamera(activeCamera, activeControls, combinedBox)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load 3D geometry.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [webIfcModelId, storeys])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    replaceRiserGroup(
      scene,
      riserGroupRef,
      buildingBoxRef.current,
      storeyYCentersRef.current,
      risers,
    )
  }, [risers])

  return (
    <div className="model-3d-viewer">
      <canvas ref={canvasRef} className="model-3d-viewer__canvas" />

      {/* ── HUD ── */}
      <div className="model-3d-viewer__hud">
        <span className="model-3d-viewer__chip model-3d-viewer__chip--accent">3D</span>
        {isLoading ? (
          <span className="model-3d-viewer__chip">
            Loading {loadedCount}/{storeys.length} floors…
          </span>
        ) : (
          <>
            <span className="model-3d-viewer__chip">{storeys.length} floors</span>
            {risers.length > 0 && (
              <span className="model-3d-viewer__chip model-3d-viewer__chip--riser">
                {countStacks(risers)} risers
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Toolbar ── */}
      <div className="model-3d-viewer__toolbar">
        <button
          className="model-3d-viewer__btn"
          onClick={onSwitch2D}
          title="Switch to floor plan view"
        >
          2D
        </button>
      </div>

      {/* ── Hint ── */}
      {!isLoading && !error && (
        <div className="model-3d-viewer__hint">
          Drag to orbit · Scroll to zoom · Right-click to pan
        </div>
      )}

      {error && (
        <div className="model-3d-viewer__overlay">
          <div className="model-3d-viewer__overlay-card">
            <span className="model-3d-viewer__overlay-kicker">Error</span>
            {error}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Core rendering helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges all element meshes in `sourceGroup` into a single BufferGeometry,
 * then creates one transparent-fill Mesh and one LineSegments (EdgesGeometry)
 * per floor — 2 draw calls total instead of hundreds.
 *
 * Each source mesh has its IFC placement transform baked into its geometry
 * via `applyMatrix4`, so we reconstruct that transform from position/quaternion/scale.
 */
function buildWirefloor(
  sourceGroup: THREE.Group,
  targetGroup: THREE.Group,
  tint: THREE.Color,
): void {
  const clones: THREE.BufferGeometry[] = []

  sourceGroup.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    const g = obj.geometry.clone()
    // Bake the mesh's local transform (set by extractFloorMeshes via applyMatrix4)
    const m = new THREE.Matrix4().compose(obj.position, obj.quaternion, obj.scale)
    g.applyMatrix4(m)
    clones.push(g)
  })

  if (clones.length === 0) return

  // Single merged geometry — dramatically reduces draw calls + EdgesGeometry work
  const merged = mergeGeometries(clones, false)
  clones.forEach((g) => g.dispose())
  if (!merged) return

  // Transparent fill for depth cues
  targetGroup.add(
    new THREE.Mesh(
      merged,
      new THREE.MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity: FILL_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )

  // Clean structural edges (20° threshold filters out smooth curved faces)
  targetGroup.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(merged, 20),
      new THREE.LineBasicMaterial({
        color: tint,
        transparent: true,
        opacity: WIRE_OPACITY,
      }),
    ),
  )
}

/**
 * Draws an orange cylinder for each riser stack spanning from 2m below the
 * lowest floor to 2m above the roof, with a sphere at each floor junction.
 * Pipe radius is auto-scaled to ~0.6% of the building footprint.
 *
 * `storeyYCenters` maps storey IDs → geometry-derived Y midpoint so that
 * junction spheres sit at the correct elevation in Three.js world space.
 */
function buildRiserPipes(
  targetGroup: THREE.Group,
  risers: Riser[],
  buildingBox: THREE.Box3,
  storeyYCenters: Map<StoreyId, number>,
): void {
  const size = buildingBox.getSize(new THREE.Vector3())
  const buildingHeight = size.y
  const numStoreys = storeyYCenters.size || 1
  // Extend ~2/3 of a typical floor height (building height / storeys) above + below
  const extension = (buildingHeight / numStoreys) * 0.67

  const pipeYMin = buildingBox.min.y - extension
  const pipeYMax = buildingBox.max.y + extension
  const pipeH = pipeYMax - pipeYMin

  const pipeR = Math.max(size.x, size.z) * 0.006
  const sphereR = pipeR * 1.8

  const mat = new THREE.MeshBasicMaterial({ color: RISER_COLOR })
  const sphereGeo = new THREE.SphereGeometry(sphereR, 10, 8)

  // Group by stack
  const byStack = new Map<string, Riser[]>()
  for (const r of risers) {
    const list = byStack.get(r.stackId) ?? []
    list.push(r)
    byStack.set(r.stackId, list)
  }

  for (const [, stack] of byStack) {
    // Riser XZ position comes from plan coords — these are correct in IFC space
    const x = stack[0].position.x
    const z = stack[0].position.z

    // Single pipe spanning full building height + extension
    if (pipeH > 0) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(pipeR, pipeR, pipeH, 12),
        mat,
      )
      pipe.position.set(x, (pipeYMin + pipeYMax) / 2, z)
      targetGroup.add(pipe)
    }

    // Junction sphere at each floor's geometry-derived Y midpoint
    const fallbackY = (pipeYMin + pipeYMax) / 2
    for (const r of stack) {
      const y = storeyYCenters.get(r.storeyId) ?? fallbackY
      const sphere = new THREE.Mesh(sphereGeo, mat)
      sphere.position.set(x, y, z)
      targetGroup.add(sphere)
    }
  }
}

/**
 * Positions the perspective camera at an isometric 3/4 angle framing the
 * full stacked model, and updates OrbitControls near/far + target.
 */
function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
): void {
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  const hSpan = Math.max(size.x, size.z)
  const vSpan = size.y
  const fovRad = (camera.fov * Math.PI) / 180
  const dist = (hSpan / 2 / Math.tan(fovRad / 2)) * 1.5

  camera.position.set(
    center.x + dist * 0.55,
    center.y + vSpan * 0.5 + dist * 0.25,
    center.z + dist * 0.85,
  )
  camera.lookAt(center)
  camera.near = dist * 0.001
  camera.far = dist * 10
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.minDistance = dist * 0.05
  controls.maxDistance = dist * 8
  controls.update()
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Yields one frame to the browser (renders in-progress floors, keeps UI alive). */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function disposeGroup(group: THREE.Group): void {
  const seenGeos = new Set<THREE.BufferGeometry>()
  const seenMats = new Set<THREE.Material>()

  group.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.Line
    ) {
      if (obj.geometry && !seenGeos.has(obj.geometry)) {
        obj.geometry.dispose()
        seenGeos.add(obj.geometry)
      }
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (m && !seenMats.has(m)) {
          m.dispose()
          seenMats.add(m)
        }
      }
    }
  })
}

function countStacks(risers: Riser[]): number {
  return new Set(risers.map((r) => r.stackId)).size
}

function replaceRiserGroup(
  scene: THREE.Scene,
  riserGroupRef: MutableRefObject<THREE.Group | null>,
  buildingBox: THREE.Box3 | null,
  storeyYCenters: Map<StoreyId, number>,
  risers: Riser[],
): void {
  if (riserGroupRef.current) {
    scene.remove(riserGroupRef.current)
    disposeGroup(riserGroupRef.current)
    riserGroupRef.current = null
  }

  if (!buildingBox || buildingBox.isEmpty() || risers.length === 0) return

  const riserGroup = new THREE.Group()
  buildRiserPipes(riserGroup, risers, buildingBox, storeyYCenters)
  scene.add(riserGroup)
  riserGroupRef.current = riserGroup
}
