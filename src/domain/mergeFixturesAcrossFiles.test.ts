import { describe, expect, it } from 'vitest'
import type { Fixture, FixtureKind, KitchenArea } from './types'
import {
  CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM,
  CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND,
  crossFileDedupeDistanceMm,
  mergeStoreyDetections,
  type SourcedStoreyDetection,
} from './mergeFixturesAcrossFiles'

function fixture(overrides: Partial<Fixture> & { expressId: number }): Fixture {
  return {
    name: `Fixture ${overrides.expressId}`,
    kind: 'TOILETPAN',
    storeyId: 1,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  }
}

function kitchen(expressId: number): KitchenArea {
  return { expressId, name: `Kitchen ${expressId}`, storeyId: 1, position: { x: 0, y: 0, z: 0 } }
}

function source(
  fileName: string,
  fixtures: Fixture[],
  kitchens: KitchenArea[] = [],
  mergePriority?: number,
): SourcedStoreyDetection {
  return { fileName, fixtures, kitchens, mergePriority }
}

describe('per-kind dedupe radius table', () => {
  it('overrides WC and basin, defaults everything else to 120 mm', () => {
    expect(CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM).toBe(120)
    expect(CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM_BY_KIND).toEqual({ TOILETPAN: 400, WASHHANDBASIN: 300 })
    expect(crossFileDedupeDistanceMm('TOILETPAN')).toBe(400)
    expect(crossFileDedupeDistanceMm('WASHHANDBASIN')).toBe(300)
    for (const kind of ['BATH', 'SINK', 'URINAL', 'CISTERN', 'BIDET', 'OTHER'] as FixtureKind[]) {
      expect(crossFileDedupeDistanceMm(kind)).toBe(120)
    }
  })
})

describe('mergeStoreyDetections', () => {
  it('drops a same-kind linked fixture within its radius, keeping the host instance', () => {
    const hostFixture = fixture({ expressId: 1, position: { x: 10, y: 0, z: 5 } })
    const linkedDuplicate = fixture({ expressId: 100, position: { x: 10.08, y: 0, z: 5.05 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostFixture]), [
      source('arch.ifc', [linkedDuplicate]),
    ])

    expect(merged.fixtures).toEqual([hostFixture])
    expect(merged.duplicates).toHaveLength(1)
    expect(merged.duplicates[0]).toMatchObject({
      kind: 'TOILETPAN',
      keptFileName: 'host.ifc',
      keptExpressId: 1,
      droppedFileName: 'arch.ifc',
      droppedExpressId: 100,
      toleranceMm: 400,
    })
    expect(merged.duplicates[0].distanceMm).toBeCloseTo(94.3, 0)
    expect(merged.perFile).toEqual([
      {
        fileName: 'host.ifc',
        detectedFixtureCount: 1,
        mergedFixtureCount: 1,
        duplicateFixtureCount: 0,
        kitchenCount: 0,
      },
      {
        fileName: 'arch.ifc',
        detectedFixtureCount: 1,
        mergedFixtureCount: 0,
        duplicateFixtureCount: 1,
        kitchenCount: 0,
      },
    ])
    expect(merged.dedupeToleranceMm).toBe(CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM)
  })

  it('WC: dedupes an architect WC 340 mm from the engineer WC, keeps one 401 mm away', () => {
    const hostWc = fixture({ expressId: 1, kind: 'TOILETPAN', position: { x: 0, y: 0, z: 0 } })
    const offsetWc = fixture({ expressId: 100, kind: 'TOILETPAN', position: { x: 0.34, y: 0, z: 0 } })
    const farWc = fixture({ expressId: 101, kind: 'TOILETPAN', position: { x: 0, y: 0, z: -0.401 } })

    const merged = mergeStoreyDetections(source('sa.ifc', [hostWc]), [source('ar.ifc', [offsetWc, farWc])])

    expect(merged.fixtures).toEqual([hostWc, farWc])
    expect(merged.duplicates).toEqual([
      {
        kind: 'TOILETPAN',
        keptFileName: 'sa.ifc',
        keptExpressId: 1,
        droppedFileName: 'ar.ifc',
        droppedExpressId: 100,
        distanceMm: 340,
        toleranceMm: 400,
      },
    ])
  })

  it('basin: 300 mm is a duplicate, 301 mm is not', () => {
    const host = fixture({ expressId: 1, kind: 'WASHHANDBASIN', position: { x: 0, y: 0, z: 0 } })
    const atRadius = fixture({ expressId: 100, kind: 'WASHHANDBASIN', position: { x: 0.3, y: 0, z: 0 } })
    const beyond = fixture({ expressId: 101, kind: 'WASHHANDBASIN', position: { x: 0, y: 0, z: 0.301 } })

    const merged = mergeStoreyDetections(source('host.ifc', [host]), [source('arch.ifc', [atRadius, beyond])])

    expect(merged.fixtures).toEqual([host, beyond])
    expect(merged.duplicates.map((d) => d.droppedExpressId)).toEqual([100])
    expect(merged.duplicates[0].toleranceMm).toBe(300)
  })

  it('other kinds keep the 120 mm default: urinal at 120 mm merges, 121 mm survives', () => {
    const host = fixture({ expressId: 1, kind: 'URINAL', position: { x: 0, y: 0, z: 0 } })
    const atRadius = fixture({ expressId: 100, kind: 'URINAL', position: { x: 0.12, y: 0, z: 0 } })
    const beyond = fixture({ expressId: 101, kind: 'URINAL', position: { x: 0, y: 0, z: 0.121 } })

    const merged = mergeStoreyDetections(source('host.ifc', [host]), [source('arch.ifc', [atRadius, beyond])])

    expect(merged.fixtures).toEqual([host, beyond])
    expect(merged.duplicates).toEqual([
      expect.objectContaining({ droppedExpressId: 100, distanceMm: 120, toleranceMm: 120 }),
    ])
  })

  it('never dedupes fixtures of different kinds, even at the same position', () => {
    const hostToilet = fixture({ expressId: 1, kind: 'TOILETPAN', position: { x: 0, y: 0, z: 0 } })
    const hostBasin = fixture({ expressId: 2, kind: 'WASHHANDBASIN', position: { x: 3, y: 0, z: 0 } })
    const linkedBasin = fixture({ expressId: 100, kind: 'WASHHANDBASIN', position: { x: 0, y: 0, z: 0 } })
    // An architect multi-bowl sink unit over the engineer's individual basins.
    const linkedSinkUnit = fixture({ expressId: 101, kind: 'SINK', position: { x: 3, y: 0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostToilet, hostBasin]), [
      source('arch.ifc', [linkedBasin, linkedSinkUnit]),
    ])

    expect(merged.fixtures).toHaveLength(4)
    expect(merged.duplicates).toEqual([])
  })

  it('ignores vertical (Y) distance — dedupe is a plan-distance rule', () => {
    const hostFixture = fixture({ expressId: 1, position: { x: 0, y: 23.65, z: 0 } })
    const linkedFixture = fixture({ expressId: 100, position: { x: 0.05, y: 22.0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostFixture]), [
      source('arch.ifc', [linkedFixture]),
    ])

    expect(merged.fixtures).toEqual([hostFixture])
  })

  it('keeps position-less fixtures on both sides — they can never be proven duplicates', () => {
    const hostFixture = fixture({ expressId: 1, position: null })
    const linkedFixture = fixture({ expressId: 100, position: null })

    const merged = mergeStoreyDetections(source('host.ifc', [hostFixture]), [
      source('arch.ifc', [linkedFixture]),
    ])

    expect(merged.fixtures).toHaveLength(2)
  })

  it('attaches a duplicate to the NEAREST merged fixture of its kind', () => {
    const near = fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } })
    const farther = fixture({ expressId: 2, position: { x: 0.8, y: 0, z: 0 } })
    // 0.33 m from #1, 0.47 m from #2: both within 400 mm, #1 is nearer.
    const linked = fixture({ expressId: 100, position: { x: 0.33, y: 0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [near, farther]), [source('arch.ifc', [linked])])

    expect(merged.fixtures).toEqual([near, farther])
    expect(merged.duplicates[0]).toMatchObject({ keptExpressId: 1, distanceMm: 330 })
  })

  it('dedupes across two linked files, keeping the earlier file instance', () => {
    const first = fixture({ expressId: 100, position: { x: 1, y: 0, z: 1 } })
    const second = fixture({ expressId: 200, position: { x: 1.05, y: 0, z: 1 } })

    const merged = mergeStoreyDetections(source('host.ifc', []), [
      source('arch.ifc', [first]),
      source('struct.ifc', [second]),
    ])

    expect(merged.fixtures).toEqual([first])
    expect(merged.duplicates[0]).toMatchObject({
      keptFileName: 'arch.ifc',
      droppedFileName: 'struct.ifc',
    })
  })

  describe('merge priority', () => {
    it('lets a higher-priority linked file win over the host, with per-file accounting in upload order', () => {
      const hostWc = fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } })
      const engineerWc = fixture({ expressId: 100, position: { x: 0.3, y: 0, z: 0 } })

      const merged = mergeStoreyDetections(source('arch.ifc', [hostWc]), [
        source('sa.ifc', [engineerWc], [], 1),
      ])

      expect(merged.fixtures).toEqual([engineerWc])
      expect(merged.duplicates).toEqual([
        {
          kind: 'TOILETPAN',
          keptFileName: 'sa.ifc',
          keptExpressId: 100,
          droppedFileName: 'arch.ifc',
          droppedExpressId: 1,
          distanceMm: 300,
          toleranceMm: 400,
        },
      ])
      expect(merged.perFile.map((entry) => [entry.fileName, entry.mergedFixtureCount, entry.duplicateFixtureCount])).toEqual([
        ['arch.ifc', 0, 1],
        ['sa.ifc', 1, 0],
      ])
    })

    it('breaks priority ties by upload order (host first), so the default is unchanged behaviour', () => {
      const hostWc = fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } })
      const linkedWc = fixture({ expressId: 100, position: { x: 0.1, y: 0, z: 0 } })

      const explicit = mergeStoreyDetections(source('host.ifc', [hostWc], [], 5), [
        source('arch.ifc', [linkedWc], [], 5),
      ])
      const implicit = mergeStoreyDetections(source('host.ifc', [hostWc]), [source('arch.ifc', [linkedWc])])

      expect(explicit.fixtures).toEqual([hostWc])
      expect(implicit).toEqual(explicit)
    })

    it('is deterministic: the same inputs always produce the same merged set and order', () => {
      const host = source('host.ifc', [
        fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } }),
        fixture({ expressId: 2, kind: 'WASHHANDBASIN', position: { x: 1, y: 0, z: 0 } }),
      ])
      const linked = [
        source('a.ifc', [fixture({ expressId: 100, position: { x: 0.2, y: 0, z: 0 } })], [], 2),
        source('b.ifc', [fixture({ expressId: 200, kind: 'WASHHANDBASIN', position: { x: 1.1, y: 0, z: 0 } })], [], 2),
      ]

      const first = mergeStoreyDetections(host, linked)
      const second = mergeStoreyDetections(host, linked)
      expect(second).toEqual(first)
      // Priority 2 files merge before the host: a.ifc's WC and b.ifc's basin win.
      expect(first.fixtures.map((entry) => entry.expressId)).toEqual([100, 200])
    })
  })

  it('never adds or reclassifies fixtures: the merged set is a subset of the inputs, kinds untouched', () => {
    // Accessories (flushing tanks, traps, drains) are excluded by the
    // classifier before detection results reach the merge; this guards the
    // boundary — a merge can only drop, never invent.
    const inputs = [
      fixture({ expressId: 1, kind: 'TOILETPAN', name: 'wc', position: { x: 0, y: 0, z: 0 } }),
      fixture({ expressId: 100, kind: 'TOILETPAN', name: 'wc (architect)', position: { x: 0.3, y: 0, z: 0 } }),
      fixture({ expressId: 101, kind: 'CISTERN', name: 'typed cistern', position: { x: 0.3, y: 0, z: 0 } }),
      fixture({ expressId: 102, kind: 'URINAL', name: 'urinal', position: { x: 4, y: 0, z: 0 } }),
    ]

    const merged = mergeStoreyDetections(source('host.ifc', [inputs[0]]), [source('arch.ifc', inputs.slice(1))])

    for (const fixtureOut of merged.fixtures) {
      expect(inputs).toContain(fixtureOut)
    }
    expect(merged.fixtures.map((entry) => entry.kind)).toEqual(['TOILETPAN', 'CISTERN', 'URINAL'])
    expect(merged.fixtures.length + merged.duplicates.length).toBe(inputs.length)
  })

  it('concatenates kitchens from every file without deduping', () => {
    const merged = mergeStoreyDetections(source('host.ifc', [], [kitchen(1)]), [
      source('arch.ifc', [], [kitchen(100), kitchen(101)]),
    ])

    expect(merged.kitchens.map((entry) => entry.expressId)).toEqual([1, 100, 101])
    expect(merged.perFile.map((entry) => entry.kitchenCount)).toEqual([1, 2])
  })

  it('produces exact per-file accounting with no double counting', () => {
    const hostFixtures = [
      fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } }),
      fixture({ expressId: 2, position: { x: 5, y: 0, z: 5 } }),
    ]
    const linkedFixtures = [
      // Duplicate of host #1.
      fixture({ expressId: 100, position: { x: 0.05, y: 0, z: 0 } }),
      // Unique.
      fixture({ expressId: 101, position: { x: 20, y: 0, z: 20 } }),
    ]

    const merged = mergeStoreyDetections(source('host.ifc', hostFixtures), [
      source('arch.ifc', linkedFixtures),
    ])

    const totalDetected = merged.perFile.reduce((sum, file) => sum + file.detectedFixtureCount, 0)
    const totalMerged = merged.perFile.reduce((sum, file) => sum + file.mergedFixtureCount, 0)
    expect(merged.fixtures).toHaveLength(3)
    expect(totalMerged).toBe(merged.fixtures.length)
    expect(totalDetected).toBe(merged.fixtures.length + merged.duplicates.length)
  })
})
