import type { StoreyId } from '@/domain/types'

/**
 * In-memory log of manual riser-stack adjustments, kept alongside the export
 * so the engineer's manual decisions can be downloaded as a JSON artifact.
 *
 * Coordinate convention: `x` is the viewer plan X axis and `y` is the viewer
 * plan Z axis (the vertical viewer axis is irrelevant to plan adjustments).
 * All coordinates are in metres, recorded explicitly on the log's `units`
 * field. Timestamps are ISO-8601 strings supplied by the caller so every
 * helper in this module stays pure and deterministic.
 */

export type AdjustAction = 'move' | 'add' | 'remove'

/** Plan-space point: x = viewer plan X, y = viewer plan Z, in metres. */
export interface AdjustPlanPoint {
  x: number
  y: number
}

interface AdjustLogEntryBase {
  /** Vertical stack the adjusted riser belongs to. */
  stackId: string
  /** IFC express ID of the storey the adjustment happened on. */
  storey: StoreyId
  /** ISO-8601 timestamp provided by the caller. */
  ts: string
}

export interface MoveAdjustment extends AdjustLogEntryBase {
  action: 'move'
  /** Position before the move. */
  from: AdjustPlanPoint
  /** Position after the move. */
  to: AdjustPlanPoint
}

export interface AddAdjustment extends AdjustLogEntryBase {
  action: 'add'
  /** Position the riser was added at (same as `to`; kept for a uniform shape). */
  from: AdjustPlanPoint
  to: AdjustPlanPoint
}

export interface RemoveAdjustment extends AdjustLogEntryBase {
  action: 'remove'
  /** Last position before removal. */
  from: AdjustPlanPoint
  /** Always null: a removed riser has no destination. */
  to: null
}

export type AdjustLogEntry = MoveAdjustment | AddAdjustment | RemoveAdjustment

export interface AdjustLog {
  /** Units of every coordinate in `entries`. */
  units: 'm'
  /** Adjustments in the order they were appended (oldest first). */
  entries: readonly AdjustLogEntry[]
}

export function createAdjustLog(): AdjustLog {
  return { units: 'm', entries: [] }
}

/**
 * Returns a new log with the entry appended. The input log is never mutated,
 * so reducer state that holds a log can be replaced wholesale.
 */
export function appendAdjustment(log: AdjustLog, entry: AdjustLogEntry): AdjustLog {
  return { units: log.units, entries: [...log.entries, entry] }
}

/**
 * Serializes the log to pretty-printed JSON bytes (2-space indent, trailing
 * newline) suitable for download alongside the exported IFC. Key order is
 * normalized, so the same logical log always produces identical bytes.
 */
export function serializeAdjustLog(log: AdjustLog): Uint8Array {
  const normalized = {
    units: log.units,
    entries: log.entries.map((entry) => ({
      action: entry.action,
      stackId: entry.stackId,
      storey: entry.storey,
      from: { x: entry.from.x, y: entry.from.y },
      to: entry.to === null ? null : { x: entry.to.x, y: entry.to.y },
      ts: entry.ts,
    })),
  }
  return new TextEncoder().encode(`${JSON.stringify(normalized, null, 2)}\n`)
}
