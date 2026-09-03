import { describe, expect, it } from 'vitest'
import {
  alignStoreysByElevation,
  SHARED_ORIGIN_XY_TOLERANCE_MM,
  STOREY_ALIGNMENT_TOLERANCE_MM,
  type AlignmentModelInput,
} from './alignStoreys'

function hostModel(overrides: Partial<AlignmentModelInput> = {}): AlignmentModelInput {
  return {
    fileName: 'host.ifc',
    lengthUnit: 'cm',
    buildingPlacement: { x: 0, y: 0, z: 0 },
    storeys: [
      { id: 1, name: 'GF', elevation: 2365 },
      { id: 2, name: '01', elevation: 3015 },
      { id: 3, name: 'Sea Level', elevation: 0 },
    ],
    ...overrides,
  }
}

function linkedModel(overrides: Partial<AlignmentModelInput> = {}): AlignmentModelInput {
  return {
    fileName: 'linked.ifc',
    lengthUnit: 'cm',
    // Linked building sits 2365 cm above the host zero — its storey
    // elevations are building-relative and must be offset by the placement.
    buildingPlacement: { x: 0, y: 0, z: 2365 },
    storeys: [
      { id: 10, name: '00', elevation: 0 },
      { id: 11, name: '01', elevation: 650 },
      { id: 12, name: 'SL', elevation: -2365 },
    ],
    ...overrides,
  }
}

describe('alignStoreysByElevation', () => {
  it('maps storeys with equal absolute elevations across different placement offsets', () => {
    const alignment = alignStoreysByElevation(hostModel(), linkedModel())

    expect(alignment.status).toBe('aligned')
    expect(alignment.pairs.map((pair) => [pair.host.storeyName, pair.linked.storeyName])).toEqual([
      ['Sea Level', 'SL'],
      ['GF', '00'],
      ['01', '01'],
    ])
    for (const pair of alignment.pairs) {
      expect(pair.deltaMm).toBe(0)
      expect(pair.host.absoluteElevationM).toBeCloseTo(pair.linked.absoluteElevationM, 6)
    }
    expect(alignment.unmappedHost).toEqual([])
    expect(alignment.unmappedLinked).toEqual([])
    expect(alignment.toleranceMm).toBe(STOREY_ALIGNMENT_TOLERANCE_MM)
  })

  it('converts each file with its own declared unit', () => {
    // Host in metres, linked in millimetres, same physical levels.
    const alignment = alignStoreysByElevation(
      hostModel({
        lengthUnit: 'm',
        storeys: [{ id: 1, name: 'L1', elevation: 3 }],
        buildingPlacement: { x: 0, y: 0, z: 0 },
      }),
      linkedModel({
        lengthUnit: 'mm',
        storeys: [{ id: 10, name: 'Level 1', elevation: 1000 }],
        buildingPlacement: { x: 0, y: 0, z: 2000 },
      }),
    )

    expect(alignment.pairs).toHaveLength(1)
    expect(alignment.pairs[0].host.absoluteElevationM).toBe(3)
    expect(alignment.pairs[0].linked.absoluteElevationM).toBe(3)
  })

  it('matches within tolerance and reports the signed delta', () => {
    const alignment = alignStoreysByElevation(
      hostModel({ storeys: [{ id: 1, name: 'GF', elevation: 2365 }] }),
      // 14 cm = 140 mm above the host storey: inside the 150 mm tolerance.
      linkedModel({ storeys: [{ id: 10, name: '00', elevation: 14 }] }),
    )

    expect(alignment.pairs).toHaveLength(1)
    expect(alignment.pairs[0].deltaMm).toBe(140)
  })

  it('does not match just beyond the tolerance and lists both sides as unmapped', () => {
    const alignment = alignStoreysByElevation(
      hostModel({ storeys: [{ id: 1, name: 'GF', elevation: 2365 }] }),
      // 15.1 cm = 151 mm: outside the 150 mm tolerance.
      linkedModel({ storeys: [{ id: 10, name: '00', elevation: 15.1 }] }),
    )

    expect(alignment.pairs).toEqual([])
    expect(alignment.unmappedHost.map((entry) => entry.storeyName)).toEqual(['GF'])
    expect(alignment.unmappedLinked.map((entry) => entry.storeyName)).toEqual(['00'])
  })

  it('matches exactly at the tolerance boundary', () => {
    const alignment = alignStoreysByElevation(
      hostModel({ storeys: [{ id: 1, name: 'GF', elevation: 2365 }] }),
      // Exactly 150 mm below: inclusive boundary.
      linkedModel({ storeys: [{ id: 10, name: '00', elevation: -15 }] }),
    )

    expect(alignment.pairs).toHaveLength(1)
    expect(alignment.pairs[0].deltaMm).toBe(-150)
  })

  it('assigns each storey at most once, preferring the smaller delta', () => {
    const alignment = alignStoreysByElevation(
      hostModel({
        storeys: [
          { id: 1, name: 'A', elevation: 0 },
          { id: 2, name: 'B', elevation: 10 },
        ],
      }),
      linkedModel({
        buildingPlacement: { x: 0, y: 0, z: 0 },
        // One linked storey 2 cm above host B: pairs with B (20 mm) and leaves A unmapped
        // even though A is also within tolerance (120 mm).
        storeys: [{ id: 10, name: 'X', elevation: 12 }],
      }),
    )

    expect(alignment.pairs).toHaveLength(1)
    expect(alignment.pairs[0].host.storeyName).toBe('B')
    expect(alignment.unmappedHost.map((entry) => entry.storeyName)).toEqual(['A'])
  })

  it('reports a shared origin when building placements agree in plan', () => {
    const alignment = alignStoreysByElevation(
      hostModel({ buildingPlacement: { x: 18144050.95, y: 66462427.17, z: 0 } }),
      linkedModel({ buildingPlacement: { x: 18144050.95, y: 66462427.17, z: 2365 } }),
    )

    expect(alignment.originAgreement.status).toBe('shared')
    expect(alignment.originAgreement.distanceMm).toBe(0)
    expect(alignment.originAgreement.warning).toBeNull()
  })

  it('warns explicitly when building placements disagree beyond the XY tolerance', () => {
    const alignment = alignStoreysByElevation(
      hostModel({ buildingPlacement: { x: 0, y: 0, z: 0 } }),
      // 100 cm = 1000 mm apart in plan: beyond the 500 mm origin tolerance.
      linkedModel({ buildingPlacement: { x: 100, y: 0, z: 2365 } }),
    )

    expect(alignment.originAgreement.status).toBe('mismatch')
    expect(alignment.originAgreement.distanceMm).toBe(1000)
    expect(alignment.originAgreement.warning).toContain(`${SHARED_ORIGIN_XY_TOLERANCE_MM} mm`)
    // Mapping still runs — the mismatch is surfaced, never silently applied.
    expect(alignment.status).toBe('aligned')
    expect(alignment.pairs.length).toBeGreaterThan(0)
  })

  it('blocks alignment when a file has no declared length unit', () => {
    const alignment = alignStoreysByElevation(hostModel(), linkedModel({ lengthUnit: null }))

    expect(alignment.status).toBe('blocked')
    expect(alignment.blockedReason).toContain('length unit')
    expect(alignment.pairs).toEqual([])
    expect(alignment.originAgreement.status).toBe('unknown')
  })

  it('blocks alignment when a building placement is unresolvable', () => {
    const alignment = alignStoreysByElevation(hostModel({ buildingPlacement: null }), linkedModel())

    expect(alignment.status).toBe('blocked')
    expect(alignment.blockedReason).toContain('IfcBuilding placement')
  })

  it('is deterministic: same inputs produce identical output', () => {
    const run = () => alignStoreysByElevation(hostModel(), linkedModel())
    expect(run()).toEqual(run())
  })
})
