import type { RiserId, StoreyId } from '@/domain/types'

/**
 * Units the plan coordinates are expressed in. Plan geometry lives on the
 * X/Z plane (Y is vertical), matching the viewer and riser conventions.
 */
export type PlanUnits = 'mm' | 'm'

export type RouteSegmentId = string

/**
 * 'fixture-branch': carries flow from exactly one fixture.
 * 'trunk': merged run carrying flow from two or more fixtures toward the riser.
 */
export type RouteSegmentKind = 'fixture-branch' | 'trunk'

/**
 * One end of an axis-aligned horizontal route segment.
 * All values are in the plan units recorded on the owning FloorRoutes.
 */
export interface RouteSegmentEndpoint {
  /** Plan X coordinate. */
  x: number
  /** Plan Z coordinate. */
  z: number
  /**
   * Sloped pipe level at this endpoint, relative to the branch connection
   * point at the riser on this storey (riser end = 0; upstream ends are
   * positive, i.e. higher). Same units as the plan coordinates.
   */
  elevation: number
}

/**
 * A single axis-aligned horizontal run at slab level. Flow direction is
 * start -> end, i.e. `start` is upstream (higher) and `end` is downstream
 * (lower, toward the riser).
 */
export interface RouteSegment {
  /** Stable ID: `branch-seg|${storeyId}|${riserId}|${index}` (deterministic per input). */
  id: RouteSegmentId
  /** Upstream endpoint (farther from the riser, higher elevation). */
  start: RouteSegmentEndpoint
  /** Downstream endpoint (nearer the riser, lower elevation). */
  end: RouteSegmentEndpoint
  /** Which plan axis this segment runs along. */
  axis: 'x' | 'z'
  /** 'trunk' when the segment carries flow from more than one fixture. */
  kind: RouteSegmentKind
  /** Fixtures whose flow passes through this segment, sorted ascending. */
  servedFixtureExpressIds: number[]
  /** Riser this segment drains toward. */
  riserId: RiserId
  /** Vertical stack of the target riser, when known. */
  riserStackId?: string
}

/**
 * All computed branch route segments for one storey, in the plan units the
 * input coordinates were interpreted in.
 */
export interface FloorRoutes {
  storeyId: StoreyId
  /** Units of every coordinate and elevation in `segments`. */
  planUnits: PlanUnits
  segments: RouteSegment[]
}
