import { describe, expect, it } from 'vitest'
import {
  BRANCH_RATIO_ENGINEER_SET,
  BRANCH_RATIO_MAX,
  BRANCH_RATIO_MIN,
  computeGauntletMetrics,
  STACKS_RATIO_MAX,
  STACKS_RATIO_MIN,
  type GauntletMetricsInput,
} from './gauntletMetrics'

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
    ourBranchTotalM: 12,
    engineerBranchTotalM: { union: 10, literalBand: 4 },
    fixtures: { positioned: 5, routed: 5 },
    ...overrides,
  }
}

describe('computeGauntletMetrics', () => {
  it('is green when every threshold holds and reports all five numbers', () => {
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
    expect(metrics.branchRatio).toBeCloseTo(1.2, 6)
    expect(metrics.branchRatioLiteralBand).toBeCloseTo(3, 6)
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

  it('gates the branch ratio on the union set within [0.5, 2.0] and reports the literal-band ratio alongside', () => {
    expect(BRANCH_RATIO_MIN).toBe(0.5)
    expect(BRANCH_RATIO_MAX).toBe(2)
    const tooShort = computeGauntletMetrics(greenInput({ ourBranchTotalM: 4.9, engineerBranchTotalM: { union: 10, literalBand: 4 } }))
    expect(tooShort.branchRatio).toBeCloseTo(0.49, 6)
    // The literal-band ratio would pass (1.23) — it must not rescue the verdict.
    expect(tooShort.branchRatioLiteralBand).toBeCloseTo(1.225, 6)
    expect(tooShort.verdict).toBe('red')
    expect(tooShort.reds).toEqual([expect.stringMatching(/^branch length: ratio 0\.49 \(ours 4\.90 m \/ engineer 10\.00 m, union set\) outside \[0\.5, 2\]/)])

    const tooLong = computeGauntletMetrics(greenInput({ ourBranchTotalM: 20.1 }))
    expect(tooLong.verdict).toBe('red')

    const exactMax = computeGauntletMetrics(greenInput({ ourBranchTotalM: 20 }))
    expect(exactMax.branchRatio).toBe(2)
    expect(exactMax.verdict).toBe('green')

    const noEngineer = computeGauntletMetrics(greenInput({ engineerBranchTotalM: { union: null, literalBand: 4 } }))
    expect(noEngineer.branchRatio).toBeNull()
    expect(noEngineer.branchRatioLiteralBand).toBeCloseTo(3, 6)
    expect(noEngineer.reds).toEqual([expect.stringMatching(/^branch length: the engineer has no drawn horizontal run/)])

    const zeroEngineer = computeGauntletMetrics(greenInput({ engineerBranchTotalM: { union: 0, literalBand: 0 } }))
    expect(zeroEngineer.branchRatio).toBeNull()
    expect(zeroEngineer.branchRatioLiteralBand).toBeNull()
    expect(zeroEngineer.verdict).toBe('red')
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
    })
    expect(metrics.verdict).toBe('red')
    expect(metrics.reds.map((line) => line.split(':')[0])).toEqual(['obstruction', 'stacks', 'branch length', 'routed'])
    expect(metrics.branchRatioLiteralBand).toBeNull()
    for (const value of [metrics.stacksRatio, metrics.meanDistToEngineerStackM, metrics.branchRatio, metrics.routedFraction]) {
      expect(value === null || Number.isFinite(value)).toBe(true)
    }
  })
})
