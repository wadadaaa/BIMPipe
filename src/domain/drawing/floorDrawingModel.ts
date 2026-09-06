/**
 * Renderer-neutral description of one floor as a sanitary drawing.
 *
 * This is the contract between data adapters (our suggestion, the engineer's
 * extracted network) and the pure drawing renderer. Everything is in the
 * storey's plan frame: metres, IFC X right / IFC Y up (no viewer Y-up flip).
 * Diameters are millimetres. Nothing here knows about IFC, React or Three.js.
 *
 * Adapters MUST NOT leak file names, project codes or client strings into
 * `title`/labels — the drawing is shown to a blind critic.
 */

export interface DrawingPointM {
  readonly xM: number
  readonly yM: number
}

export interface DrawingBoundsM {
  readonly minXM: number
  readonly minYM: number
  readonly maxXM: number
  readonly maxYM: number
}

/** Closed polygon in plan; first point is not repeated at the end. */
export type DrawingPolygonM = readonly DrawingPointM[]

export type DrawingStructureKind = 'wall' | 'column' | 'slab-opening' | 'shaft-candidate'

export interface DrawingStructureElement {
  readonly kind: DrawingStructureKind
  readonly outline: DrawingPolygonM
}

export type DrawingFixtureKind =
  | 'toilet'
  | 'basin'
  | 'sink'
  | 'urinal'
  | 'shower'
  | 'bath'
  | 'bidet'
  | 'floor-drain'
  | 'other'

export interface DrawingFixture {
  readonly id: string
  readonly kind: DrawingFixtureKind
  readonly centre: DrawingPointM
  /** Plan rotation in degrees, counter-clockwise from +X; 0 when unknown. */
  readonly rotationDeg: number
  /** Footprint when known (m); the renderer falls back to a symbol of default size. */
  readonly footprint?: DrawingBoundsM
}

export type DrawingPipeSystem = 'sanitary' | 'vent'

export interface DrawingPipeRun {
  readonly id: string
  readonly system: DrawingPipeSystem
  readonly diameterMm: number | null
  /** Slope in percent along the run direction (start → end); null when unknown. */
  readonly slopePercent: number | null
  readonly start: DrawingPointM
  readonly end: DrawingPointM
  /** Set when the run is the collector of a fixture row (drawn heavier, labelled once). */
  readonly role: 'branch' | 'collector'
  /**
   * True for a fitting-body connector (elbow, tee, wye piece between two
   * runs): drawn as pipe band so the network is continuous, but never
   * labelled and never given a collar (the collar belongs to the pipe end
   * that enters the body). Absent for real runs.
   */
  readonly fitting?: boolean
}

export interface DrawingRiser {
  readonly id: string
  readonly system: DrawingPipeSystem
  readonly centre: DrawingPointM
  readonly diameterMm: number | null
  /**
   * Tag text as it should appear on the sheet, e.g. "1.3ק" — the adapter
   * formats it; the renderer only places it. Must not contain client data.
   */
  readonly tag: string
  /** Storey labels the stack passes through (rendered as a small note). */
  readonly spansStoreyLabels?: readonly string[]
}

export interface DrawingSleeve {
  readonly id: string
  readonly at: DrawingPointM
  /** Direction of the crossing pipe in degrees CCW from +X. */
  readonly directionDeg: number
  readonly pipeDiameterMm: number | null
  /**
   * Length of the crossing along the pipe (the wall thickness at that point),
   * in metres. Optional: the renderer falls back to a default sleeve length.
   */
  readonly lengthM?: number
}

export interface FloorDrawingModel {
  /** Neutral title, e.g. "Storey 01 — sanitary plan". No project or file names. */
  readonly title: string
  readonly storeyLabel: string
  readonly boundsM: DrawingBoundsM
  readonly structure: readonly DrawingStructureElement[]
  readonly fixtures: readonly DrawingFixture[]
  readonly risers: readonly DrawingRiser[]
  readonly pipes: readonly DrawingPipeRun[]
  /** Adapters may leave this empty; the renderer can derive sleeves from pipe ∩ wall. */
  readonly sleeves: readonly DrawingSleeve[]
}
