import { describe, expect, it } from 'vitest'
import {
  buildFixtureFingerprint,
  chooseInitialStorey,
  isTechnicalStoreyName,
  type InitialStoreySummary,
} from './chooseInitialStorey'

function storey(
  id: number,
  name: string,
  elevation: number,
  counts: Partial<Record<'TOILETPAN' | 'SINK' | 'WASHHANDBASIN' | 'BATH', number>> = {},
): InitialStoreySummary {
  return {
    id,
    name,
    elevation,
    toiletCount: counts.TOILETPAN ?? 0,
    fixtureFingerprint: buildFixtureFingerprint(counts),
  }
}

describe('buildFixtureFingerprint', () => {
  it('sorts kinds, drops zero counts, and is deterministic', () => {
    expect(buildFixtureFingerprint({ TOILETPAN: 11, SINK: 3, BATH: 0 })).toBe('SINK:3|TOILETPAN:11')
    expect(buildFixtureFingerprint({ SINK: 3, TOILETPAN: 11 })).toBe('SINK:3|TOILETPAN:11')
    expect(buildFixtureFingerprint({})).toBe('')
  })
})

describe('isTechnicalStoreyName', () => {
  it('matches R-codes, roof and Hebrew roof names only', () => {
    expect(isTechnicalStoreyName('R2')).toBe(true)
    expect(isTechnicalStoreyName(' r0 ')).toBe(true)
    expect(isTechnicalStoreyName('Roof')).toBe(true)
    expect(isTechnicalStoreyName('Rooftop terrace')).toBe(true)
    expect(isTechnicalStoreyName('גג')).toBe(true)
    expect(isTechnicalStoreyName('גג עליון')).toBe(true)
  })

  it('never flags regular floor names, including Hebrew ones', () => {
    for (const name of ['קומה 2', 'קומה 1', 'קומת קרקע', 'Level 1', 'GF', 'B1', '01', '38', 'R2 East Wing']) {
      expect(isTechnicalStoreyName(name), name).toBe(false)
    }
  })
})

describe('chooseInitialStorey', () => {
  it('picks the lowest storey of the largest identical-fingerprint group', () => {
    const choice = chooseInitialStorey([
      storey(1, 'GF', 0, { SINK: 1 }),
      storey(2, '01', 300, { TOILETPAN: 11, SINK: 3 }),
      storey(3, '02', 600, { TOILETPAN: 11, SINK: 3 }),
      storey(4, '03', 900, { TOILETPAN: 11, SINK: 3 }),
      storey(5, '04', 1200, { TOILETPAN: 4 }),
    ])
    expect(choice.storeyId).toBe(2)
    expect(choice.reason).toContain('Lowest of 3')
    expect(choice.reason).toContain('SINK:3|TOILETPAN:11')
  })

  it('handles Hebrew storey names and never picks the roof', () => {
    const choice = chooseInitialStorey([
      storey(10, 'קומה 1', 0, { TOILETPAN: 2 }),
      storey(11, 'קומה 2', 300, { TOILETPAN: 2 }),
      storey(12, 'קומה 3', 600, { TOILETPAN: 2 }),
      storey(13, 'קומה 4', 900, { TOILETPAN: 2 }),
      storey(14, 'קומה 5', 1200, { TOILETPAN: 2 }),
      // The roof carries fixtures but must never win over regular floors.
      storey(15, 'גג', 1500, { TOILETPAN: 9 }),
    ])
    expect(choice.storeyId).toBe(10)
  })

  it('never picks an R-coded technical storey with toilets while residential storeys bear fixtures', () => {
    const choice = chooseInitialStorey([
      storey(20, 'R2', -100, { TOILETPAN: 20 }),
      storey(21, '01', 300, { TOILETPAN: 11 }),
      storey(22, '02', 600, { TOILETPAN: 11 }),
      storey(23, 'R0', 1200, { TOILETPAN: 20 }),
    ])
    expect(choice.storeyId).toBe(21)
  })

  it('falls back to the lowest toilet-bearing technical storey when only technical storeys have toilets', () => {
    const choice = chooseInitialStorey([
      storey(30, 'GF', 0),
      storey(31, 'R1', 300, { TOILETPAN: 1 }),
      storey(32, 'R2', 600, { TOILETPAN: 1 }),
    ])
    expect(choice.storeyId).toBe(31)
    expect(choice.reason).toContain('technical')
  })

  it('handles a single-storey model', () => {
    const choice = chooseInitialStorey([storey(40, 'Only Floor', 0, { TOILETPAN: 1 })])
    expect(choice.storeyId).toBe(40)
  })

  it('falls back to fixture-bearing storeys when no storey has toilets', () => {
    const choice = chooseInitialStorey([
      storey(50, 'B1', -300),
      storey(51, '01', 0, { SINK: 2 }),
      storey(52, '02', 300, { SINK: 2 }),
      storey(53, '03', 600, { BATH: 1 }),
    ])
    expect(choice.storeyId).toBe(51)
    expect(choice.reason).toContain('no toilets detected anywhere')
  })

  it('falls back to the lowest non-technical storey when no fixtures exist at all', () => {
    const choice = chooseInitialStorey([
      storey(60, 'Roof', 900),
      storey(61, '02', 600),
      storey(62, '01', 300),
      storey(63, 'B1', -300),
    ])
    expect(choice.storeyId).toBe(63)
    expect(choice.reason).toContain('no fixtures detected anywhere')
  })

  it('breaks group-size ties by the lowest storey, and equal elevations by id, deterministically', () => {
    const storeys = [
      storey(72, 'A2', 600, { TOILETPAN: 2 }),
      storey(71, 'A1', 300, { TOILETPAN: 2 }),
      storey(74, 'B2', 500, { TOILETPAN: 3 }),
      storey(73, 'B1', 200, { TOILETPAN: 3 }),
    ]
    // Two groups of two: group B's lowest member (elevation 200) wins.
    const first = chooseInitialStorey(storeys)
    expect(first.storeyId).toBe(73)

    // Same elevation inside the winning group: lowest id wins.
    const tied = chooseInitialStorey([
      storey(82, 'T2', 100, { TOILETPAN: 1 }),
      storey(81, 'T1', 100, { TOILETPAN: 1 }),
    ])
    expect(tied.storeyId).toBe(81)

    // Determinism: identical input (any order) yields the identical choice.
    expect(chooseInitialStorey([...storeys].reverse())).toEqual(first)
  })

  it('returns null with a reason for an empty storey set', () => {
    const choice = chooseInitialStorey([])
    expect(choice.storeyId).toBeNull()
    expect(choice.reason).toContain('No storeys')
  })
})
