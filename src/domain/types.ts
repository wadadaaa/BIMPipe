export type IfcModelId = string // crypto.randomUUID()
export type StoreyId = number // IFC express ID

export interface IfcModel {
  id: IfcModelId
  fileName: string
}

export interface Storey {
  id: StoreyId
  name: string
  elevation: number // IFC world units (metres)
  modelId: IfcModelId
}

export type SidebarTab = 'fixtures' | 'risers'

export type RiserId = string

export interface Riser {
  id: RiserId
  /** Shared across all floors for the same vertical pipe stack. */
  stackId: string
  /** Stable human-readable label shared across all floors for the same stack (e.g. "R18"). */
  stackLabel: string
  storeyId: StoreyId
  position: { x: number; y: number; z: number }
}

export type FixtureKind =
  | 'BATH'
  | 'SINK'
  | 'TOILETPAN'
  | 'URINAL'
  | 'WASHHANDBASIN'
  | 'CISTERN'
  | 'BIDET'
  | 'OTHER'

export interface Fixture {
  expressId: number
  name: string
  kind: FixtureKind
  storeyId: StoreyId
  /** True when the sink is identified as belonging to a kitchen space. */
  isKitchenSink?: boolean
  /** World-space centroid in IFC coordinates (Z-up). Null if geometry is unavailable. */
  position: { x: number; y: number; z: number } | null
}

export interface PlanBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface KitchenArea {
  expressId: number
  name: string
  storeyId: StoreyId
  /** World-space anchor in IFC coordinates (Z-up). Null if geometry is unavailable. */
  position: { x: number; y: number; z: number } | null
  /** Optional plan-space bounds used for corner-based riser placement. */
  planBounds?: PlanBounds
  /** Optional oriented room corners in plan space, clockwise. */
  planCorners?: Array<{ x: number; z: number }>
}

export type RouteId = string

export interface Route {
  /** Stable ID: `${fixtureExpressId}-${riserId}` */
  id: RouteId
  fixtureExpressId: number
  fixtureName: string
  fixtureKind: FixtureKind
  riserId: RiserId
  /** Horizontal distance in IFC world units */
  length: number
  /** Vertical drop at 2% slope (length × 0.02) */
  drop: number
  /** true if drop ≤ screed depth limit */
  compliant: boolean
  fixturePos: { x: number; y: number; z: number }
  riserPos: { x: number; y: number; z: number }
}
