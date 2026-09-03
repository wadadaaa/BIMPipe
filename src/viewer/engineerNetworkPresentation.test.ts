import { describe, expect, it } from 'vitest'
import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { EngineerPipeNetwork, EngineerPipeSegment, EngineerRiserStack } from '@/domain/engineerPipes'
import {
  getEngineerOverlayPresentation,
  resolveEngineerStoreyId,
} from './engineerNetworkPresentation'

function segment(overrides: Partial<EngineerPipeSegment>): EngineerPipeSegment {
  return {
    expressId: 1,
    name: null,
    systemName: 'SW-GRV 1',
    storeyId: 10,
    storeyName: '01',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 100, y: 0, z: 0 },
    endpointSource: 'extrusion-axis',
    outerDiameterMm: 110,
    lengthM: 1,
    invertElevationM: null,
    ...overrides,
  }
}

// A centimetre model (like 096): metersPerSourceUnit 0.01.
function network(segments: EngineerPipeSegment[]): EngineerPipeNetwork {
  return {
    metersPerSourceUnit: 0.01,
    storeys: [{ id: 10, name: '01', elevationSource: 3015 }],
    segments,
  }
}

const stacks: EngineerRiserStack[] = [
  {
    id: 'engineer-riser-1',
    systemClass: 'sanitary',
    xM: 20,
    yM: 30,
    zMinM: 30.15,
    zMaxM: 33.35,
    extentM: 3.2,
    storeys: [{ id: 10, name: '01' }],
    spannedStoreyIds: [10],
    diameterMm: 110,
    segmentExpressIds: [1],
  },
]

describe('resolveEngineerStoreyId', () => {
  const alignments: StoreyAlignment[] = [
    {
      hostFileName: 'host.ifc',
      linkedFileName: 'linked.ifc',
      status: 'aligned',
      blockedReason: null,
      toleranceMm: 150,
      pairs: [
        {
          host: { storeyId: 5, storeyName: 'GF', absoluteElevationM: 23.65 },
          linked: { storeyId: 77, storeyName: '00', absoluteElevationM: 23.65 },
          deltaMm: 0,
        },
      ],
      unmappedHost: [],
      unmappedLinked: [],
      originAgreement: { status: 'shared', distanceMm: 0, warning: null },
    },
  ]

  it('returns the host storey itself when the network came from the host file', () => {
    expect(
      resolveEngineerStoreyId({
        engineerSourceFileName: 'host.ifc',
        hostFileName: 'host.ifc',
        selectedStoreyId: 5,
        alignments,
      }),
    ).toBe(5)
  })

  it('maps through the W4 alignment when the network came from a linked file', () => {
    expect(
      resolveEngineerStoreyId({
        engineerSourceFileName: 'linked.ifc',
        hostFileName: 'host.ifc',
        selectedStoreyId: 5,
        alignments,
      }),
    ).toBe(77)
  })

  it('returns null for an unmapped host floor and when no floor is open', () => {
    expect(
      resolveEngineerStoreyId({
        engineerSourceFileName: 'linked.ifc',
        hostFileName: 'host.ifc',
        selectedStoreyId: 999,
        alignments,
      }),
    ).toBeNull()
    expect(
      resolveEngineerStoreyId({
        engineerSourceFileName: 'host.ifc',
        hostFileName: 'host.ifc',
        selectedStoreyId: null,
        alignments,
      }),
    ).toBeNull()
  })
})

describe('getEngineerOverlayPresentation', () => {
  const frameOrigin = { x: 100, y: 0, z: 200 }

  it('converts extrusion-axis segments to the local viewer frame (z = −IFC Y, unit conversion, origin subtraction)', () => {
    const presentation = getEngineerOverlayPresentation({
      network: network([
        segment({ expressId: 7, start: { x: 10_500, y: -20_800, z: 3_015 }, end: { x: 10_500, y: -20_800, z: 3_315 } }),
      ]),
      stacks,
      engineerStoreyId: 10,
      frameOrigin,
      visible: true,
    })

    expect(presentation.hasNetwork).toBe(true)
    expect(presentation.excludedSegmentCount).toBe(0)
    expect(presentation.visibleSegments).toHaveLength(1)
    const [line] = presentation.visibleSegments
    expect(line.key).toBe('engineer-segment-7')
    // x: 10500 cm → 105 m − origin 100 = 5; z: −(−20800 cm → −208 m) = 208 − 200 = 8.
    expect(line.from.x).toBeCloseTo(5, 6)
    expect(line.from.z).toBeCloseTo(8, 6)
    expect(line.from.y).toBeCloseTo(30.15, 6)
    expect(line.to.y).toBeCloseTo(33.15, 6)
    expect(line.diameterMm).toBe(110)
  })

  it('filters segments to the resolved engineer storey', () => {
    const presentation = getEngineerOverlayPresentation({
      network: network([
        segment({ expressId: 1, storeyId: 10 }),
        segment({ expressId: 2, storeyId: 11 }),
        segment({ expressId: 3, storeyId: null }),
      ]),
      stacks,
      engineerStoreyId: 10,
      frameOrigin: { x: 0, y: 0, z: 0 },
      visible: true,
    })
    expect(presentation.visibleSegments.map((line) => line.key)).toEqual(['engineer-segment-1'])
  })

  it('excludes mesh-bounds and geometry-less segments with an explicit count', () => {
    const presentation = getEngineerOverlayPresentation({
      network: network([
        segment({ expressId: 1 }),
        segment({ expressId: 2, endpointSource: 'mesh-bounds' }),
        segment({ expressId: 3, start: null, end: null, endpointSource: null }),
      ]),
      stacks,
      engineerStoreyId: 10,
      frameOrigin: { x: 0, y: 0, z: 0 },
      visible: true,
    })
    expect(presentation.visibleSegments).toHaveLength(1)
    expect(presentation.excludedSegmentCount).toBe(2)
  })

  it('marks riser stacks model-wide in the local plan frame', () => {
    const presentation = getEngineerOverlayPresentation({
      network: network([segment({})]),
      stacks,
      engineerStoreyId: 10,
      frameOrigin,
      visible: true,
    })
    expect(presentation.visibleStackMarkers).toEqual([
      // xM 20 − 100 = −80; yM 30 → viewer z −30, minus origin 200 = −230.
      { key: 'engineer-riser-1', x: -80, z: -230, diameterMm: 110, storeyCount: 1 },
    ])
  })

  it('returns empty layers when hidden but still reports hasNetwork for the toggle', () => {
    const presentation = getEngineerOverlayPresentation({
      network: network([segment({})]),
      stacks,
      engineerStoreyId: 10,
      frameOrigin,
      visible: false,
    })
    expect(presentation.hasNetwork).toBe(true)
    expect(presentation.visibleSegments).toHaveLength(0)
    expect(presentation.visibleStackMarkers).toHaveLength(0)
  })
})
