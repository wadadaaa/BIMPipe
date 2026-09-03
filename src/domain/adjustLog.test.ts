import { describe, expect, it } from 'vitest'
import {
  appendAdjustment,
  createAdjustLog,
  serializeAdjustLog,
  type AdjustLog,
  type AdjustLogEntry,
} from './adjustLog'

const moveEntry: AdjustLogEntry = {
  action: 'move',
  stackId: 'stack-1',
  storey: 70,
  from: { x: 1, y: 1 },
  to: { x: 1.5, y: 2 },
  ts: '2026-09-01T10:00:00.000Z',
}

const addEntry: AdjustLogEntry = {
  action: 'add',
  stackId: 'stack-user-1',
  storey: 70,
  from: { x: 4, y: 3 },
  to: { x: 4, y: 3 },
  ts: '2026-09-01T10:01:00.000Z',
}

const removeEntry: AdjustLogEntry = {
  action: 'remove',
  stackId: 'stack-2',
  storey: 73,
  from: { x: 3, y: 2 },
  to: null,
  ts: '2026-09-01T10:02:00.000Z',
}

describe('createAdjustLog', () => {
  it('starts empty with explicit metre units', () => {
    expect(createAdjustLog()).toEqual({ units: 'm', entries: [] })
  })
})

describe('appendAdjustment', () => {
  it('appends without mutating the input log', () => {
    const empty = createAdjustLog()
    const withMove = appendAdjustment(empty, moveEntry)

    expect(empty.entries).toHaveLength(0)
    expect(withMove.entries).toEqual([moveEntry])
    expect(withMove).not.toBe(empty)
    expect(withMove.entries).not.toBe(empty.entries)
  })

  it('preserves append order across move/add/remove entries', () => {
    let log = createAdjustLog()
    log = appendAdjustment(log, moveEntry)
    log = appendAdjustment(log, addEntry)
    log = appendAdjustment(log, removeEntry)

    expect(log.entries.map((entry) => entry.action)).toEqual(['move', 'add', 'remove'])
    expect(log.entries).toEqual([moveEntry, addEntry, removeEntry])
  })
})

describe('serializeAdjustLog', () => {
  function buildLog(): AdjustLog {
    let log = createAdjustLog()
    log = appendAdjustment(log, moveEntry)
    log = appendAdjustment(log, removeEntry)
    return log
  }

  it('produces pretty JSON bytes that parse back to the same log', () => {
    const bytes = serializeAdjustLog(buildLog())
    // TextEncoder in the jsdom test environment returns a cross-realm Uint8Array,
    // so assert structurally instead of via instanceof.
    expect(ArrayBuffer.isView(bytes)).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(0)

    const text = new TextDecoder().decode(bytes)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "entries": [')

    expect(JSON.parse(text)).toEqual({
      units: 'm',
      entries: [moveEntry, removeEntry],
    })
  })

  it('keeps null `to` for removals in the serialized output', () => {
    const text = new TextDecoder().decode(serializeAdjustLog(buildLog()))
    const parsed = JSON.parse(text) as { entries: Array<{ action: string; to: unknown }> }
    expect(parsed.entries[1]).toMatchObject({ action: 'remove', to: null })
  })

  it('is deterministic: the same logical log serializes to identical bytes regardless of key order', () => {
    const reorderedMove = {
      ts: moveEntry.ts,
      to: { y: 2, x: 1.5 },
      from: { y: 1, x: 1 },
      storey: moveEntry.storey,
      stackId: moveEntry.stackId,
      action: 'move',
    } as AdjustLogEntry
    const reorderedRemove = {
      to: null,
      ts: removeEntry.ts,
      action: 'remove',
      from: { y: 2, x: 3 },
      storey: removeEntry.storey,
      stackId: removeEntry.stackId,
    } as AdjustLogEntry

    let reorderedLog = createAdjustLog()
    reorderedLog = appendAdjustment(reorderedLog, reorderedMove)
    reorderedLog = appendAdjustment(reorderedLog, reorderedRemove)

    expect(serializeAdjustLog(reorderedLog)).toEqual(serializeAdjustLog(buildLog()))
  })

  it('serializes an empty log to a stable minimal document', () => {
    const text = new TextDecoder().decode(serializeAdjustLog(createAdjustLog()))
    expect(JSON.parse(text)).toEqual({ units: 'm', entries: [] })
  })
})
