import type { PlanBounds, StoreyId } from '@/domain/types'
import type { OfficeCoreShaftRules } from './typology'

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
  /**
   * Id of the obstruction this void cuts (`IfcRelVoidsElement` host, e.g.
   * `slab:1234`, same format as {@link ContinuityObstructionInput.id}). When
   * set: a wall-hosted opening (door / window) never carves a slab, and a slab
   * that is an INFILL of the void (its footprint lies inside the void — a
   * tower plate sitting in the cut-out of a larger plate) stays solid and the
   * filled void is not a shaft candidate. Voids without a host keep the legacy
   * behaviour and carve every slab on the storey.
   */
  hostId?: string
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
   * intersects it, or when a slab covers it and no void that applies to that
   * slab (slab openings; not wall openings, not voids the slab is an infill
   * of — see `hostId`) contains the cell centre — i.e. slab inputs describe
   * the slab extents and voids carve the openings back out ("slab solid").
   */
  blocked: Uint8Array
  /**
   * Row-major wall/column-only flags (same indexing as `blocked`), 1 = a wall
   * or column intersects the cell. Slabs never set this flag, so it measures
   * structure density independently of slab coverage (office core detection,
   * `selectOfficeCoreShafts`). Always present on grids built by
   * {@link buildContinuityMap}; optional so hand-built grids stay valid —
   * queries treat a missing array as "no structure knowledge".
   */
  structureBlocked?: Uint8Array
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
      structureBlocked: new Uint8Array(0),
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

  // A void re-opens a slab cell only when it contains the cell centre, so
  // partially covered edge cells stay conservative (blocked).
  const coverageOf = (voids: readonly ContinuityVoidInput[]): Uint8Array => {
    const covered = new Uint8Array(columns * rows)
    for (const voidInput of voids) {
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
        if (inside) covered[cellIndex] = 1
      })
    }
    return covered
  }

  // Walls and columns block outright. A slab blocks where no void that applies
  // to it (see {@link voidAppliesToSlab}) contains the cell centre.
  const hardBlocked = new Uint8Array(columns * rows)
  const slabBlocked = new Uint8Array(columns * rows)
  const infillTolerance = cellSize / 2
  for (const obstruction of storey.obstructions) {
    if (obstruction.kind !== 'slab') {
      rasterize(obstruction.footprint, (cellIndex) => {
        hardBlocked[cellIndex] = 1
      })
      continue
    }
    const applicableVoidCovered = coverageOf(
      storey.voids.filter((voidInput) => voidAppliesToSlab(voidInput, obstruction, storey, infillTolerance)),
    )
    rasterize(obstruction.footprint, (cellIndex) => {
      if (applicableVoidCovered[cellIndex] === 0) slabBlocked[cellIndex] = 1
    })
  }

  const blocked = new Uint8Array(columns * rows)
  for (let cellIndex = 0; cellIndex < blocked.length; cellIndex++) {
    blocked[cellIndex] = hardBlocked[cellIndex] === 1 || slabBlocked[cellIndex] === 1 ? 1 : 0
  }

  return {
    storeyId: storey.storeyId,
    storeyName: storey.storeyName,
    origin,
    cellSize,
    columns,
    rows,
    blocked,
    structureBlocked: hardBlocked,
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
  // Candidates are detected on the voids that are actually open: a hosted void
  // filled by another slab is not a shaft (the grid still carves its host).
  const openStoreys = input.storeys.map((storey) => withoutFilledOpenings(storey, cellSize / 2, diagnostics))
  const shaftCandidates = [
    ...detectPerStoreyCandidates(openStoreys, diagnostics),
    ...detectAlignedVoidCandidates(openStoreys, alignmentTolerance, minAlignedStoreys),
  ].sort((a, b) => a.id.localeCompare(b.id))

  return { units: input.units, cellSize, grids, shaftCandidates, diagnostics }
}

/**
 * Whether a void re-opens cells of `slab`.
 *
 *  - host-less void (legacy input): applies to every slab;
 *  - hosted by this slab: applies;
 *  - hosted by a wall / column of the storey: never applies — a door or window
 *    opening does not punch a hole in the floor;
 *  - hosted by another slab (or by an element that is not an obstruction here):
 *    applies unless `slab` is an INFILL of the void — a slab whose footprint
 *    lies inside the void footprint (a tower plate sitting in the cut-out of a
 *    larger plate, a landing inside a stair void) stays solid. A large slab of
 *    another discipline that merely overlaps a small opening (an architectural
 *    finish floor over a structural shaft opening) is still carved, as before.
 */
function voidAppliesToSlab(
  voidInput: ContinuityVoidInput,
  slab: ContinuityObstructionInput,
  storey: ContinuityStoreyInput,
  infillTolerance: number,
): boolean {
  if (voidInput.hostId === undefined || voidInput.hostId === slab.id) return true
  const host = storey.obstructions.find((obstruction) => obstruction.id === voidInput.hostId)
  if (host !== undefined && host.kind !== 'slab') return false
  return !isInfillOf(slab, voidInput, infillTolerance)
}

/** True when the slab footprint lies inside the void footprint (bounds, with tolerance). */
function isInfillOf(slab: ContinuityObstructionInput, voidInput: ContinuityVoidInput, tolerance: number): boolean {
  const slabBounds = footprintBounds(slab.footprint)
  const voidBounds = footprintBounds(voidInput.footprint)
  return (
    slabBounds.minX >= voidBounds.minX - tolerance &&
    slabBounds.maxX <= voidBounds.maxX + tolerance &&
    slabBounds.minZ >= voidBounds.minZ - tolerance &&
    slabBounds.maxZ <= voidBounds.maxZ + tolerance
  )
}

/**
 * Drops slab-hosted voids whose plan centre is covered by an infill slab (see
 * {@link voidAppliesToSlab}): the opening is filled, so it is neither a shaft
 * candidate nor an aligned-void seed. Reported in diagnostics, never silent.
 * Host-less voids (legacy inputs) are never dropped.
 */
function withoutFilledOpenings(
  storey: ContinuityStoreyInput,
  infillTolerance: number,
  diagnostics: string[],
): ContinuityStoreyInput {
  const slabs = storey.obstructions.filter((obstruction) => obstruction.kind === 'slab')
  if (slabs.length < 2) return storey
  const voids = storey.voids.filter((voidInput) => {
    if (voidInput.hostId === undefined) return true
    const center = footprintCenter(voidInput.footprint)
    const infill = slabs.find(
      (slab) =>
        slab.id !== voidInput.hostId &&
        isInfillOf(slab, voidInput, infillTolerance) &&
        footprintContainsPoint(slab.footprint, center),
    )
    if (infill === undefined) return true
    diagnostics.push(
      `Opening ${voidInput.id} (${voidInput.kind}, host ${voidInput.hostId}) on storey ${storey.storeyId} is filled by ${infill.id} at its centre and was excluded from shaft candidates.`,
    )
    return false
  })
  return voids.length === storey.voids.length ? storey : { ...storey, voids }
}

function footprintContainsPoint(footprint: PlanFootprint, point: PlanPoint): boolean {
  if (footprint.shape === 'bbox') return pointInRect(point, footprint.bounds)
  return footprint.points.length >= 3 && pointInPolygon(point, footprint.points)
}

// ---------------------------------------------------------------------------
// Cell probe
// ---------------------------------------------------------------------------

export type ContinuityCellProbe =
  | { status: 'blocked'; cell: { col: number; row: number } }
  | { status: 'free'; cell: { col: number; row: number } }
  /** No grid for the storey, an empty grid, or a point outside the grid. */
  | { status: 'unknown'; reason: string }

/**
 * Obstruction state of the grid cell containing `point` on `storeyId`.
 * Unknown is reported explicitly (never folded into free or blocked) so callers
 * decide how to treat missing data; a point outside the grid is unknown, not
 * blocked, unlike the out-of-range convention of {@link isCellBlocked} which
 * exists for neighbour scans.
 */
export function probeContinuityCell(
  map: ContinuityMap,
  storeyId: StoreyId,
  point: PlanPoint,
): ContinuityCellProbe {
  const grid = map.grids.find((candidate) => candidate.storeyId === storeyId)
  if (grid === undefined) return { status: 'unknown', reason: `no obstruction grid for storey ${storeyId}` }
  if (grid.columns === 0 || grid.rows === 0) {
    return { status: 'unknown', reason: `obstruction grid for storey ${storeyId} is empty` }
  }
  const col = Math.floor((point.x - grid.origin.x) / grid.cellSize)
  const row = Math.floor((point.z - grid.origin.z) / grid.cellSize)
  if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) {
    return { status: 'unknown', reason: `point lies outside the obstruction grid of storey ${storeyId}` }
  }
  const cell = { col, row }
  return grid.blocked[row * grid.columns + col] === 1 ? { status: 'blocked', cell } : { status: 'free', cell }
}

/**
 * Nearest free cell (by centre distance to `point`) whose centre lies inside
 * `bounds`, or null when every such cell is blocked. Row-major scan order
 * breaks exact ties deterministically.
 */
export function findFreeCellWithinBounds(
  grid: StoreyObstructionGrid,
  bounds: PlanBounds,
  point: PlanPoint,
): { cell: { col: number; row: number }; position: PlanPoint; distance: number } | null {
  if (grid.columns === 0 || grid.rows === 0) return null
  const colFrom = Math.max(0, Math.floor((bounds.minX - grid.origin.x) / grid.cellSize))
  const colTo = Math.min(grid.columns - 1, Math.floor((bounds.maxX - grid.origin.x) / grid.cellSize))
  const rowFrom = Math.max(0, Math.floor((bounds.minZ - grid.origin.z) / grid.cellSize))
  const rowTo = Math.min(grid.rows - 1, Math.floor((bounds.maxZ - grid.origin.z) / grid.cellSize))

  let best: { cell: { col: number; row: number }; position: PlanPoint; distance: number } | null = null
  for (let row = rowFrom; row <= rowTo; row++) {
    for (let col = colFrom; col <= colTo; col++) {
      if (grid.blocked[row * grid.columns + col] === 1) continue
      const center = cellCenter(grid, col, row)
      if (!pointInRect(center, bounds)) continue
      const distance = planDistance2D(point, center)
      if (best === null || distance < best.distance) {
        best = { cell: { col, row }, position: center, distance }
      }
    }
  }
  return best
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

// ---------------------------------------------------------------------------
// Structure queries (additive, G3): wall/column density and directional probes
// ---------------------------------------------------------------------------

/** Plan area of a shaft candidate footprint: polygon (shoelace) when present, else its bbox. */
export function shaftCandidatePlanArea(candidate: Pick<ShaftCandidate, 'bounds' | 'polygon'>): number {
  if (candidate.polygon !== null && candidate.polygon.length >= 3) {
    let twice = 0
    const points = candidate.polygon
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      twice += points[j].x * points[i].z - points[i].x * points[j].z
    }
    const area = Math.abs(twice) / 2
    if (area > 0) return area
  }
  return Math.max(0, candidate.bounds.maxX - candidate.bounds.minX) * Math.max(0, candidate.bounds.maxZ - candidate.bounds.minZ)
}

/** Longest / shortest bbox side of a candidate; Infinity for a degenerate footprint. */
export function shaftCandidateAspectRatio(candidate: Pick<ShaftCandidate, 'bounds'>): number {
  const width = candidate.bounds.maxX - candidate.bounds.minX
  const depth = candidate.bounds.maxZ - candidate.bounds.minZ
  const shortSide = Math.min(width, depth)
  if (shortSide <= 0) return Infinity
  return Math.max(width, depth) / shortSide
}

/**
 * Plan distance from `origin` to the centre of the first wall/column cell met
 * when walking along `axis` in direction `sign`, up to `maxDistance` (map
 * units). null when no structure is met, when the grid has no
 * `structureBlocked` array, or when the origin lies outside the grid. Cells
 * outside the grid stop the walk (null): the edge of the modelled floor is not
 * a wall.
 */
export function probeStructureAlongAxis(
  grid: StoreyObstructionGrid,
  origin: PlanPoint,
  axis: 'x' | 'z',
  sign: 1 | -1,
  maxDistance: number,
): number | null {
  const structure = grid.structureBlocked
  if (structure === undefined || grid.columns === 0 || grid.rows === 0) return null
  let col = Math.floor((origin.x - grid.origin.x) / grid.cellSize)
  let row = Math.floor((origin.z - grid.origin.z) / grid.cellSize)
  if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return null
  const steps = Math.ceil(maxDistance / grid.cellSize)
  for (let step = 0; step <= steps; step++) {
    if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return null
    if (structure[row * grid.columns + col] === 1) {
      const center = cellCenter(grid, col, row)
      const distance = axis === 'x' ? Math.abs(center.x - origin.x) : Math.abs(center.z - origin.z)
      return distance <= maxDistance ? distance : null
    }
    if (axis === 'x') col += sign
    else row += sign
  }
  return null
}

/** A connected patch of grid windows whose wall/column density reaches the threshold. */
export interface DenseStructureCluster {
  /** `dense-structure:<storeyId>:<index>` in row-major order of the first dense window. */
  id: string
  storeyId: StoreyId
  /** Plan bbox of the dense window centres (map units). */
  bounds: PlanBounds
  center: PlanPoint
  /** Number of dense window centres in the cluster. */
  windowCount: number
  /** Highest window density observed in the cluster (0–1). */
  peakDensity: number
}

/**
 * Finds core-like patches of structure: square windows of `windowSize` (map
 * units) whose fraction of wall/column cells (`structureBlocked`; slabs never
 * count) is ≥ `minDensity`, merged into 4-connected clusters. Deterministic
 * (row-major). Empty when the grid carries no structure knowledge.
 */
export function findDenseStructureClusters(
  grid: StoreyObstructionGrid,
  windowSize: number,
  minDensity: number,
): DenseStructureCluster[] {
  const structure = grid.structureBlocked
  if (structure === undefined || grid.columns === 0 || grid.rows === 0) return []
  const window = Math.max(1, Math.round(windowSize / grid.cellSize))
  if (window > grid.columns || window > grid.rows) return []
  const { columns, rows } = grid

  // Summed-area table (one extra row/column of zeros).
  const sat = new Uint32Array((columns + 1) * (rows + 1))
  for (let row = 1; row <= rows; row++) {
    let rowSum = 0
    for (let col = 1; col <= columns; col++) {
      rowSum += structure[(row - 1) * columns + (col - 1)]
      sat[row * (columns + 1) + col] = sat[(row - 1) * (columns + 1) + col] + rowSum
    }
  }
  const windowSum = (col0: number, row0: number): number => {
    const col1 = col0 + window
    const row1 = row0 + window
    const w = columns + 1
    return sat[row1 * w + col1] - sat[row0 * w + col1] - sat[row1 * w + col0] + sat[row0 * w + col0]
  }

  // Density per window, stored at the window's centre cell.
  const denseCols = columns - window + 1
  const denseRows = rows - window + 1
  const density = new Float32Array(denseCols * denseRows)
  const dense = new Uint8Array(denseCols * denseRows)
  const cellsPerWindow = window * window
  for (let row0 = 0; row0 < denseRows; row0++) {
    for (let col0 = 0; col0 < denseCols; col0++) {
      const value = windowSum(col0, row0) / cellsPerWindow
      density[row0 * denseCols + col0] = value
      if (value >= minDensity) dense[row0 * denseCols + col0] = 1
    }
  }

  // 4-connected components over dense windows (iterative flood fill).
  const visited = new Uint8Array(denseCols * denseRows)
  const clusters: DenseStructureCluster[] = []
  const half = window / 2
  for (let start = 0; start < dense.length; start++) {
    if (dense[start] === 0 || visited[start] === 1) continue
    const stack = [start]
    visited[start] = 1
    let minCol = Infinity
    let maxCol = -Infinity
    let minRow = Infinity
    let maxRow = -Infinity
    let sumCol = 0
    let sumRow = 0
    let count = 0
    let peak = 0
    while (stack.length > 0) {
      const index = stack.pop()!
      const col = index % denseCols
      const row = Math.floor(index / denseCols)
      minCol = Math.min(minCol, col)
      maxCol = Math.max(maxCol, col)
      minRow = Math.min(minRow, row)
      maxRow = Math.max(maxRow, row)
      sumCol += col
      sumRow += row
      count += 1
      peak = Math.max(peak, density[index])
      const neighbours = [
        col > 0 ? index - 1 : -1,
        col < denseCols - 1 ? index + 1 : -1,
        row > 0 ? index - denseCols : -1,
        row < denseRows - 1 ? index + denseCols : -1,
      ]
      for (const next of neighbours) {
        if (next < 0 || dense[next] === 0 || visited[next] === 1) continue
        visited[next] = 1
        stack.push(next)
      }
    }
    // Window (col0,row0) covers cells [col0, col0+window); its centre is col0 + window/2.
    const toX = (col: number) => grid.origin.x + (col + half) * grid.cellSize
    const toZ = (row: number) => grid.origin.z + (row + half) * grid.cellSize
    clusters.push({
      id: `dense-structure:${grid.storeyId}:${clusters.length}`,
      storeyId: grid.storeyId,
      bounds: { minX: toX(minCol), maxX: toX(maxCol), minZ: toZ(minRow), maxZ: toZ(maxRow) },
      center: { x: toX(sumCol / count), z: toZ(sumRow / count) },
      windowCount: count,
      peakDensity: peak,
    })
  }
  return clusters
}

// ---------------------------------------------------------------------------
// Office core-shaft selection (G3)
// ---------------------------------------------------------------------------

/** Rules for {@link selectOfficeCoreShafts}, all in METRES (converted to map units internally); see `typology.ts`. */
export type OfficeCoreShaftSelectionRules = OfficeCoreShaftRules

/** A stair / lift / atrium void used as a core anchor (never as a stack target). */
export interface LargeVoidAnchor {
  candidateId: string
  center: PlanPoint
  bounds: PlanBounds
  areaM2: number
  /** True for `aligned-void` candidates (repeats on ≥ 3 storeys); false for a single-storey opening. */
  repeating: boolean
}

export type OfficeCoreShaftRejection =
  | 'area-below-min'
  | 'area-above-max'
  | 'aspect-above-max'
  | 'outside-core-radius'

export interface OfficeCoreShaftCandidate {
  candidate: ShaftCandidate
  areaM2: number
  aspectRatio: number
  /** Passed the shaft-like footprint window (area + aspect). */
  shaftLike: boolean
  /** Plan distance (m) from the candidate centre to the nearest dense-structure cluster bounds; null when none exists. */
  distanceToDenseStructureM: number | null
  /** Plan distance (m) from the candidate centre to the nearest stair/lift void bounds; null when none exists. */
  distanceToLargeVoidM: number | null
  /** Which core anchor put it in range (the nearer one), null when out of range. */
  coreAnchor: 'dense-structure' | 'stair-lift-void' | null
  selected: boolean
  rejection: OfficeCoreShaftRejection | null
  reason: string
}

export interface OfficeCoreShaftSelection {
  storeyId: StoreyId
  units: LengthUnit
  /** Every shaft candidate on the storey, sorted by id, with its verdict. */
  candidates: OfficeCoreShaftCandidate[]
  /** The selected core shafts (subset of `candidates`), sorted by id. */
  selected: ShaftCandidate[]
  denseClusters: DenseStructureCluster[]
  largeVoids: LargeVoidAnchor[]
  diagnostics: string[]
}

/**
 * Office mode (G3): which shaft candidates of a storey are CORE shafts.
 *
 * A candidate is selected when BOTH hold:
 *  1. its footprint is shaft-like — area within
 *     [`shaftMinAreaM2`, `shaftMaxAreaM2`] and longest/shortest side ≤
 *     `shaftMaxAspectRatio` (sleeves are too small; stair / lift / atrium voids
 *     are too large; slots are too elongated);
 *  2. it lies within `coreRadiusM` of a core anchor — a dense-structure cluster
 *     ({@link findDenseStructureClusters} on wall/column cells; slabs never
 *     count) or a large vertical void (a candidate with area ≥
 *     `largeVoidMinAreaM2`: an `aligned-void` repeating on ≥ 3 storeys, or on a
 *     single-storey map a large slab opening, reported as non-repeating).
 *
 * Every candidate carries its area, aspect, distances and a reason, selected
 * or not, so the UI / gated tests can show WHY. Pure and deterministic.
 */
export function selectOfficeCoreShafts(
  map: ContinuityMap,
  storeyId: StoreyId,
  rules: OfficeCoreShaftSelectionRules,
): OfficeCoreShaftSelection {
  const toM = map.units === 'mm' ? 0.001 : 1
  const toMap = 1 / toM
  const diagnostics: string[] = []
  const grid = map.grids.find((candidate) => candidate.storeyId === storeyId)
  const storeyCandidates = map.shaftCandidates
    .filter((candidate) => candidate.storeyIds.includes(storeyId))
    .sort((a, b) => a.id.localeCompare(b.id))

  const denseClusters =
    grid === undefined
      ? []
      : findDenseStructureClusters(grid, rules.denseWindowM * toMap, rules.denseStructureMinDensity)
  if (grid === undefined) {
    diagnostics.push(`no obstruction grid for storey ${storeyId}: dense-structure anchors unavailable`)
  } else if (grid.structureBlocked === undefined) {
    diagnostics.push(`obstruction grid for storey ${storeyId} carries no wall/column layer: dense-structure anchors unavailable`)
  } else if (denseClusters.length === 0) {
    diagnostics.push(
      `no window of ${rules.denseWindowM} m reaches ${Math.round(rules.denseStructureMinDensity * 100)} % wall/column density on storey ${storeyId}`,
    )
  }

  const largeVoids: LargeVoidAnchor[] = []
  for (const candidate of storeyCandidates) {
    const areaM2 = shaftCandidatePlanArea(candidate) * toM * toM
    if (areaM2 < rules.largeVoidMinAreaM2) continue
    largeVoids.push({
      candidateId: candidate.id,
      center: { ...candidate.center },
      bounds: { ...candidate.bounds },
      areaM2,
      repeating: candidate.source === 'aligned-void',
    })
  }
  if (largeVoids.length > 0 && largeVoids.every((anchor) => !anchor.repeating)) {
    diagnostics.push(
      `stair/lift anchors are single-storey slab openings ≥ ${rules.largeVoidMinAreaM2} m² (no aligned voids on this map — build it for ≥ 3 storeys to confirm they repeat)`,
    )
  }

  const candidates: OfficeCoreShaftCandidate[] = storeyCandidates.map((candidate) => {
    const areaM2 = shaftCandidatePlanArea(candidate) * toM * toM
    const aspectRatio = shaftCandidateAspectRatio(candidate)
    const distanceToDenseStructureM = nearestBoundsDistance(candidate.center, denseClusters.map((cluster) => cluster.bounds), toM)
    const distanceToLargeVoidM = nearestBoundsDistance(
      candidate.center,
      largeVoids.filter((anchor) => anchor.candidateId !== candidate.id).map((anchor) => anchor.bounds),
      toM,
    )

    let rejection: OfficeCoreShaftRejection | null = null
    if (areaM2 < rules.shaftMinAreaM2) rejection = 'area-below-min'
    else if (areaM2 > rules.shaftMaxAreaM2) rejection = 'area-above-max'
    else if (aspectRatio > rules.shaftMaxAspectRatio) rejection = 'aspect-above-max'
    const shaftLike = rejection === null

    let coreAnchor: OfficeCoreShaftCandidate['coreAnchor'] = null
    const dense = distanceToDenseStructureM
    const large = distanceToLargeVoidM
    const denseInRange = dense !== null && dense <= rules.coreRadiusM
    const largeInRange = large !== null && large <= rules.coreRadiusM
    if (denseInRange && largeInRange) coreAnchor = dense! <= large! ? 'dense-structure' : 'stair-lift-void'
    else if (denseInRange) coreAnchor = 'dense-structure'
    else if (largeInRange) coreAnchor = 'stair-lift-void'
    if (shaftLike && coreAnchor === null) rejection = 'outside-core-radius'

    const selected = shaftLike && coreAnchor !== null
    const footprint = `${areaM2.toFixed(2)} m², aspect ${Number.isFinite(aspectRatio) ? aspectRatio.toFixed(1) : '∞'}`
    const anchorText =
      coreAnchor === 'dense-structure'
        ? `${dense!.toFixed(2)} m from a dense-structure cluster`
        : coreAnchor === 'stair-lift-void'
          ? `${large!.toFixed(2)} m from a stair/lift void`
          : `nearest dense structure ${dense === null ? 'none' : `${dense.toFixed(2)} m`}, nearest stair/lift void ${large === null ? 'none' : `${large.toFixed(2)} m`}`
    const reason = selected
      ? `core shaft: ${footprint}; ${anchorText} (≤ ${rules.coreRadiusM} m)`
      : rejection === 'area-below-min'
        ? `not a shaft: ${footprint} is below ${rules.shaftMinAreaM2} m² (sleeve / single penetration)`
        : rejection === 'area-above-max'
          ? `not a stack target: ${footprint} exceeds ${rules.shaftMaxAreaM2} m² (stair / lift / atrium void${areaM2 >= rules.largeVoidMinAreaM2 ? ', used as a core anchor' : ''})`
          : rejection === 'aspect-above-max'
            ? `not a shaft: ${footprint} is more elongated than ${rules.shaftMaxAspectRatio}:1 (slot / trench)`
            : `outside the core: ${footprint}; ${anchorText} — both beyond ${rules.coreRadiusM} m`
    return {
      candidate,
      areaM2,
      aspectRatio,
      shaftLike,
      distanceToDenseStructureM,
      distanceToLargeVoidM,
      coreAnchor,
      selected,
      rejection,
      reason,
    }
  })

  return {
    storeyId,
    units: map.units,
    candidates,
    selected: candidates.filter((entry) => entry.selected).map((entry) => entry.candidate),
    denseClusters,
    largeVoids,
    diagnostics,
  }
}

/** Distance (converted by `scale`) from a point to the nearest of several bounds; null when none. */
function nearestBoundsDistance(point: PlanPoint, boundsList: PlanBounds[], scale: number): number | null {
  let best: number | null = null
  for (const bounds of boundsList) {
    const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX)
    const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ)
    const distance = Math.sqrt(dx * dx + dz * dz) * scale
    if (best === null || distance < best) best = distance
  }
  return best
}
