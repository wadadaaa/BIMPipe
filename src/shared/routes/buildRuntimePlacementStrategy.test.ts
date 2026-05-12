import { describe, expect, it } from 'vitest'
import { RISER_STRATEGY_DECISION } from '@/domain/decideRiserStrategyPerToiletRoom'
import type { Fixture, Storey } from '@/domain/types'
import { buildRuntimePlacementStrategy } from './buildRuntimePlacementStrategy'

const STOREYS: Storey[] = [
  { id: 1, modelId: 'm1', name: 'B1', elevation: -3 },
  { id: 2, modelId: 'm1', name: 'L1', elevation: 0 },
  { id: 3, modelId: 'm1', name: 'L2', elevation: 3 },
  { id: 4, modelId: 'm1', name: 'Roof', elevation: 12 },
]

const fixture = (id: number, storeyId: number, position: Fixture['position']): Fixture => ({
  expressId: id,
  storeyId,
  name: `WC-${id}`,
  kind: 'TOILETPAN',
  position,
})

describe('buildRuntimePlacementStrategy', () => {
  it('maps positioned TOILETPAN fixtures into wet areas', () => {
    const out = buildRuntimePlacementStrategy(STOREYS, [fixture(11, 2, { x: 4, y: 0, z: 5 })], [{ id: 2, eligibleForNewRisers: true }])
    expect(out.wetAreas).toHaveLength(1)
    expect(out.wetAreas[0].areaId).toBe('fixture:11')
  })

  it('creates fallback COORDINATION_REQUIRED decisions for fixtures without positions', () => {
    const out = buildRuntimePlacementStrategy(STOREYS, [fixture(12, 2, null)], [{ id: 2, eligibleForNewRisers: true }])
    expect(out.placementDecisions[0].decision).toBe(RISER_STRATEGY_DECISION.COORDINATION_REQUIRED)
    expect(out.placementDecisions[0].reasons[0]).toContain('missing plan position')
  })

  it('allows eligible standard floors to receive RISER_PLACED decisions', () => {
    const out = buildRuntimePlacementStrategy(
      STOREYS,
      [fixture(21, 2, { x: 0, y: 0, z: 0 }), fixture(22, 3, { x: 0.05, y: 0, z: 0.05 })],
      [{ id: 2, eligibleForNewRisers: true }, { id: 3, eligibleForNewRisers: true }],
    )
    expect(out.placementDecisions.some((d) => d.decision === RISER_STRATEGY_DECISION.RISER_PLACED)).toBe(true)
  })

  it('keeps non-eligible floors excluded via eligibility input', () => {
    const out = buildRuntimePlacementStrategy(
      STOREYS,
      [fixture(31, 1, { x: 1, y: 0, z: 1 }), fixture(32, 4, { x: 1, y: 0, z: 1 })],
      [{ id: 1, eligibleForNewRisers: false }, { id: 4, eligibleForNewRisers: false }],
    )
    expect(out.placementDecisions.every((d) => d.decision !== RISER_STRATEGY_DECISION.RISER_PLACED)).toBe(true)
  })


  it('uses stable proxy half-width bounds for positioned toilets', () => {
    const out = buildRuntimePlacementStrategy(STOREYS, [fixture(51, 2, { x: 10, y: 0, z: -2 })], [{ id: 2, eligibleForNewRisers: true }])
    expect(out.wetAreas[0].planBounds).toEqual({ minX: 9.4, maxX: 10.6, minZ: -2.6, maxZ: -1.4 })
  })

  it('is deterministic for same input', () => {
    const fixtures = [fixture(41, 2, { x: 2, y: 0, z: 2 }), fixture(42, 3, { x: 2, y: 0, z: 2 })]
    const floors = [{ id: 2, eligibleForNewRisers: true }, { id: 3, eligibleForNewRisers: true }]
    expect(buildRuntimePlacementStrategy(STOREYS, fixtures, floors)).toEqual(buildRuntimePlacementStrategy(STOREYS, fixtures, floors))
  })
})
