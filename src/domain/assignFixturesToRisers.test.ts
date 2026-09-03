import { describe, expect, it } from 'vitest'
import type { FixtureKind } from './types'
import {
  assignFixturesToRisers,
  MAX_BRANCH_LENGTH_M,
  MAX_BRANCH_LENGTH_MM,
  type AssignableFixture,
  type AssignableRiser,
} from './assignFixturesToRisers'

function fixture(
  expressId: number,
  x: number,
  z: number,
  kind: FixtureKind = 'WASHHANDBASIN',
  storeyId = 2,
): AssignableFixture {
  return { expressId, kind, storeyId, position: { x, y: 0, z } }
}

function riser(id: string, x: number, z: number, storeyId = 2): AssignableRiser {
  return { id, stackId: `stack-${id}`, storeyId, position: { x, y: 0, z } }
}

describe('assignFixturesToRisers', () => {
  it('assigns a fixture to a riser within branch length (mm scale)', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000)],
      [riser('r1', 5000 + MAX_BRANCH_LENGTH_MM - 1, 5000)],
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      fixtureExpressId: 1,
      kind: 'WASHHANDBASIN',
      unassigned: false,
      riserId: 'r1',
      stackId: 'stack-r1',
      planDistance: MAX_BRANCH_LENGTH_MM - 1,
      units: 'mm',
    })
  })

  it('flags a fixture unassigned when the nearest riser is beyond branch length (mm scale)', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000)],
      [riser('r1', 5000 + MAX_BRANCH_LENGTH_MM + 1, 5000)],
    )

    expect(result[0]).toMatchObject({
      fixtureExpressId: 1,
      unassigned: true,
      reason: 'no-riser-within-branch-length',
    })
  })

  it('applies the metre-scale branch limit for metre models', () => {
    const within = assignFixturesToRisers(
      [fixture(1, 10, 10)],
      [riser('r1', 10 + MAX_BRANCH_LENGTH_M - 0.5, 10)],
    )
    const beyond = assignFixturesToRisers(
      [fixture(1, 10, 10)],
      [riser('r1', 10 + MAX_BRANCH_LENGTH_M + 0.5, 10)],
    )

    expect(within[0]).toMatchObject({
      unassigned: false,
      planDistance: MAX_BRANCH_LENGTH_M - 0.5,
      units: 'm',
    })
    expect(beyond[0]).toMatchObject({ unassigned: true, reason: 'no-riser-within-branch-length' })
  })

  it('honours an explicit units override instead of coordinate-based detection', () => {
    // Coordinates below 1000 look like metres; forcing mm keeps the 4000 mm limit,
    // so a 500-unit offset is well within range.
    const result = assignFixturesToRisers([fixture(1, 100, 100)], [riser('r1', 600, 100)], {
      units: 'mm',
    })

    expect(result[0]).toMatchObject({ unassigned: false, planDistance: 500, units: 'mm' })
  })

  it('selects the nearest of several in-range risers on the plan (X/Z) plane', () => {
    const result = assignFixturesToRisers(
      // y differs wildly from every riser to prove the vertical axis is ignored.
      [{ ...fixture(1, 5000, 5000), position: { x: 5000, y: 99999, z: 5000 } }],
      [riser('far', 5000, 8000), riser('near', 5000, 6000), riser('other', 2200, 5000)],
    )

    expect(result[0]).toMatchObject({ unassigned: false, riserId: 'near', planDistance: 1000 })
  })

  it('only considers risers on the fixture storey', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000, 'BATH', 2)],
      [
        // Same plan position but different floor — must not match.
        riser('other-floor', 5000, 5000, 3),
        riser('same-floor', 5000, 7000, 2),
      ],
    )

    expect(result[0]).toMatchObject({ unassigned: false, riserId: 'same-floor', planDistance: 2000 })
  })

  it('flags fixtures unassigned when their storey has no riser at all', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000, 'BATH', 2)],
      [riser('r1', 5000, 5000, 3)],
    )

    expect(result[0]).toMatchObject({ unassigned: true, reason: 'no-riser-on-storey' })
  })

  it('flags every fixture unassigned when there are no risers', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000), fixture(2, 6000, 6000, 'TOILETPAN')],
      [],
    )

    expect(result).toHaveLength(2)
    expect(result.every((entry) => entry.unassigned)).toBe(true)
    expect(result.map((entry) => (entry.unassigned ? entry.reason : null))).toEqual([
      'no-riser-on-storey',
      'no-riser-on-storey',
    ])
  })

  it('flags fixtures without a plan position as unassigned', () => {
    const result = assignFixturesToRisers(
      [{ expressId: 1, kind: 'SINK', storeyId: 2, position: null }],
      [riser('r1', 0, 0)],
    )

    expect(result[0]).toMatchObject({ unassigned: true, reason: 'no-plan-position' })
  })

  it('assigns toilets trivially to their anchor riser at ~0 distance', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000, 'TOILETPAN')],
      [riser('anchor', 5000, 5000), riser('kitchen', 9000, 9000)],
    )

    expect(result[0]).toMatchObject({ unassigned: false, riserId: 'anchor', planDistance: 0 })
  })

  it('assigns kitchen-sink fixtures like any other fixture (nearest riser)', () => {
    // The kitchen's dedicated corner riser is nearest, so the sink lands on it.
    const result = assignFixturesToRisers(
      [fixture(7, 8800, 8800, 'SINK')],
      [riser('toilet-anchor', 5000, 5000), riser('kitchen-corner', 9000, 9000)],
    )

    expect(result[0]).toMatchObject({ unassigned: false, riserId: 'kitchen-corner' })
  })

  it('returns one entry per fixture in input order and breaks distance ties on riser id', () => {
    const result = assignFixturesToRisers(
      [fixture(2, 5000, 5000), fixture(1, 5000, 6000)],
      [riser('b', 5000, 5500), riser('a', 5000, 4500)],
    )

    expect(result.map((entry) => entry.fixtureExpressId)).toEqual([2, 1])
    // Fixture 2 is 500 from both risers — the lexicographically smaller id wins.
    expect(result[0]).toMatchObject({ unassigned: false, riserId: 'a', planDistance: 500 })
    expect(result[1]).toMatchObject({ unassigned: false, riserId: 'b', planDistance: 500 })
  })

  it('marks plain nearest assignments explicitly', () => {
    const result = assignFixturesToRisers([fixture(1, 5000, 5000)], [riser('r1', 5000, 5500)])

    expect(result[0]).toMatchObject({ assignedBy: 'nearest', exceedsMaxBranchLength: false })
  })
})

describe('assignFixturesToRisers with wet-core membership (V5)', () => {
  const coreMembership = {
    fixtureCoreIds: new Map<number, string>([
      [1, 'core-A'],
      [2, 'core-A'],
    ]),
    stackCoreIds: new Map<string, string>([['stack-core-a', 'core-A']]),
  }

  it('routes a core member to its core stack even when another riser is nearer', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000)],
      [riser('core-a', 5000, 7000), riser('manual', 5000, 5200)],
      { coreMembership },
    )

    expect(result[0]).toMatchObject({
      unassigned: false,
      assignedBy: 'wet-core',
      riserId: 'core-a',
      stackId: 'stack-core-a',
      planDistance: 2000,
      exceedsMaxBranchLength: false,
    })
  })

  it('follows the preserved (moved) stack that superseded the core stack — overrides win', () => {
    // The moved stack keeps the stack id → core id mapping in the reducer; the
    // fixture follows it even beyond the branch limit, but is flagged.
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000)],
      [riser('core-a', 5000, 5000 + MAX_BRANCH_LENGTH_MM + 1000), riser('other', 5000, 5100)],
      { coreMembership },
    )

    expect(result[0]).toMatchObject({
      assignedBy: 'wet-core',
      riserId: 'core-a',
      exceedsMaxBranchLength: true,
      planDistance: MAX_BRANCH_LENGTH_MM + 1000,
    })
  })

  it('falls back to the nearest in-range riser for fixtures without a core (manual stacks, other storeys)', () => {
    const result = assignFixturesToRisers(
      [fixture(9, 5000, 5000)],
      [riser('core-a', 5000, 7000), riser('manual', 5000, 5200)],
      { coreMembership },
    )

    expect(result[0]).toMatchObject({ assignedBy: 'nearest', riserId: 'manual', planDistance: 200 })
  })

  it('falls back to nearest when the core stack has no riser on the fixture storey', () => {
    const result = assignFixturesToRisers(
      [fixture(1, 5000, 5000, 'BATH', 3)],
      [riser('core-a', 5000, 5000, 2), riser('near-3', 5000, 5300, 3)],
      { coreMembership },
    )

    expect(result[0]).toMatchObject({ assignedBy: 'nearest', riserId: 'near-3', planDistance: 300 })
  })

  it('still reports unassigned fixtures when neither a core stack nor an in-range riser exists', () => {
    const result = assignFixturesToRisers(
      [fixture(9, 5000, 5000)],
      [riser('far', 5000, 5000 + MAX_BRANCH_LENGTH_MM + 1)],
      { coreMembership },
    )

    expect(result[0]).toMatchObject({ unassigned: true, reason: 'no-riser-within-branch-length' })
  })
})
