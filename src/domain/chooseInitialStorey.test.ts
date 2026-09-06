import { describe, expect, it } from 'vitest'
import {
  buildFamilyKey,
  buildFixtureFingerprint,
  chooseInitialStorey,
  countFixturesInFingerprint,
  isTechnicalStoreyName,
  parseFixtureFingerprint,
  rankInitialStoreyFamilies,
  type InitialStoreySummary,
} from './chooseInitialStorey'

type Counts = Partial<Record<'TOILETPAN' | 'SINK' | 'WASHHANDBASIN' | 'BATH' | 'BIDET', number>>

function storey(id: number, name: string, elevation: number, counts: Counts = {}): InitialStoreySummary {
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

describe('parseFixtureFingerprint / countFixturesInFingerprint', () => {
  it('round-trips a fingerprint and sums every kind as one fixture each', () => {
    expect(parseFixtureFingerprint('SINK:3|TOILETPAN:11')).toEqual([
      ['SINK', 3],
      ['TOILETPAN', 11],
    ])
    expect(parseFixtureFingerprint('')).toEqual([])
    expect(countFixturesInFingerprint('SINK:3|TOILETPAN:11')).toBe(14)
    expect(countFixturesInFingerprint('TOILETPAN:2|WASHHANDBASIN:2')).toBe(4)
    expect(countFixturesInFingerprint('')).toBe(0)
  })
})

describe('buildFamilyKey', () => {
  it('keys by toilet count plus the set of fixture kinds, ignoring non-toilet counts', () => {
    const level1 = storey(1, 'Level 1', 0, { TOILETPAN: 2, WASHHANDBASIN: 2 })
    const level2 = storey(2, 'Level 2', 3, { TOILETPAN: 2, WASHHANDBASIN: 4 })
    expect(buildFamilyKey(level1)).toBe('2|TOILETPAN+WASHHANDBASIN')
    expect(buildFamilyKey(level2)).toBe(buildFamilyKey(level1))

    // Different toilet count or different kind set → different family.
    expect(buildFamilyKey(storey(3, 'X', 6, { TOILETPAN: 3, WASHHANDBASIN: 2 }))).toBe('3|TOILETPAN+WASHHANDBASIN')
    expect(buildFamilyKey(storey(4, 'Y', 9, { TOILETPAN: 2 }))).toBe('2|TOILETPAN')
    expect(buildFamilyKey(storey(5, 'Z', 12))).toBe('0|')
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
  it('picks the lowest storey of the heaviest fixture family (repeated typical floors)', () => {
    const choice = chooseInitialStorey([
      storey(1, 'GF', 0, { SINK: 1 }),
      storey(2, '01', 300, { TOILETPAN: 11, SINK: 3 }),
      storey(3, '02', 600, { TOILETPAN: 11, SINK: 3 }),
      storey(4, '03', 900, { TOILETPAN: 11, SINK: 3 }),
      storey(5, '04', 1200, { TOILETPAN: 4 }),
    ])
    expect(choice.storeyId).toBe(2)
    expect(choice.reason).toContain('Lowest of 3')
    expect(choice.reason).toContain('weight 42 = 3 × 14 fixtures/storey')
    expect(choice.reason).toContain('SINK:3|TOILETPAN:11')
    expect(choice.reason).toContain('runner-up ["04"] (weight 4')
  })

  it('all-singleton fingerprints: the storey with the most fixtures wins, not the lowest', () => {
    // Shaped like a real 44-storey plumbing model after the classifier fix:
    // five fixture-bearing storeys, all with distinct fingerprints, and the
    // reference floor "01" carrying 11 toilets. The old "largest group, then
    // lowest" rule fell back to the lowest storey ("Sea Level").
    const storeys = [
      storey(100, 'Sea Level', 0, { TOILETPAN: 2 }),
      storey(101, 'B1', 1700),
      storey(102, 'R2', 2000),
      storey(103, 'GF', 2365),
      storey(104, '01', 3015, { TOILETPAN: 11, WASHHANDBASIN: 2 }),
      storey(105, '02', 3335),
      storey(108, '08', 5255, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
      storey(137, '37', 14800, { TOILETPAN: 3 }),
      storey(138, '38', 15150, { TOILETPAN: 1 }),
      storey(140, 'R0', 15500),
      storey(141, 'R1', 15860),
    ]
    const choice = chooseInitialStorey(storeys)
    expect(choice.storeyId).toBe(104)

    const ranked = rankInitialStoreyFamilies(storeys)
    expect(ranked.map((family) => [family.members[0].name, family.weight])).toEqual([
      ['01', 13],
      ['37', 3], // weight tie with "08" (3): more toilets (3 vs 2) wins
      ['08', 3],
      ['Sea Level', 2],
      ['38', 1],
    ])
  })

  it('weights families as group size × fixtures per storey', () => {
    // 3 storeys × 2 fixtures = 6 beats 1 × 5.
    const manyLow = chooseInitialStorey([
      storey(1, 'GF', 0, { TOILETPAN: 1, WASHHANDBASIN: 4 }),
      storey(2, '01', 300, { TOILETPAN: 1, SINK: 1 }),
      storey(3, '02', 600, { TOILETPAN: 1, SINK: 1 }),
      storey(4, '03', 900, { TOILETPAN: 1, SINK: 1 }),
    ])
    expect(manyLow.storeyId).toBe(2)
    expect(manyLow.reason).toContain('weight 6 = 3 × 2 fixtures/storey')

    // 1 × 11 beats 3 × 2.
    const oneHigh = chooseInitialStorey([
      storey(1, 'GF', 0, { TOILETPAN: 11 }),
      storey(2, '01', 300, { TOILETPAN: 1, SINK: 1 }),
      storey(3, '02', 600, { TOILETPAN: 1, SINK: 1 }),
      storey(4, '03', 900, { TOILETPAN: 1, SINK: 1 }),
    ])
    expect(oneHigh.storeyId).toBe(1)
    expect(oneHigh.reason).toContain('weight 11 = 1 × 11 fixtures/storey')
  })

  it('keeps storeys with the same toilet count and kinds in one family and opens its lowest member', () => {
    // Shaped like the bundled Duplex sample: Level 2 has more basins but the
    // same toilets and kinds, so both levels form one family (weight 10 =
    // 2 × 5) and the lowest member, Level 1, is opened — not Level 2 despite
    // its higher own fixture count.
    const choice = chooseInitialStorey([
      storey(1, 'Level 1', 0, { TOILETPAN: 2, WASHHANDBASIN: 2 }),
      storey(2, 'Level 2', 3.1, { TOILETPAN: 2, WASHHANDBASIN: 4 }),
      storey(3, 'Roof', 6),
    ])
    expect(choice.storeyId).toBe(1)
    expect(choice.reason).toContain('Lowest of 2')
    expect(choice.reason).toContain('weight 10 = 2 × 5 fixtures/storey')
  })

  it('splits a lobby-like floor with extra fixture kinds from the typical floors', () => {
    // Same toilet count but an extra kind (sinks) → separate family, so the
    // repeated typical floors (3 × 4 = 12) beat the single lobby floor (1 × 11)
    // and the lowest typical floor opens, not the lobby.
    const choice = chooseInitialStorey([
      storey(1, 'GF', 0, { TOILETPAN: 2, WASHHANDBASIN: 6, SINK: 3 }),
      storey(2, '01', 300, { TOILETPAN: 2, WASHHANDBASIN: 2 }),
      storey(3, '02', 600, { TOILETPAN: 2, WASHHANDBASIN: 2 }),
      storey(4, '03', 900, { TOILETPAN: 2, WASHHANDBASIN: 2 }),
    ])
    expect(choice.storeyId).toBe(2)
  })

  it('handles Hebrew storey names and never picks the roof', () => {
    const choice = chooseInitialStorey([
      storey(9, 'קומת קרקע', -300, { TOILETPAN: 1 }),
      storey(10, 'קומה 1', 0, { TOILETPAN: 2 }),
      storey(11, 'קומה 2', 300, { TOILETPAN: 2 }),
      storey(12, 'קומה 3', 600, { TOILETPAN: 2 }),
      storey(13, 'קומה 4', 900, { TOILETPAN: 2 }),
      storey(14, 'קומה 5', 1200, { TOILETPAN: 2 }),
      // The roof carries fixtures but must never win over regular floors.
      storey(15, 'גג', 1500, { TOILETPAN: 9 }),
    ])
    expect(choice.storeyId).toBe(10)
    expect(choice.reason).toContain('"קומה 1", "קומה 2"')
    expect(choice.reason).not.toContain('גג')
  })

  it('never picks roof/technical storeys (R1, Roof, גג, zero fixtures) while a fixture-bearing storey exists', () => {
    const choice = chooseInitialStorey([
      storey(20, 'R2', -100, { TOILETPAN: 20 }),
      storey(21, 'B1', 0),
      storey(22, '01', 300, { TOILETPAN: 1 }),
      storey(23, 'R1', 1200, { TOILETPAN: 20 }),
      storey(24, 'Roof', 1500, { TOILETPAN: 20, WASHHANDBASIN: 20 }),
      storey(25, 'גג', 1800, { TOILETPAN: 20, WASHHANDBASIN: 20 }),
      storey(26, 'R0', 2100),
    ])
    // The single 1-toilet regular storey beats every heavier technical storey.
    expect(choice.storeyId).toBe(22)
  })

  it('falls back to the heaviest toilet-bearing technical storey when only technical storeys have toilets', () => {
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
    expect(choice.reason).toContain('1 family among 1 candidate(s)')
    expect(choice.reason).not.toContain('runner-up')
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

  it('ranks by weight, then toilets, then family size, then lowest elevation, then id', () => {
    // Weight decides first: two 3-toilet floors (6) beat two 2-toilet floors (4)
    // even though the 2-toilet family sits lower.
    const heavier = chooseInitialStorey([
      storey(72, 'A2', 600, { TOILETPAN: 2 }),
      storey(71, 'A1', 300, { TOILETPAN: 2 }),
      storey(74, 'B2', 500, { TOILETPAN: 3 }),
      storey(73, 'B1', 200, { TOILETPAN: 3 }),
    ])
    expect(heavier.storeyId).toBe(73)

    // Equal weight (6 vs 6): more toilets per storey wins.
    const moreToilets = chooseInitialStorey([
      storey(81, 'C1', 100, { TOILETPAN: 1, WASHHANDBASIN: 2 }),
      storey(82, 'C2', 400, { TOILETPAN: 1, WASHHANDBASIN: 2 }),
      storey(83, 'D1', 700, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
      storey(84, 'D2', 1000, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
    ])
    expect(moreToilets.storeyId).toBe(83)

    // Equal weight (6) and toilets (2): the larger family (repetition) wins
    // over a single storey, even though the single storey sits lower.
    const largerFamily = chooseInitialStorey([
      storey(91, 'E1', 0, { TOILETPAN: 2, SINK: 4 }),
      storey(92, 'F1', 300, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
      storey(93, 'F2', 600, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
    ])
    expect(largerFamily.storeyId).toBe(92)

    // Equal weight, toilets and size: the family whose lowest storey sits
    // lower wins (G at 200 beats H at 300).
    const storeys = [
      storey(103, 'H1', 300, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
      storey(104, 'H2', 600, { TOILETPAN: 2, WASHHANDBASIN: 1 }),
      storey(101, 'G1', 200, { TOILETPAN: 2, SINK: 1 }),
      storey(102, 'G2', 500, { TOILETPAN: 2, SINK: 1 }),
    ]
    const lowest = chooseInitialStorey(storeys)
    expect(lowest.storeyId).toBe(101)

    // Same elevation inside the winning family: lowest id wins.
    const tied = chooseInitialStorey([
      storey(112, 'T2', 100, { TOILETPAN: 1 }),
      storey(111, 'T1', 100, { TOILETPAN: 1 }),
    ])
    expect(tied.storeyId).toBe(111)

    // Determinism: identical input (any order) yields the identical choice.
    expect(chooseInitialStorey([...storeys].reverse())).toEqual(lowest)
  })

  it('returns null with a reason for an empty storey set', () => {
    const choice = chooseInitialStorey([])
    expect(choice.storeyId).toBeNull()
    expect(choice.reason).toContain('No storeys')
    expect(rankInitialStoreyFamilies([])).toEqual([])
  })
})
