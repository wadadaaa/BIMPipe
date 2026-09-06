import { describe, expect, it } from 'vitest'
import { buildFixtureCoreIds, gatherObstructedCores, isObstructedPlacement, type CoreCollectorCandidate } from './coreCollectors'
import type { PlanPoint } from './branchRouting'
import type { WetCore, WetCoreStackPlacement } from './wetCores'

function core(id: string, centroid: PlanPoint, memberExpressIds: number[], storeyId = 2): WetCore {
  return {
    id,
    storeyId,
    members: memberExpressIds.map((expressId) => ({
      expressId,
      name: `F-${expressId}`,
      kind: 'TOILETPAN',
      storeyId,
      position: { x: centroid.x, y: 6, z: centroid.z },
    })),
    memberExpressIds,
    kindsFingerprint: 'TOILETPAN',
    kindCounts: { TOILETPAN: memberExpressIds.length },
    centroid,
    centroidY: 6,
    bbox: { minX: centroid.x, maxX: centroid.x, minZ: centroid.z, maxZ: centroid.z },
  }
}

/** V3's flagged centroid: every cell within snap range is obstructed. */
function obstructed(position: PlanPoint): WetCoreStackPlacement {
  return { rule: 'centroid', position, flagged: true, reason: 'every cell within 1.50 m is obstructed' }
}

/** A valid stack on a free cell. */
function freeCell(position: PlanPoint): WetCoreStackPlacement {
  return { rule: 'free-cell', position, flagged: false, cell: { row: 0, col: 0 }, distance: 0.3, reason: 'free cell' }
}

/** Office fallback: flagged centroid but for a different reason — still not a valid target. */
function unflaggedCentroid(position: PlanPoint): WetCoreStackPlacement {
  return { rule: 'centroid', position, flagged: false, reason: 'no continuity map loaded' }
}

const candidate = (c: WetCore, placement: WetCoreStackPlacement): CoreCollectorCandidate => ({ core: c, placement })

describe('isObstructedPlacement', () => {
  it('is true only for the flagged centroid fallback', () => {
    expect(isObstructedPlacement(obstructed({ x: 0, z: 0 }))).toBe(true)
    expect(isObstructedPlacement(unflaggedCentroid({ x: 0, z: 0 }))).toBe(false)
    expect(isObstructedPlacement(freeCell({ x: 0, z: 0 }))).toBe(false)
  })
})

describe('gatherObstructedCores', () => {
  const receiverA = candidate(core('wet-core:2:1', { x: 0, z: 0 }, [1]), freeCell({ x: 0.5, z: 0 }))
  const receiverB = candidate(core('wet-core:2:2', { x: 10, z: 0 }, [2]), freeCell({ x: 10, z: 0.5 }))

  it('gathers an obstructed core into the nearest valid stack (Manhattan from its centroid) within the limit', () => {
    // Centroid (3, 1): to A's stack |3-0.5|+|1-0| = 3.5 m; to B's stack |3-10|+|1-0.5| = 7.5 m.
    const blocked = candidate(core('wet-core:2:5+6', { x: 3, z: 1 }, [6, 5]), obstructed({ x: 3, z: 1 }))
    const result = gatherObstructedCores([receiverA, blocked, receiverB], { units: 'm', maxCollectorLength: 8 })

    expect(result.unreachable).toEqual([])
    expect(result.collectors).toEqual([
      {
        id: 'core-collector|wet-core:2:5+6',
        storeyId: 2,
        coreId: 'wet-core:2:5+6',
        memberExpressIds: [5, 6],
        targetCoreId: 'wet-core:2:1',
        junction: { x: 3, z: 1 },
        targetStackPosition: { x: 0.5, z: 0 },
        lengthManhattan: 3.5,
        units: 'm',
        reason: expect.stringContaining('gathered into the stack of wet-core:2:1 through a 3.50 m collector (limit 8.00 m)'),
      },
    ])
  })

  it('keeps the flagged fallback, with a reason, when the nearest valid stack is beyond the limit or there is none', () => {
    const farAway = candidate(core('wet-core:2:7', { x: 20, z: 20 }, [7]), obstructed({ x: 20, z: 20 }))
    const beyond = gatherObstructedCores([receiverA, receiverB, farAway], { units: 'm', maxCollectorLength: 8 })
    expect(beyond.collectors).toEqual([])
    expect(beyond.unreachable).toEqual([
      {
        coreId: 'wet-core:2:7',
        reason: 'nearest core with a valid stack (wet-core:2:2) is 29.50 m away, beyond the 8.00 m collector limit; the flagged centroid stack stays',
      },
    ])

    const alone = gatherObstructedCores([farAway], { units: 'm', maxCollectorLength: 8 })
    expect(alone.unreachable[0]?.reason).toBe('no other core with a valid stack on the storey; the flagged centroid stack stays')

    // Exactly at the limit counts as reachable.
    const atLimit = candidate(core('wet-core:2:8', { x: 8.5, z: 0 }, [8]), obstructed({ x: 8.5, z: 0 }))
    expect(gatherObstructedCores([receiverA, atLimit], { units: 'm', maxCollectorLength: 8 }).collectors).toHaveLength(1)
  })

  it('never uses an obstructed, unflagged-centroid or other-storey core as a receiver (one hop only)', () => {
    // Two obstructed cores 1 m apart: neither may gather the other, both go to A's stack 3–4 m away.
    const blocked1 = candidate(core('wet-core:2:3', { x: 3, z: 0 }, [3]), obstructed({ x: 3, z: 0 }))
    const blocked2 = candidate(core('wet-core:2:4', { x: 4, z: 0 }, [4]), obstructed({ x: 4, z: 0 }))
    // An unflagged centroid (no map for that core) is a stack, hence a legal receiver — but it is
    // farther than A from both, so A wins; an other-storey stack right next to them never counts.
    const plainCentroid = candidate(core('wet-core:2:9', { x: 9, z: 0 }, [9]), unflaggedCentroid({ x: 9, z: 0 }))
    const otherStorey = candidate(core('wet-core:3:10', { x: 3, z: 0.1 }, [10], 3), freeCell({ x: 3, z: 0.1 }))
    const result = gatherObstructedCores([blocked1, blocked2, plainCentroid, otherStorey, receiverA], {
      units: 'm',
      maxCollectorLength: 8,
    })
    expect(result.collectors.map((collector) => [collector.coreId, collector.targetCoreId, collector.lengthManhattan])).toEqual([
      ['wet-core:2:3', 'wet-core:2:1', 2.5],
      ['wet-core:2:4', 'wet-core:2:1', 3.5],
    ])
    // Without A, the unflagged centroid receives both (5 m / 6 m).
    const withoutA = gatherObstructedCores([blocked1, blocked2, plainCentroid, otherStorey], { units: 'm', maxCollectorLength: 8 })
    expect(withoutA.collectors.map((collector) => collector.targetCoreId)).toEqual(['wet-core:2:9', 'wet-core:2:9'])
  })

  it('breaks distance ties by the lower target core id, deterministically', () => {
    const left = candidate(core('wet-core:2:b', { x: 0, z: 0 }, [1]), freeCell({ x: 0, z: 0 }))
    const right = candidate(core('wet-core:2:a', { x: 6, z: 0 }, [2]), freeCell({ x: 6, z: 0 }))
    const middle = candidate(core('wet-core:2:m', { x: 3, z: 0 }, [3]), obstructed({ x: 3, z: 0 }))
    const first = gatherObstructedCores([left, middle, right], { units: 'm', maxCollectorLength: 8 })
    const second = gatherObstructedCores([right, left, middle], { units: 'm', maxCollectorLength: 8 })
    expect(first.collectors[0]?.targetCoreId).toBe('wet-core:2:a')
    expect(second.collectors).toEqual(first.collectors)
  })

  it('a null limit disables gathering entirely and mm units format the reason in mm', () => {
    const blocked = candidate(core('wet-core:2:5', { x: 3, z: 1 }, [5]), obstructed({ x: 3, z: 1 }))
    expect(gatherObstructedCores([receiverA, blocked], { units: 'm', maxCollectorLength: null })).toEqual({
      collectors: [],
      unreachable: [],
    })
    const mm = gatherObstructedCores(
      [
        candidate(core('wet-core:2:1', { x: 0, z: 0 }, [1]), freeCell({ x: 500, z: 0 })),
        candidate(core('wet-core:2:5', { x: 3000, z: 1000 }, [5]), obstructed({ x: 3000, z: 1000 })),
      ],
      { units: 'mm', maxCollectorLength: 8000 },
    )
    expect(mm.collectors[0]?.lengthManhattan).toBe(3500)
    expect(mm.collectors[0]?.reason).toContain('3500 mm collector (limit 8000 mm)')
  })
})

describe('buildFixtureCoreIds', () => {
  it('maps a gathered core’s fixtures to the receiving core and leaves the rest on their own core', () => {
    const cores = [core('wet-core:2:1', { x: 0, z: 0 }, [1]), core('wet-core:2:5+6', { x: 3, z: 1 }, [5, 6]), core('wet-core:2:9', { x: 9, z: 9 }, [9])]
    const map = buildFixtureCoreIds(cores, [{ coreId: 'wet-core:2:5+6', targetCoreId: 'wet-core:2:1' }])
    expect([...map.entries()]).toEqual([
      [1, 'wet-core:2:1'],
      [5, 'wet-core:2:1'],
      [6, 'wet-core:2:1'],
      [9, 'wet-core:2:9'],
    ])
    // No collectors → identity mapping, byte-for-byte what the page wired before R1.
    expect([...buildFixtureCoreIds(cores, []).values()]).toEqual(['wet-core:2:1', 'wet-core:2:5+6', 'wet-core:2:5+6', 'wet-core:2:9'])
  })
})
