import { describe, expect, it } from 'vitest'
import type { Fixture, KitchenArea } from './types'
import {
  CROSS_FILE_FIXTURE_DEDUPE_DISTANCE_MM,
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
): SourcedStoreyDetection {
  return { fileName, fixtures, kitchens }
}

describe('mergeStoreyDetections', () => {
  it('drops a same-kind linked fixture within the 120 mm tolerance, keeping the host instance', () => {
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

  it('keeps a same-kind linked fixture just beyond the 120 mm tolerance', () => {
    const hostFixture = fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } })
    // 121 mm away in plan.
    const linkedFixture = fixture({ expressId: 100, position: { x: 0.121, y: 0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostFixture]), [
      source('arch.ifc', [linkedFixture]),
    ])

    expect(merged.fixtures).toEqual([hostFixture, linkedFixture])
    expect(merged.duplicates).toEqual([])
  })

  it('merges a fixture exactly at the tolerance boundary as a duplicate', () => {
    const hostFixture = fixture({ expressId: 1, position: { x: 0, y: 0, z: 0 } })
    const linkedFixture = fixture({ expressId: 100, position: { x: 0.12, y: 0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostFixture]), [
      source('arch.ifc', [linkedFixture]),
    ])

    expect(merged.fixtures).toEqual([hostFixture])
    expect(merged.duplicates[0].distanceMm).toBe(120)
  })

  it('never dedupes fixtures of different kinds, even at the same position', () => {
    const hostToilet = fixture({ expressId: 1, kind: 'TOILETPAN', position: { x: 0, y: 0, z: 0 } })
    const linkedBasin = fixture({ expressId: 100, kind: 'WASHHANDBASIN', position: { x: 0, y: 0, z: 0 } })

    const merged = mergeStoreyDetections(source('host.ifc', [hostToilet]), [
      source('arch.ifc', [linkedBasin]),
    ])

    expect(merged.fixtures).toHaveLength(2)
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
