import type { PlanBounds, StoreyId } from '@/domain/types'

/**
 * Vertical continuity map (W5).
 *
 * Pure domain module: given simplified per-storey architecture geometry
 * (footprints of walls / columns / slab solids, slab openings and other
 * vertical voids, and named spaces), it computes:
 *
 *  1. a per-storey obstruction grid (cells blocked by walls/columns/slab
 *     solids), and
 *  2. shaft candidates: slab openings, shaft-named spaces (Hebrew "פיר",
 *     English "shaft"), and vertical voids whose XY footprints align across
 *     at least {@link MIN_ALIGNED_VOID_STOREYS} consecutive storeys.
 *
 * The IFC → input adaptation lives in
 * `src/shared/ifc/extractContinuityInputs.ts`; nothing in this file touches
 * web-ifc.
 *
 * Coordinate convention: the plan plane is (x, z) in the same frame as
 * `Fixture.position` (see `src/shared/routes/planGeometry.ts`); all lengths
 * are in {@link ContinuityMapInput.units} — never assumed, always passed in.
 */

// ---------------------------------------------------------------------------
// Constants (mm/m pairs, per AGENTS.md unit rules)
// ---------------------------------------------------------------------------

/** Default obstruction-grid cell size (~25 cm). */
export const CONTINUITY_CELL_SIZE_MM = 250
export const CONTINUITY_CELL_SIZE_M = 0.25

/**
 * Max plan distance between void centres on consecutive storeys for the voids
 * to count as the same vertical shaft.
 */
export const SHAFT_ALIGNMENT_TOLERANCE_MM = 300
export const SHAFT_ALIGNMENT_TOLERANCE_M = 0.3

/** Minimum number of consecutive storeys an aligned void must span. */
export const MIN_ALIGNED_VOID_STOREYS = 3

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type LengthUnit = 'mm' | 'm'

/** A point on the plan plane (viewer plan axes: x across, z down-plan). */
export interface PlanPoint {
  x: number
  z: number
}

/** Simplified 2D footprint of an element: either a plan bbox or a polygon. */
export type PlanFootprint =
  | { shape: 'bbox'; bounds: PlanBounds }
  | { shape: 'polygon'; points: PlanPoint[] }

export type ContinuityObstructionKind = 'wall' | 'column' | 'slab'

export interface ContinuityObstructionInput {
  /** Stable, deterministic id (e.g. `wall:1234`). */
  id: string
  kind: ContinuityObstructionKind
  footprint: PlanFootprint
}

export type ContinuityVoidKind = 'slab-opening' | 'void'

export interface ContinuityVoidInput {
  /** Stable, deterministic id (e.g. `opening:1234`). */
  id: string
  /**
   * 'slab-opening' voids become shaft candidates on their own storey;
   * generic 'void' entries only surface via vertical alignment (≥3 storeys).
   */
  kind: ContinuityVoidKind
  footprint: PlanFootprint
}

export interface ContinuitySpaceInput {
  /** Stable, deterministic id (e.g. `space:1234`). */
  id: string
  /** Raw space name from the model (any language / direction), untranslated. */
  name: string
  /** Null when the space has no usable geometry. */
  footprint: PlanFootprint | null
}

export interface ContinuityStoreyInput {
  storeyId: StoreyId
  /** Raw storey name for overlay labels (rendered with dir="auto" later). */
  storeyName: string
  /** Storey elevation in `units`, informational for the overlay. */
  elevation: number
  obstructions: ContinuityObstructionInput[]
  voids: ContinuityVoidInput[]
  spaces: ContinuitySpaceInput[]
}

export interface ContinuityMapInput {
  /** Length unit of every coordinate in this input. Never assumed. */
  units: LengthUnit
  /**
   * Storeys ordered bottom-to-top. "Consecutive storeys" for vertical-void
   * alignment means adjacent entries of this array.
   */
  storeys: ContinuityStoreyInput[]
}

export interface ContinuityMapOptions {
  /** Grid cell size in input units. Defaults to the ~25 cm constant pair. */
  cellSize?: number
  /** Alignment tolerance in input units. Defaults to the 30 cm constant pair. */
  alignmentTolerance?: number
  /** Minimum consecutive storeys for aligned voids. Default 3. */
  minAlignedStoreys?: number
}

// ---------------------------------------------------------------------------
// Output types — this is the public contract the future 2D debug overlay
// will consume. Everything the overlay needs is here: grid origin / cell size
// / blocked cells per storey, and shaft-candidate polygons/centres with the
// storey ids they belong to.
// ---------------------------------------------------------------------------

export interface StoreyObstructionGrid {
  storeyId: StoreyId
  storeyName: string
  /** Plan position of the minimum corner of cell (col 0, row 0). */
  origin: PlanPoint
  /** Cell edge length in map units (see {@link ContinuityMap.units}). */
  cellSize: number
  /** Cell count along plan x. */
  columns: number
  /** Cell count along plan z. */
  rows: number
  /**
   * Row-major blocked flags, one byte per cell: index = row * columns + col,
   * value 1 = blocked, 0 = free. A cell is blocked when a wall or column
   * intersects it, or when a slab covers it and no void (slab opening /
   * vertical void) contains the cell centre — i.e. slab inputs describe the
   * slab extents and voids carve the openings back out ("slab solid").
   */
  blocked: Uint8Array
}

export type ShaftCandidateSource = 'slab-opening' | 'shaft-named-space' | 'aligned-void'

export interface ShaftCandidate {
  /** Deterministic id derived from source + storey + element ids. */
  id: string
  source: ShaftCandidateSource
  /** Plan centre — the snap target position. */
  center: PlanPoint
  /** Plan bbox (union across storeys for aligned voids). */
  bounds: PlanBounds
  /** Original footprint polygon when the source had one, else null. */
  polygon: PlanPoint[] | null
  /**
   * Storeys on which this candidate is present, in bottom-to-top input order.
   * Single entry for per-storey sources; ≥3 entries for aligned voids.
   */
  storeyIds: StoreyId[]
  /** Raw matched space name (shaft-named spaces only) for overlay labels. */
  name?: string
}

export interface ContinuityMap {
  /** Length unit of every coordinate and size in this map. */
  units: LengthUnit
  /** Cell size actually used, in `units`. */
  cellSize: number
  /** One grid per input storey, in input (bottom-to-top) order. */
  grids: StoreyObstructionGrid[]
  /** All shaft candidates, sorted by id (deterministic). */
  shaftCandidates: ShaftCandidate[]
  /**
   * Human-readable notes about inputs that could not be used (e.g. a
   * shaft-named space without geometry). Never silently dropped.
   */
  diagnostics: string[]
}

// ---------------------------------------------------------------------------
// Shaft-name matching
// ---------------------------------------------------------------------------

/** Unicode bidi control characters (LRM/RLM, embeddings, overrides, isolates). */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

const HEBREW_SHAFT_TOKEN = /^ה?פיר(?:ים)?$/u

/**
 * True when a space name looks like a vertical shaft.
 *
 * Matching is case-insensitive and direction-agnostic (bidi control marks are
 * stripped first). The name is split into letter tokens; a token matches when
 * it starts with "shaft" (shaft, shafts, SHAFT-3 …) or is the Hebrew word
 * "פיר" / "פירים" (optionally with the definite article "ה").
 * This is a heuristic: exotic compounds may be missed.
 */
export function isShaftLikeName(name: string): boolean {
  const cleaned = name.replace(BIDI_CONTROLS, '').toLowerCase()
  const tokens = cleaned.split(/[^\p{L}]+/u).filter((token) => token.length > 0)
  return tokens.some((token) => token.startsWith('shaft') || HEBREW_SHAFT_TOKEN.test(token))
}

// ---------------------------------------------------------------------------
// Footprint geometry helpers (pure, deterministic)
// ---------------------------------------------------------------------------

export function footprintBounds(footprint: PlanFootprint): PlanBounds {
  if (footprint.shape === 'bbox') return { ...footprint.bounds }

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of footprint.points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.z < minZ) minZ = point.z
    if (point.z > maxZ) maxZ = point.z
  }
  return { minX, maxX, minZ, maxZ }
}

export function footprintCenter(footprint: PlanFootprint): PlanPoint {
  const bounds = footprintBounds(footprint)
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
}

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

function pointInRect(point: PlanPoint, rect: Rect): boolean {
  return (
    point.x >= rect.minX && point.x <= rect.maxX &&
    point.z >= rect.minZ && point.z <= rect.maxZ
  )
}

/** Ray-casting point-in-polygon on the plan plane. Boundary behaviour is deterministic. */
function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function orientation(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  const value = (b.z - a.z) * (c.x - b.x) - (b.x - a.x) * (c.z - b.z)
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

function onSegment(a: PlanPoint, b: PlanPoint, p: PlanPoint): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.z, b.z) <= p.z && p.z <= Math.max(a.z, b.z)
  )
}

function segmentsIntersect(p1: PlanPoint, p2: PlanPoint, q1: PlanPoint, q2: PlanPoint): boolean {
  const o1 = orientation(p1, p2, q1)
  const o2 = orientation(p1, p2, q2)
  const o3 = orientation(q1, q2, p1)
  const o4 = orientation(q1, q2, p2)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, q1)) return true
  if (o2 === 0 && onSegment(p1, p2, q2)) return true
  if (o3 === 0 && onSegment(q1, q2, p1)) return true
  if (o4 === 0 && onSegment(q1, q2, p2)) return true
  return false
}

function rectCorners(rect: Rect): PlanPoint[] {
  return [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ },
  ]
}

function polygonIntersectsRect(polygon: PlanPoint[], rect: Rect): boolean {
  for (const vertex of polygon) {
    if (pointInRect(vertex, rect)) return true
  }
  const corners = rectCorners(rect)
  for (const corner of corners) {
    if (pointInPolygon(corner, polygon)) return true
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    for (let c = 0; c < 4; c++) {
      if (segmentsIntersect(polygon[j], polygon[i], corners[c], corners[(c + 1) % 4])) {
        return true
      }
    }
  }
  return false
}

function footprintIntersectsRect(footprint: PlanFootprint, rect: Rect): boolean {
  if (footprint.shape === 'bbox') return rectsOverlap(footprint.bounds, rect)
  if (footprint.points.length < 3) return false
  if (!rectsOverlap(footprintBounds(footprint), rect)) return false
  return polygonIntersectsRect(footprint.points, rect)
}

// ---------------------------------------------------------------------------
// Grid construction and lookup
// ---------------------------------------------------------------------------

/** Plan centre of a grid cell. */
export function cellCenter(grid: StoreyObstructionGrid, col: number, row: number): PlanPoint {
  return {
    x: grid.origin.x + (col + 0.5) * grid.cellSize,
    z: grid.origin.z + (row + 0.5) * grid.cellSize,
  }
}

export function isCellBlocked(grid: StoreyObstructionGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return true
  return grid.blocked[row * grid.columns + col] === 1
}

function buildObstructionGrid(
  storey: ContinuityStoreyInput,
  cellSize: number,
): StoreyObstructionGrid {
  const allFootprints: PlanFootprint[] = [
    ...storey.obstructions.map((o) => o.footprint),
    ...storey.voids.map((v) => v.footprint),
    ...storey.spaces.flatMap((s) => (s.footprint ? [s.footprint] : [])),
  ]

  if (allFootprints.length === 0) {
    return {
      storeyId: storey.storeyId,
      storeyName: storey.storeyName,
      origin: { x: 0, z: 0 },
      cellSize,
      columns: 0,
      rows: 0,
      blocked: new Uint8Array(0),
    }
  }

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const footprint of allFootprints) {
    const bounds = footprintBounds(footprint)
    if (bounds.minX < minX) minX = bounds.minX
    if (bounds.maxX > maxX) maxX = bounds.maxX
    if (bounds.minZ < minZ) minZ = bounds.minZ
    if (bounds.maxZ > maxZ) maxZ = bounds.maxZ
  }

  // Pad the grid by one cell on every side so snapping has room at the edges.
  const origin: PlanPoint = { x: minX - cellSize, z: minZ - cellSize }
  const columns = Math.max(1, Math.ceil((maxX - origin.x) / cellSize)) + 1
  const rows = Math.max(1, Math.ceil((maxZ - origin.z) / cellSize)) + 1

  const rasterize = (footprint: PlanFootprint, mark: (cellIndex: number) => void) => {
    const bounds = footprintBounds(footprint)
    const colStart = Math.max(0, Math.floor((bounds.minX - origin.x) / cellSize))
    const colEnd = Math.min(columns - 1, Math.floor((bounds.maxX - origin.x) / cellSize))
    const rowStart = Math.max(0, Math.floor((bounds.minZ - origin.z) / cellSize))
    const rowEnd = Math.min(rows - 1, Math.floor((bounds.maxZ - origin.z) / cellSize))

    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const cellRect: Rect = {
          minX: origin.x + col * cellSize,
          maxX: origin.x + (col + 1) * cellSize,
          minZ: origin.z + row * cellSize,
          maxZ: origin.z + (row + 1) * cellSize,
        }
        if (footprintIntersectsRect(footprint, cellRect)) mark(row * columns + col)
      }
    }
  }

  // Walls and columns block outright; slabs block only where no void opens them.
  const hardBlocked = new Uint8Array(columns * rows)
  const slabBlocked = new Uint8Array(columns * rows)
  for (const obstruction of storey.obstructions) {
    const target = obstruction.kind === 'slab' ? slabBlocked : hardBlocked
    rasterize(obstruction.footprint, (cellIndex) => {
      target[cellIndex] = 1
    })
  }

  // A void re-opens a slab cell only when it contains the cell centre, so
  // partially covered edge cells stay conservative (blocked).
  const voidCovered = new Uint8Array(columns * rows)
  for (const voidInput of storey.voids) {
    rasterize(voidInput.footprint, (cellIndex) => {
      const row = Math.floor(cellIndex / columns)
      const col = cellIndex % columns
      const center: PlanPoint = {
        x: origin.x + (col + 0.5) * cellSize,
        z: origin.z + (row + 0.5) * cellSize,
      }
      const inside =
        voidInput.footprint.shape === 'bbox'
          ? pointInRect(center, voidInput.footprint.bounds)
          : pointInPolygon(center, voidInput.footprint.points)
      if (inside) voidCovered[cellIndex] = 1
    })
  }

  const blocked = new Uint8Array(columns * rows)
  for (let cellIndex = 0; cellIndex < blocked.length; cellIndex++) {
    blocked[cellIndex] =
      hardBlocked[cellIndex] === 1 ||
      (slabBlocked[cellIndex] === 1 && voidCovered[cellIndex] === 0)
        ? 1
        : 0
  }

  return {
    storeyId: storey.storeyId,
    storeyName: storey.storeyName,
    origin,
    cellSize,
    columns,
    rows,
    blocked,
  }
}

// ---------------------------------------------------------------------------
// Shaft candidate detection
// ---------------------------------------------------------------------------

function planDistance2D(a: PlanPoint, b: PlanPoint): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function unionBounds(a: PlanBounds, b: PlanBounds): PlanBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

function footprintPolygon(footprint: PlanFootprint): PlanPoint[] | null {
  return footprint.shape === 'polygon' ? footprint.points.map((p) => ({ ...p })) : null
}

function detectPerStoreyCandidates(
  storeys: ContinuityStoreyInput[],
  diagnostics: string[],
): ShaftCandidate[] {
  const candidates: ShaftCandidate[] = []

  for (const storey of storeys) {
    for (const voidInput of storey.voids) {
      if (voidInput.kind !== 'slab-opening') continue
      candidates.push({
        id: `slab-opening:${storey.storeyId}:${voidInput.id}`,
        source: 'slab-opening',
        center: footprintCenter(voidInput.footprint),
        bounds: footprintBounds(voidInput.footprint),
        polygon: footprintPolygon(voidInput.footprint),
        storeyIds: [storey.storeyId],
      })
    }

    for (const space of storey.spaces) {
      if (!isShaftLikeName(space.name)) continue
      if (space.footprint === null) {
        diagnostics.push(
          `Shaft-named space ${space.id} ("${space.name}") on storey ${storey.storeyId} has no usable footprint and was excluded from shaft candidates.`,
        )
        continue
      }
      candidates.push({
        id: `shaft-space:${storey.storeyId}:${space.id}`,
        source: 'shaft-named-space',
        center: footprintCenter(space.footprint),
        bounds: footprintBounds(space.footprint),
        polygon: footprintPolygon(space.footprint),
        storeyIds: [storey.storeyId],
        name: space.name,
      })
    }
  }

  return candidates
}

interface VoidRef {
  storeyIndex: number
  storeyId: StoreyId
  voidId: string
  center: PlanPoint
  bounds: PlanBounds
}

/**
 * Finds vertical voids whose plan centres stay within `alignmentTolerance` of
 * the base void across ≥ `minAlignedStoreys` consecutive storeys. Both void
 * kinds participate. Each void joins at most one chain; chains are grown
 * bottom-to-top from the lowest available base, which keeps the result
 * deterministic for identical inputs.
 */
function detectAlignedVoidCandidates(
  storeys: ContinuityStoreyInput[],
  alignmentTolerance: number,
  minAlignedStoreys: number,
): ShaftCandidate[] {
  const voidsByStorey: VoidRef[][] = storeys.map((storey, storeyIndex) =>
    [...storey.voids]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((voidInput) => ({
        storeyIndex,
        storeyId: storey.storeyId,
        voidId: voidInput.id,
        center: footprintCenter(voidInput.footprint),
        bounds: footprintBounds(voidInput.footprint),
      })),
  )

  const consumed = new Set<string>()
  const keyOf = (ref: VoidRef) => `${ref.storeyIndex}|${ref.voidId}`
  const candidates: ShaftCandidate[] = []

  for (let baseIndex = 0; baseIndex < voidsByStorey.length; baseIndex++) {
    for (const base of voidsByStorey[baseIndex]) {
      if (consumed.has(keyOf(base))) continue

      const chain: VoidRef[] = [base]
      for (let next = baseIndex + 1; next < voidsByStorey.length; next++) {
        let best: VoidRef | null = null
        let bestDistance = Infinity
        for (const candidate of voidsByStorey[next]) {
          if (consumed.has(keyOf(candidate))) continue
          const distance = planDistance2D(base.center, candidate.center)
          if (distance > alignmentTolerance) continue
          if (
            distance < bestDistance ||
            (distance === bestDistance && best !== null && candidate.voidId.localeCompare(best.voidId) < 0)
          ) {
            best = candidate
            bestDistance = distance
          }
        }
        if (best === null) break // chain must be consecutive
        chain.push(best)
      }

      if (chain.length < minAlignedStoreys) continue

      for (const member of chain) consumed.add(keyOf(member))

      const center: PlanPoint = {
        x: chain.reduce((sum, m) => sum + m.center.x, 0) / chain.length,
        z: chain.reduce((sum, m) => sum + m.center.z, 0) / chain.length,
      }
      const bounds = chain.map((m) => m.bounds).reduce(unionBounds)

      candidates.push({
        id: `aligned-void:${base.storeyId}:${base.voidId}`,
        source: 'aligned-void',
        center,
        bounds,
        polygon: null,
        storeyIds: chain.map((m) => m.storeyId),
      })
    }
  }

  return candidates
}

// ---------------------------------------------------------------------------
// Map construction
// ---------------------------------------------------------------------------

export function buildContinuityMap(
  input: ContinuityMapInput,
  options: ContinuityMapOptions = {},
): ContinuityMap {
  const cellSize =
    options.cellSize ?? (input.units === 'mm' ? CONTINUITY_CELL_SIZE_MM : CONTINUITY_CELL_SIZE_M)
  const alignmentTolerance =
    options.alignmentTolerance ??
    (input.units === 'mm' ? SHAFT_ALIGNMENT_TOLERANCE_MM : SHAFT_ALIGNMENT_TOLERANCE_M)
  const minAlignedStoreys = options.minAlignedStoreys ?? MIN_ALIGNED_VOID_STOREYS

  const diagnostics: string[] = []
  const grids = input.storeys.map((storey) => buildObstructionGrid(storey, cellSize))
  const shaftCandidates = [
    ...detectPerStoreyCandidates(input.storeys, diagnostics),
    ...detectAlignedVoidCandidates(input.storeys, alignmentTolerance, minAlignedStoreys),
  ].sort((a, b) => a.id.localeCompare(b.id))

  return { units: input.units, cellSize, grids, shaftCandidates, diagnostics }
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export type ContinuitySnapOutcome =
  | { kind: 'shaft'; shaftId: string; position: PlanPoint; distance: number }
  | { kind: 'free-cell'; cell: { col: number; row: number }; position: PlanPoint; distance: number }
  | { kind: 'miss'; reason: string }

/**
 * Snaps a plan point to the continuity map on the given storey:
 * shaft candidates within `maxSnapDistance` win over free grid cells; if
 * neither exists within range the outcome is an explicit miss with a reason
 * (never a silent no-op). `maxSnapDistance` is in map units.
 */
export function snapPointToContinuity(
  map: ContinuityMap,
  storeyId: StoreyId,
  point: PlanPoint,
  maxSnapDistance: number,
): ContinuitySnapOutcome {
  let bestShaft: ShaftCandidate | null = null
  let bestShaftDistance = Infinity
  for (const candidate of map.shaftCandidates) {
    if (!candidate.storeyIds.includes(storeyId)) continue
    const distance = planDistance2D(point, candidate.center)
    if (distance > maxSnapDistance) continue
    if (
      distance < bestShaftDistance ||
      (distance === bestShaftDistance && bestShaft !== null && candidate.id.localeCompare(bestShaft.id) < 0)
    ) {
      bestShaft = candidate
      bestShaftDistance = distance
    }
  }
  if (bestShaft !== null) {
    return {
      kind: 'shaft',
      shaftId: bestShaft.id,
      position: { ...bestShaft.center },
      distance: bestShaftDistance,
    }
  }

  const grid = map.grids.find((g) => g.storeyId === storeyId)
  if (grid === undefined) {
    return { kind: 'miss', reason: `no obstruction grid for storey ${storeyId}` }
  }
  if (grid.columns === 0 || grid.rows === 0) {
    return { kind: 'miss', reason: `obstruction grid for storey ${storeyId} is empty` }
  }

  const colFrom = Math.max(0, Math.floor((point.x - maxSnapDistance - grid.origin.x) / grid.cellSize))
  const colTo = Math.min(grid.columns - 1, Math.floor((point.x + maxSnapDistance - grid.origin.x) / grid.cellSize))
  const rowFrom = Math.max(0, Math.floor((point.z - maxSnapDistance - grid.origin.z) / grid.cellSize))
  const rowTo = Math.min(grid.rows - 1, Math.floor((point.z + maxSnapDistance - grid.origin.z) / grid.cellSize))

  let bestCell: { col: number; row: number } | null = null
  let bestCellDistance = Infinity
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      if (grid.blocked[row * grid.columns + col] === 1) continue
      const distance = planDistance2D(point, cellCenter(grid, col, row))
      if (distance > maxSnapDistance) continue
      // Row-major scan order breaks exact ties deterministically.
      if (distance < bestCellDistance) {
        bestCell = { col, row }
        bestCellDistance = distance
      }
    }
  }

  if (bestCell !== null) {
    return {
      kind: 'free-cell',
      cell: bestCell,
      position: cellCenter(grid, bestCell.col, bestCell.row),
      distance: bestCellDistance,
    }
  }

  return {
    kind: 'miss',
    reason: `no shaft candidate or free grid cell within ${maxSnapDistance} ${map.units} on storey ${storeyId}`,
  }
}
