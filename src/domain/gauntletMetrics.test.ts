import { describe, expect, it } from 'vitest'
import {
  BRANCH_RATIO_ENGINEER_SET,
  BRANCH_RATIO_MAX,
  BRANCH_RATIO_MIN,
  computeGauntletMetrics,
  computeSharedFixtureSet,
  ENGINEER_SERVES_FIXTURE_M,
  STACKS_RATIO_MAX,
  STACKS_RATIO_MIN,
  type GauntletMetricsInput,
  type GauntletSharedFixtureInput,
} from './gauntletMetrics'

/**
 * Shared-set fixture: two fixtures (1, 2) both sides serve, one (3) only we
 * route, one engineer free end with no fixture. Our segments: 1 → 3 m, 2 → 4 m
 * (a 5 m trunk carries both), fixture 3 → 2 m. Engineer: run 11 (2 m) from
 * fixture 1 and run 12 (3 m) from fixture 2 both drain into collector 13
 * (5 m); run 14 (6 m) starts 3 m from anything and drains into 13 as well.
 * Shared: ours 3 + 4 + 5 = 12 m; engineer 2 + 3 + 5 = 10 m (14 excluded).
 */
function sharedInput(overrides: Partial<GauntletSharedFixtureInput> = {}): GauntletSharedFixtureInput {
  return {
    fixtures: [
      { expressId: 1, xM: 0, yM: 0 },
      { expressId: 2, xM: 4, yM: 0 },
      { expressId: 3, xM: 20, yM: 0 },
    ],
    routedFixtureExpressIds: [1, 2, 3],
    ourSegments: [
      { planLengthM: 3, servedFixtureExpressIds: [1] },
      { planLengthM: 4, servedFixtureExpressIds: [2] },
      { planLengthM: 5, servedFixtureExpressIds: [1, 2] },
      { planLengthM: 2, servedFixtureExpressIds: [3] },
    ],
    engineerRuns: [
      { id: 11, upstream: { xM: 0.3, yM: 0 }, planLengthM: 2, drainsInto: [13] },
      { id: 12, upstream: { xM: 4, yM: 0.6 }, planLengthM: 3, drainsInto: [13] },
      { id: 13, upstream: { xM: 2, yM: 2 }, planLengthM: 5, drainsInto: [] },
      { id: 14, upstream: { xM: 10, yM: 3 }, planLengthM: 6, drainsInto: [13] },
    ],
    ...overrides,
  }
}

function greenInput(overrides: Partial<GauntletMetricsInput> = {}): GauntletMetricsInput {
  return {
    stackProbes: [
      { stackId: 's1', stackLabel: 'R1', status: 'free' },
      { stackId: 's2', stackLabel: 'R2', status: 'free' },
    ],
    ourStacks: [
      { xM: 0, yM: 0 },
      { xM: 10, yM: 0 },
    ],
    engineerStacks: [
      { xM: 1, yM: 0 },
      { xM: 10, yM: 2 },
      { xM: 20, yM: 20 },
    ],
    ourBranchTotalM: 14,
    engineerBranchTotalM: { union: 16, literalBand: 4 },
    fixtures: { positioned: 3, routed: 3 },
    sharedFixtures: sharedInput(),
    ...overrides,
  }
}

describe('computeSharedFixtureSet', () => {
  it('serves a fixture by the engineer within the tolerance of a run upstream end and by us when routed', () => {
    expect(ENGINEER_SERVES_FIXTURE_M).toBe(1)
    const shared = computeSharedFixtureSet(sharedInput())
    expect(shared.servesFixtureM).toBe(1)
    expect(shared.fixtures).toBe(3)
    expect(shared.fixturesServedByEngineer).toBe(2)
    expect(shared.fixturesServedByUs).toBe(3)
    expect(shared.shared).toBe(2)
    expect(shared.sharedFixtureExpressIds).toEqual([1, 2])
    expect(shared.fixturesOnlyEngineerServes).toBe(0)
    expect(shared.fixturesOnlyWeServe).toBe(1)
  })

  it('sums our segments carrying any shared fixture once and walks engineer attribution downstream', () => {
    const shared = computeSharedFixtureSet(sharedInput())
    // 3 (fixture 1) + 4 (fixture 2) + 5 (trunk, counted once) — the 2 m leg of fixture 3 is out.
    expect(shared.ourBranchSharedM).toBe(12)
    // 11 + 12 directly, 13 by the downstream walk (once); 14 has no attribution.
    expect(shared.engineerBranchSharedM).toBe(10)
    expect(shared.engineerRunsAttributed).toBe(3)
    expect(shared.engineerRunsUnattributed).toBe(1)
    expect(shared.engineerRunsUnattributedM).toBe(6)
    // 14 is a leaf (nothing drains into it) with no fixture near its upstream end.
    expect(shared.engineerLeafEndsWithoutFixture).toBe(1)
  })

  it('counts a collector once even when only one of its feeding fixtures is shared', () => {
    // Fixture 2 is not routed by us → only fixture 1 is shared; the 5 m collector still counts once.
    const shared = computeSharedFixtureSet(sharedInput({ routedFixtureExpressIds: [1, 3] }))
    expect(shared.shared).toBe(1)
    expect(shared.fixturesOnlyEngineerServes).toBe(1)
    expect(shared.fixturesOnlyWeServe).toBe(1)
    expect(shared.ourBranchSharedM).toBe(3 + 5)
    expect(shared.engineerBranchSharedM).toBe(2 + 5)
  })

  it('attributes a run to the nearest fixture within the tolerance and follows the tolerance', () => {
    const base = sharedInput({
      fixtures: [
        { expressId: 1, xM: 0, yM: 0 },
        { expressId: 2, xM: 0.9, yM: 0 },
      ],
      routedFixtureExpressIds: [1, 2],
      ourSegments: [
        { planLengthM: 1, servedFixtureExpressIds: [1] },
        { planLengthM: 1, servedFixtureExpressIds: [2] },
      ],
      engineerRuns: [{ id: 11, upstream: { xM: 0.8, yM: 0 }, planLengthM: 2, drainsInto: [] }],
    })
    const at1 = computeSharedFixtureSet(base)
    expect(at1.sharedFixtureExpressIds).toEqual([2])
    expect(at1.fixturesOnlyWeServe).toBe(1)
    const at075 = computeSharedFixtureSet({ ...base, servesFixtureM: 0.75 })
    // 0.8 m from fixture 1, 0.1 m from fixture 2: still fixture 2 (nearest), unaffected.
    expect(at075.sharedFixtureExpressIds).toEqual([2])
    // 2.2 m from fixture 1, 1.3 m from fixture 2: outside 1.0 m, inside 1.5 m.
    const farInput = { ...base, engineerRuns: [{ id: 11, upstream: { xM: 2.2, yM: 0 }, planLengthM: 2, drainsInto: [] }] }
    const far = computeSharedFixtureSet(farInput)
    expect(far.shared).toBe(0)
    expect(far.engineerRunsUnattributed).toBe(1)
    expect(far.engineerLeafEndsWithoutFixture).toBe(1)
    const farWide = computeSharedFixtureSet({ ...farInput, servesFixtureM: 1.5 })
    expect(farWide.sharedFixtureExpressIds).toEqual([2])
    expect(farWide.engineerLeafEndsWithoutFixture).toBe(0)
  })

  it('survives connectivity cycles, unknown ids and ignores routed ids that are not positioned fixtures', () => {
    const shared = computeSharedFixtureSet(
      sharedInput({
        routedFixtureExpressIds: [1, 2, 3, 99],
        engineerRuns: [
          { id: 11, upstream: { xM: 0, yM: 0 }, planLengthM: 2, drainsInto: [12, 500] },
          { id: 12, upstream: { xM: 9, yM: 9 }, planLengthM: 3, drainsInto: [11] },
        ],
      }),
    )
    expect(shared.fixturesServedByUs).toBe(3)
    expect(shared.sharedFixtureExpressIds).toEqual([1])
    expect(shared.engineerBranchSharedM).toBe(5)
    expect(shared.engineerRunsUnattributed).toBe(0)
  })

  it('is deterministic under input order', () => {
    const a = computeSharedFixtureSet(sharedInput())
    const input = sharedInput()
    const b = computeSharedFixtureSet({
      ...input,
      fixtures: [...input.fixtures].reverse(),
      engineerRuns: [...input.engineerRuns].reverse(),
      ourSegments: [...input.ourSegments].reverse(),
    })
    expect(b).toEqual(a)
  })
})

describe('computeGauntletMetrics', () => {
  it('is green when every threshold holds and reports all numbers', () => {
    const metrics = computeGauntletMetrics(greenInput())
    expect(metrics.verdict).toBe('green')
    expect(metrics.reds).toEqual([])
    expect(metrics.obstruction).toBe(0)
    expect(metrics.unknownProbes).toBe(0)
    expect(metrics.stacksRatio).toBeCloseTo(2 / 3, 6)
    expect(metrics.ourStackCount).toBe(2)
    expect(metrics.engineerStackCount).toBe(3)
    // nearest: (0,0)→(1,0) = 1; (10,0)→(10,2) = 2 → mean 1.5
    expect(metrics.meanDistToEngineerStackM).toBeCloseTo(1.5, 6)
    // Gated ratio on the shared set: 12 / 10; full sets 14 / 16 and 14 / 4 reported alongside.
    expect(metrics.branchRatio).toBeCloseTo(1.2, 6)
    expect(metrics.branchRatioFullUnion).toBeCloseTo(0.875, 6)
    expect(metrics.branchRatioLiteralBand).toBeCloseTo(3.5, 6)
    expect(metrics.sharedFixtures.shared).toBe(2)
    expect(metrics.sharedFixtures.fixturesOnlyWeServe).toBe(1)
    expect(metrics.routedFraction).toBe(1)
    expect(BRANCH_RATIO_ENGINEER_SET).toBe('union')
  })

  it('counts blocked probes as obstructions (red) and unknown probes separately (not red)', () => {
    const metrics = computeGauntletMetrics(
      greenInput({
        stackProbes: [
          { stackId: 's1', stackLabel: 'R1', status: 'blocked' },
          { stackId: 's2', stackLabel: 'R2', status: 'unknown' },
          { stackId: 's3', stackLabel: 'R3', status: 'blocked' },
        ],
      }),
    )
    expect(metrics.obstruction).toBe(2)
    expect(metrics.unknownProbes).toBe(1)
    expect(metrics.verdict).toBe('red')
    expect(metrics.reds).toHaveLength(1)
    expect(metrics.reds[0]).toMatch(/^obstruction: 2 stack\(s\).*\(R1, R3\)/)

    const unknownOnly = computeGauntletMetrics(
      greenInput({ stackProbes: [{ stackId: 's1', stackLabel: 'R1', status: 'unknown' }] }),
    )
    expect(unknownOnly.obstruction).toBe(0)
    expect(unknownOnly.unknownProbes).toBe(1)
    expect(unknownOnly.verdict).toBe('green')
  })

  it('reds the stacks ratio outside [0.6, 1.5] and when the engineer has none', () => {
    expect(STACKS_RATIO_MIN).toBe(0.6)
    expect(STACKS_RATIO_MAX).toBe(1.5)
    const tooFew = computeGauntletMetrics(greenInput({ ourStacks: [{ xM: 0, yM: 0 }] }))
    expect(tooFew.stacksRatio).toBeCloseTo(1 / 3, 6)
    expect(tooFew.reds).toEqual([expect.stringMatching(/^stacks: ratio 0\.33 \(ours 1 \/ engineer 3\) outside \[0\.6, 1\.5\]/)])

    const tooMany = computeGauntletMetrics(
      greenInput({ ourStacks: [0, 1, 2, 3, 4].map((i) => ({ xM: i, yM: 0 })) }),
    )
    expect(tooMany.stacksRatio).toBeCloseTo(5 / 3, 6)
    expect(tooMany.verdict).toBe('red')

    const boundary = computeGauntletMetrics(
      greenInput({ ourStacks: [{ xM: 0, yM: 0 }, { xM: 10, yM: 0 }], engineerStacks: [{ xM: 0, yM: 0 }, { xM: 5, yM: 0 }] }),
    )
    expect(boundary.stacksRatio).toBe(1)
    expect(boundary.verdict).toBe('green')

    const noEngineer = computeGauntletMetrics(greenInput({ engineerStacks: [] }))
    expect(noEngineer.stacksRatio).toBeNull()
    expect(noEngineer.meanDistToEngineerStackM).toBeNull()
    expect(noEngineer.reds).toEqual([expect.stringMatching(/^stacks: the engineer has no sanitary stack/)])
  })

  it('reports the mean distance without gating it', () => {
    const far = computeGauntletMetrics(greenInput({ engineerStacks: [{ xM: 100, yM: 0 }, { xM: 100, yM: 0 }, { xM: 100, yM: 0 }] }))
    expect(far.meanDistToEngineerStackM).toBeCloseTo(95, 6)
    expect(far.verdict).toBe('green')
    expect(computeGauntletMetrics(greenInput({ ourStacks: [] })).meanDistToEngineerStackM).toBeNull()
  })

  it('gates the branch ratio on the shared fixture set within [0.5, 2.0] and reports the full-set ratios alongside', () => {
    expect(BRANCH_RATIO_MIN).toBe(0.5)
    expect(BRANCH_RATIO_MAX).toBe(2)
    // Our shared length 4.9 m (3 + 1.9 trunk, fixture-2 leg 0) against the engineer's 10 m.
    const tooShort = computeGauntletMetrics(
      greenInput({
        ourBranchTotalM: 10,
        sharedFixtures: sharedInput({
          ourSegments: [
            { planLengthM: 3, servedFixtureExpressIds: [1] },
            { planLengthM: 1.9, servedFixtureExpressIds: [1, 2] },
            { planLengthM: 5.1, servedFixtureExpressIds: [3] },
          ],
        }),
      }),
    )
    expect(tooShort.branchRatio).toBeCloseTo(0.49, 6)
    // The full-set ratios would pass (10 / 16, 10 / 4 → 2.5 fails, but neither gates) — they must not rescue the verdict.
    expect(tooShort.branchRatioFullUnion).toBeCloseTo(0.625, 6)
    expect(tooShort.verdict).toBe('red')
    expect(tooShort.reds).toEqual([
      expect.stringMatching(
        /^branch length: ratio 0\.49 \(ours 4\.90 m \/ engineer 10\.00 m on the 2 fixture\(s\) both sides serve, union set; full set 0\.63\) outside \[0\.5, 2\]/,
      ),
    ])

    const tooLong = computeGauntletMetrics(
      greenInput({ sharedFixtures: sharedInput({ ourSegments: [{ planLengthM: 20.1, servedFixtureExpressIds: [1, 2] }] }) }),
    )
    expect(tooLong.branchRatio).toBeCloseTo(2.01, 6)
    expect(tooLong.verdict).toBe('red')

    const exactMax = computeGauntletMetrics(
      greenInput({ sharedFixtures: sharedInput({ ourSegments: [{ planLengthM: 20, servedFixtureExpressIds: [1] }] }) }),
    )
    expect(exactMax.branchRatio).toBe(2)
    expect(exactMax.verdict).toBe('green')

    const noEngineer = computeGauntletMetrics(greenInput({ engineerBranchTotalM: { union: null, literalBand: 4 } }))
    expect(noEngineer.branchRatioFullUnion).toBeNull()
    expect(noEngineer.branchRatioLiteralBand).toBeCloseTo(3.5, 6)
    expect(noEngineer.reds).toEqual([expect.stringMatching(/^branch length: the engineer has no drawn horizontal run/)])

    const zeroEngineer = computeGauntletMetrics(greenInput({ engineerBranchTotalM: { union: 0, literalBand: 0 } }))
    expect(zeroEngineer.branchRatioFullUnion).toBeNull()
    expect(zeroEngineer.branchRatioLiteralBand).toBeNull()
    expect(zeroEngineer.verdict).toBe('red')

    // Engineer runs exist but none ends near a fixture we route: no shared set, red with the counts.
    const disjoint = computeGauntletMetrics(greenInput({ sharedFixtures: sharedInput({ routedFixtureExpressIds: [3] }) }))
    expect(disjoint.branchRatio).toBeNull()
    expect(disjoint.branchRatioFullUnion).toBeCloseTo(0.875, 6)
    expect(disjoint.reds).toEqual([
      'branch length: no fixture is served by both sides (engineer serves 2, we route 1 of 3 within 1 m), ratio undefined',
    ])
  })

  it('requires every positioned fixture to be routed', () => {
    const partial = computeGauntletMetrics(greenInput({ fixtures: { positioned: 4, routed: 3 } }))
    expect(partial.routedFraction).toBeCloseTo(0.75, 6)
    expect(partial.reds).toEqual(['routed: 3/4 positioned fixtures routed (0.75); must be 1'])

    const none = computeGauntletMetrics(greenInput({ fixtures: { positioned: 0, routed: 0 } }))
    expect(none.routedFraction).toBeNull()
    expect(none.reds).toEqual(['routed: no positioned fixture on the storey'])
  })

  it('lists every failed threshold, in metric order, and never NaN', () => {
    const metrics = computeGauntletMetrics({
      stackProbes: [{ stackId: 's1', stackLabel: 'R1', status: 'blocked' }],
      ourStacks: [{ xM: 0, yM: 0 }],
      engineerStacks: [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 2, yM: 0 }],
      ourBranchTotalM: 1,
      engineerBranchTotalM: { union: 50, literalBand: null },
      fixtures: { positioned: 3, routed: 1 },
      sharedFixtures: sharedInput({ ourSegments: [{ planLengthM: 1, servedFixtureExpressIds: [1] }] }),
    })
    expect(metrics.verdict).toBe('red')
    expect(metrics.reds.map((line) => line.split(':')[0])).toEqual(['obstruction', 'stacks', 'branch length', 'routed'])
    expect(metrics.branchRatioLiteralBand).toBeNull()
    for (const value of [metrics.stacksRatio, metrics.meanDistToEngineerStackM, metrics.branchRatio, metrics.branchRatioFullUnion, metrics.routedFraction]) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })
})
