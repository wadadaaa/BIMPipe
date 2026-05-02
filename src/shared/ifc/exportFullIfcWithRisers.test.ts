import { describe, expect, it, vi } from 'vitest'
import { exportFullIfcWithRisers, exportFullIfcWithRisersWithDebug } from './exportFullIfcWithRisers'
import type { Riser } from '@/domain/types'
import type { IfcAPI } from 'web-ifc'

vi.mock('web-ifc', () => ({
  IFCAXIS2PLACEMENT2D: 1,
  IFCAXIS2PLACEMENT3D: 2,
  IFCCARTESIANPOINT: 3,
  IFCCIRCLEPROFILEDEF: 4,
  IFCEXTRUDEDAREASOLID: 5,
  IFCFLOWSEGMENT: 6,
  IFCIDENTIFIER: 7,
  IFCLABEL: 8,
  IFCLENGTHMEASURE: 9,
  IFCLOCALPLACEMENT: 10,
  IFCMATERIAL: 11,
  IFCPIPESEGMENT: 12,
  IFCPIPESEGMENTTYPE: 13,
  IFCPRODUCTDEFINITIONSHAPE: 14,
  IFCRELASSOCIATESMATERIAL: 15,
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 16,
  IFCRELDEFINESBYTYPE: 17,
  IFCSHAPEREPRESENTATION: 18,
  IFCPOSITIVELENGTHMEASURE: 19,
  IFCPROPERTYSINGLEVALUE: 20,
  IFCPROPERTYSET: 21,
  IFCRELDEFINESBYPROPERTIES: 22,
  IFCSYSTEM: 23,
  IFCRELASSIGNSTOGROUP: 24,
  IFCRELSERVICESBUILDINGS: 25,
  IFCTEXT: 26,
  IFCELEMENTQUANTITY: 27,
  IFCQUANTITYLENGTH: 28,
}))

const IFCPOSITIVELENGTHMEASURE = 19
const IFCPROPERTYSINGLEVALUE = 20
const IFCPROPERTYSET = 21
const IFCPIPESEGMENTTYPE = 13
const IFCRELDEFINESBYPROPERTIES = 22
const IFCSYSTEM = 23
const IFCRELASSIGNSTOGROUP = 24
const IFCRELSERVICESBUILDINGS = 25
const IFCTEXT = 26
const IFCELEMENTQUANTITY = 27
const IFCQUANTITYLENGTH = 28

function makeIdVector(values: number[]) {
  return {
    size: () => values.length,
    get: (index: number) => values[index],
  }
}

function makeMockApi(options: { storeyOrigin?: [number, number, number] } = {}) {
  const storeyOrigin = options.storeyOrigin ?? [1000, 2000, 3000]
  const typeCodes = new Map([
    ['IFCPROJECT', 101],
    ['IFCSHAPEREPRESENTATION', 102],
    ['IFCDIRECTION', 103],
    ['IFCBUILDING', 104],
    ['IFCLABEL', 8],
    ['IFCLENGTHMEASURE', 9],
    ['IFCIDENTIFIER', 7],
    ['IFCPOSITIVELENGTHMEASURE', IFCPOSITIVELENGTHMEASURE],
    ['IFCPROPERTYSINGLEVALUE', IFCPROPERTYSINGLEVALUE],
    ['IFCPROPERTYSET', IFCPROPERTYSET],
    ['IFCRELDEFINESBYPROPERTIES', IFCRELDEFINESBYPROPERTIES],
    ['IFCSYSTEM', IFCSYSTEM],
    ['IFCRELASSIGNSTOGROUP', IFCRELASSIGNSTOGROUP],
    ['IFCRELSERVICESBUILDINGS', IFCRELSERVICESBUILDINGS],
    ['IFCTEXT', IFCTEXT],
    ['IFCELEMENTQUANTITY', IFCELEMENTQUANTITY],
    ['IFCQUANTITYLENGTH', IFCQUANTITYLENGTH],
  ])
  const lineTypes = new Map([
    [24, 401],
    [3, 402],
    [301, 403],
    [65, 404],
  ])
  const lineTypeNames = new Map([
    [24, 'IfcGeometricRepresentationSubContext'],
    [3, 'IfcSIUnit'],
    [301, 'IfcFlowTerminal'],
    [65, 'IfcLocalPlacement'],
  ])
  const containment = {
    expressID: 201,
    type: 16,
    RelatedElements: [{ type: 5, value: 301 }] as unknown[],
    RelatingStructure: { type: 5, value: 66 },
  }

  let nextExpressId = 8000
  const writtenLines: Array<Record<string, unknown>> = []

  const api = {
    OpenModel: vi.fn(() => 88),
    CloseModel: vi.fn(),
    GetModelSchema: vi.fn(() => 'IFC2X3'),
    SaveModel: vi.fn(() => new Uint8Array([4, 5, 6])),
    CreateIFCGloballyUniqueId: vi.fn(() => `guid-${nextExpressId++}`),
    CreateIfcType: vi.fn((modelId: number, type: number, value: unknown) => ({
      modelId,
      type,
      value,
    })),
    CreateIfcEntity: vi.fn((modelId: number, type: number, ...args: unknown[]) => ({
      expressID: nextExpressId++,
      modelId,
      type,
      args,
    })),
    WriteLine: vi.fn((_modelId: number, line: Record<string, unknown>) => {
      if ((line.expressID as number | undefined) === -1) {
        line.expressID = nextExpressId++
      }
      writtenLines.push(line)
    }),
    GetTypeCodeFromName: vi.fn((name: string) => typeCodes.get(name) ?? -1),
    GetLineIDsWithType: vi.fn((_modelId: number, type: number) => {
      if (type === 101) return makeIdVector([1])
      if (type === 102) return makeIdVector([])
      if (type === 16) return makeIdVector([201])
      if (type === 104) return makeIdVector([51])
      return makeIdVector([])
    }),
    GetLineType: vi.fn((_modelId: number, expressId: number) => lineTypes.get(expressId) ?? -1),
    GetNameFromTypeCode: vi.fn((typeCode: number) => {
      for (const [expressId, currentTypeCode] of lineTypes.entries()) {
        if (currentTypeCode === typeCode) return lineTypeNames.get(expressId) ?? 'Unknown'
      }
      return 'Unknown'
    }),
    GetLine: vi.fn((_modelId: number, expressId: number) => {
      if (expressId === 1) return { UnitsInContext: { type: 5, value: 2 } }
      if (expressId === 2) return { Units: [{ type: 5, value: 3 }] }
      if (expressId === 3) {
        return {
          UnitType: { value: 'LENGTHUNIT' },
          Name: { value: 'METRE' },
          Prefix: { value: 'CENTI' },
        }
      }
      if (expressId === 51) {
        return {
          OwnerHistory: { type: 5, value: 18 },
          Name: { value: 'Building' },
        }
      }
      if (expressId === 24) return { ContextIdentifier: { value: 'Body' } }
      if (expressId === 66) {
        return {
          OwnerHistory: { type: 5, value: 18 },
          ObjectPlacement: { type: 5, value: 65 },
          Name: { value: 'Level 1' },
          Elevation: { value: 100 },
        }
      }
      if (expressId === 67) {
        return {
          Name: { value: 'Level 2' },
          Elevation: { value: 400 },
        }
      }
      if (expressId === 68) {
        return {
          Name: { value: 'Level 3' },
          Elevation: { value: 700 },
        }
      }
      if (expressId === 65) {
        return {
          PlacementRelTo: null,
          RelativePlacement: { type: 5, value: 64 },
        }
      }
      if (expressId === 64) {
        return {
          Location: { type: 5, value: 63 },
          Axis: { type: 5, value: 61 },
          RefDirection: { type: 5, value: 62 },
        }
      }
      if (expressId === 63) {
        return {
          Coordinates: storeyOrigin.map((value) => ({ value })),
        }
      }
      if (expressId === 61) return { DirectionRatios: [{ value: 0 }, { value: 0 }, { value: 1 }] }
      if (expressId === 62) return { DirectionRatios: [{ value: 1 }, { value: 0 }, { value: 0 }] }
      if (expressId === 201) return containment
      if (expressId === 301) {
        return {
          Name: { value: 'Balcony Drain' },
          ObjectPlacement: { type: 5, value: 302 },
        }
      }
      if (expressId === 302) {
        return {
          PlacementRelTo: { type: 5, value: 65 },
          RelativePlacement: { type: 5, value: 303 },
        }
      }
      if (expressId === 303) {
        return {
          Location: { type: 5, value: 304 },
        }
      }
      if (expressId === 304) {
        return {
          Coordinates: [{ value: 120 }, { value: 340 }, { value: 5 }],
        }
      }
      return null
    }),
  } as unknown as IfcAPI

  return { api, containment, writtenLines }
}

function getObjectPlacementCoordinateStrings(writtenLines: Array<Record<string, unknown>>): string[] {
  return writtenLines
    .filter((line) =>
      line.type === 3 &&
      Array.isArray(line.Coordinates) &&
      line.Coordinates.length === 3,
    )
    .map((line) => (line.Coordinates as Array<{ value: number }>).map((value) => value.value).join(','))
}

function getFlowSegmentLines(writtenLines: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return writtenLines.filter((line) => line.type === 6)
}

function getExtrudedDepthValues(writtenLines: Array<Record<string, unknown>>): number[] {
  return writtenLines
    .filter((line) => line.type === 5)
    .map((line) => (line.Depth as { value: number }).value)
}

function getPropertySetLines(
  writtenLines: Array<Record<string, unknown>>,
  name: string,
): Array<Record<string, unknown>> {
  return writtenLines.filter((line) => line.type === IFCPROPERTYSET && readIfcValue(line.Name) === name)
}

function getPropertySingleValue(
  writtenLines: Array<Record<string, unknown>>,
  name: string,
): Record<string, unknown> | undefined {
  return writtenLines.find((line) => line.type === IFCPROPERTYSINGLEVALUE && readIfcValue(line.Name) === name)
}

function getQuantityLength(
  writtenLines: Array<Record<string, unknown>>,
  name: string,
): Record<string, unknown> | undefined {
  return writtenLines.find((line) => line.type === IFCQUANTITYLENGTH && readIfcValue(line.Name) === name)
}

function getLinesByType(writtenLines: Array<Record<string, unknown>>, type: number): Array<Record<string, unknown>> {
  return writtenLines.filter((line) => line.type === type)
}

function readIfcValue(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'value' in value
    ? (value as { value: unknown }).value
    : value
}

describe('exportFullIfcWithRisers', () => {
  it('maps web plan coordinates directly through the existing storey placement', async () => {
    const { api, containment, writtenLines } = makeMockApi()

    const risers: Riser[] = [
      {
        id: 'r-1',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 66,
        position: { x: 14, y: 36, z: -25 },
      },
      {
        id: 'r-2',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 67,
        position: { x: 14, y: 336, z: -25 },
      },
    ]

    const result = await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, risers)

    expect(result).toEqual(new Uint8Array([4, 5, 6]))
    expect(getObjectPlacementCoordinateStrings(writtenLines)).toContain('400,500,0')

    const riserElement = writtenLines.find((line) => line.type === 6)
    expect(riserElement).toMatchObject({
      Name: { value: 'BIMPipe R1' },
      ObjectType: { value: 'BIMPipeRiser' },
      Tag: { value: 'R1' },
    })
    expect(containment.RelatedElements).toHaveLength(2)
    expect(api.CloseModel).toHaveBeenCalledWith(88)
  })

  it('keeps off-center web plan positions verbatim when floor bounds are provided', async () => {
    const { api, containment, writtenLines } = makeMockApi()

    const risers: Riser[] = [
      {
        id: 'r-1',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 66,
        position: { x: 11, y: 2, z: -23 },
      },
      {
        id: 'r-2',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 67,
        position: { x: 11, y: 302, z: -23 },
      },
    ]

    await exportFullIfcWithRisers(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      risers,
      { minX: 10, maxX: 30, minZ: -40, maxZ: -20 },
    )

    const coordinateStrings = getObjectPlacementCoordinateStrings(writtenLines)
    expect(coordinateStrings).toContain('100,300,0')
    expect(coordinateStrings).not.toContain('1900,1700,0')
    expect(containment.RelatedElements).toHaveLength(2)
  })

  it('keeps web position verbatim regardless of sourceFloorPlanBounds', async () => {
    const { api, writtenLines } = makeMockApi({ storeyOrigin: [0, 0, 0] })

    const risers: Riser[] = [
      {
        id: 'r-1',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 66,
        position: { x: 10, y: 0, z: 5 },
      },
      {
        id: 'r-2',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 67,
        position: { x: 10, y: 300, z: 5 },
      },
    ]

    await exportFullIfcWithRisers(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      risers,
      { minX: 0, maxX: 20, minZ: 0, maxZ: 10 },
    )

    const coordinateStrings = getObjectPlacementCoordinateStrings(writtenLines)
    expect(coordinateStrings).toContain('1000,-500,0')
  })

  it('does not let an existing donor placement override the final web position', async () => {
    const { api, containment, writtenLines } = makeMockApi()

    const risers: Riser[] = [
      {
        id: 'r-1',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 66,
        position: { x: 11, y: 2, z: -23 },
      },
      {
        id: 'r-2',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 67,
        position: { x: 11, y: 302, z: -23 },
      },
    ]

    await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, risers)

    const coordinateStrings = getObjectPlacementCoordinateStrings(writtenLines)
    expect(coordinateStrings).toContain('100,300,0')
    expect(coordinateStrings).not.toContain('150,370,5')
    expect(containment.RelatedElements).toHaveLength(2)
  })

  it('emits a debug mapping artifact for exported riser placement', async () => {
    const { api, containment } = makeMockApi()

    const risers: Riser[] = [
      {
        id: 'r-1',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 66,
        position: { x: 11, y: 2, z: -23 },
      },
      {
        id: 'r-2',
        stackId: 'stack-a',
        stackLabel: 'R1',
        storeyId: 67,
        position: { x: 11, y: 302, z: -23 },
      },
    ]

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      risers,
      { minX: 10, maxX: 30, minZ: -40, maxZ: -20 },
      {
        exportRunId: 'run-1',
        timestamp: '2026-04-27T12:00:00.000Z',
        sourceIfcName: 'tower.ifc',
        storeys: [
          { id: 66, name: 'קומה 2', elevation: 612 },
          { id: 67, name: 'קומה 3', elevation: 912 },
        ],
      },
    )

    expect(result.ifcBytes).toEqual(new Uint8Array([4, 5, 6]))
    expect(result.debugMapping).toMatchObject({
      exportRunId: 'run-1',
      timestamp: '2026-04-27T12:00:00.000Z',
      sourceIfcName: 'tower.ifc',
      schema: 'IFC2X3',
      sourceFloorPlanBounds: { minX: 10, maxX: 30, minZ: -40, maxZ: -20 },
    })

    expect(result.debugMapping.risers).toHaveLength(1)
    expect(result.debugMapping.risers[0]).toMatchObject({
      exportRunId: 'run-1',
      timestamp: '2026-04-27T12:00:00.000Z',
      sourceIfcName: 'tower.ifc',
      schema: 'IFC2X3',
      riserId: 'r-1',
      riserTag: 'R1',
      floorId: 66,
      floorName: 'קומה 2',
      storeyEntityId: 66,
      storeyName: 'קומה 2',
      storeyElevation: 612,
      webPositionRaw: { x: 11, y: 2, z: -23 },
      webPositionUsedForExport: { x: 11, y: 2, z: -23 },
      floorLocalPosition: { x: 100, y: 300, z: 0 },
      worldOrModelPosition: { x: 1100, y: 2300, z: 3000 },
      chosenAnchorEntityId: 65,
      chosenAnchorType: 'IfcLocalPlacement',
      chosenParentPlacementId: 65,
      parentPlacementOrigin: { x: 1000, y: 2000, z: 3000 },
      parentPlacementAxis: { x: 0, y: 0, z: 1 },
      parentPlacementRefDirection: { x: 1, y: 0, z: 0 },
      finalIfcLocalPlacement: { x: 100, y: 300, z: 0 },
      bottomStoreyEntityId: 66,
      bottomStoreyName: 'קומה 2',
      bottomStoreyElevation: 612,
      topStoreyEntityId: 67,
      topStoreyName: 'קומה 3',
      topStoreyElevation: 912,
      coveredStoreyIds: [66, 67],
      extrusionLengthSourceUnits: 300,
      warnings: [],
    })
    expect(result.debugMapping.risers[0].createdEntityIds.flowSegment).toEqual(expect.any(Number))
    expect(result.debugMapping.risers[0].createdEntityIds.localPlacement).toEqual(expect.any(Number))
    expect(result.debugMapping.risers[0].createdRelationIds.typeRelation).toEqual(expect.any(Number))
    expect(result.debugMapping.risers[0].createdRelationIds.materialRelation).toEqual(expect.any(Number))
    expect(result.debugMapping.risers[0].notes).toContain(
      'Appended to existing IfcRelContainedInSpatialStructure #201.',
    )
    expect(containment.RelatedElements).toHaveLength(2)
  })

  it('debug record exposes webPositionUsedForExport === webPositionRaw', async () => {
    const { api } = makeMockApi()

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      [
        {
          id: 'r-1',
          stackId: 'stack-a',
          stackLabel: 'R1',
          storeyId: 66,
          position: { x: 11, y: 2, z: -23 },
        },
        {
          id: 'r-2',
          stackId: 'stack-a',
          stackLabel: 'R1',
          storeyId: 67,
          position: { x: 11, y: 302, z: -23 },
        },
      ],
      { minX: 10, maxX: 30, minZ: -40, maxZ: -20 },
    )

    expect(result.debugMapping.risers[0].webPositionUsedForExport).toEqual(
      result.debugMapping.risers[0].webPositionRaw,
    )
  })

  it('notes describe verbatim placement', async () => {
    const { api } = makeMockApi()

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      [
        {
          id: 'r-1',
          stackId: 'stack-a',
          stackLabel: 'R1',
          storeyId: 66,
          position: { x: 11, y: 2, z: -23 },
        },
        {
          id: 'r-2',
          stackId: 'stack-a',
          stackLabel: 'R1',
          storeyId: 67,
          position: { x: 11, y: 302, z: -23 },
        },
      ],
      { minX: 10, maxX: 30, minZ: -40, maxZ: -20 },
    )

    expect(result.debugMapping.risers[0].notes).toContain(
      'Plan position written verbatim from web frame after axis swap and storey-chain inverse.',
    )
  })

  it('emits one IfcFlowSegment per stack across multiple storeys', async () => {
    const { api, writtenLines } = makeMockApi()

    const risers: Riser[] = [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
      { id: 'a-3', stackId: 'stack-a', stackLabel: 'R1', storeyId: 68, position: { x: 10, y: 700, z: 5 } },
      { id: 'b-1', stackId: 'stack-b', stackLabel: 'R2', storeyId: 66, position: { x: 20, y: 100, z: 15 } },
      { id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 67, position: { x: 20, y: 400, z: 15 } },
      { id: 'b-3', stackId: 'stack-b', stackLabel: 'R2', storeyId: 68, position: { x: 20, y: 700, z: 15 } },
    ]

    await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, risers)

    expect(getFlowSegmentLines(writtenLines)).toHaveLength(2)
    expect(getExtrudedDepthValues(writtenLines)).toEqual([600, 600])
  })

  it('throws on vertical-alignment violation', async () => {
    const { api } = makeMockApi()

    const risers: Riser[] = [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5.5 } },
    ]

    await expect(exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, risers)).rejects.toThrow(
      /Riser stack R1 .*misaligned.*Level 1.*Level 2/,
    )
  })

  it('emits one debug record per stack with span fields', async () => {
    const { api, writtenLines } = makeMockApi()

    const risers: Riser[] = [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
      { id: 'a-3', stackId: 'stack-a', stackLabel: 'R1', storeyId: 68, position: { x: 10, y: 700, z: 5 } },
      { id: 'b-1', stackId: 'stack-b', stackLabel: 'R2', storeyId: 66, position: { x: 20, y: 100, z: 15 } },
      { id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 67, position: { x: 20, y: 400, z: 15 } },
      { id: 'b-3', stackId: 'stack-b', stackLabel: 'R2', storeyId: 68, position: { x: 20, y: 700, z: 15 } },
    ]

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      risers,
      null,
      {
        storeys: [
          { id: 66, name: 'Level 1', elevation: 100 },
          { id: 67, name: 'Level 2', elevation: 400 },
          { id: 68, name: 'Level 3', elevation: 700 },
        ],
      },
    )

    expect(result.debugMapping.risers).toHaveLength(2)
    expect(result.debugMapping.risers.map((record) => record.riserTag)).toEqual(['R1', 'R2'])
    for (const record of result.debugMapping.risers) {
      expect(record.bottomStoreyElevation).toBe(100)
      expect(record.topStoreyElevation).toBe(700)
      expect(record.extrusionLengthSourceUnits).toBe(600)
      expect(record.coveredStoreyIds).toEqual([66, 67, 68])
    }
    expect(getExtrudedDepthValues(writtenLines)).toEqual(
      result.debugMapping.risers.map((record) => record.extrusionLengthSourceUnits),
    )
  })

  it('writes Pset_PipeSegmentTypeCommon with NominalDiameter, OuterDiameter, WallThickness, Roughness, Reference', async () => {
    const { api, writtenLines } = makeMockApi()

    await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
    ])

    expect(getPropertySetLines(writtenLines, 'Pset_PipeSegmentTypeCommon')).toHaveLength(1)
    expect(getPropertySingleValue(writtenLines, 'NominalDiameter')?.NominalValue).toMatchObject({
      type: IFCPOSITIVELENGTHMEASURE,
      value: 11,
    })
    expect(getPropertySingleValue(writtenLines, 'OuterDiameter')?.NominalValue).toMatchObject({
      type: IFCPOSITIVELENGTHMEASURE,
      value: 11,
    })
    expect(getPropertySingleValue(writtenLines, 'InnerDiameter')?.NominalValue).toMatchObject({
      type: IFCPOSITIVELENGTHMEASURE,
      value: 10,
    })
    expect(getPropertySingleValue(writtenLines, 'WallThickness')?.NominalValue).toMatchObject({
      type: IFCPOSITIVELENGTHMEASURE,
      value: 0.5,
    })
    const roughness = getPropertySingleValue(writtenLines, 'Roughness')?.NominalValue as
      | { type: number; value: number }
      | undefined
    expect(roughness?.type).toBe(9)
    expect(roughness?.value).toBeCloseTo(0.00015)
    expect(getPropertySingleValue(writtenLines, 'Reference')?.NominalValue).toMatchObject({
      type: 7,
      value: 'R1',
    })
  })

  it('inlines Pset_PipeSegmentTypeCommon on IfcPipeSegmentType HasPropertySets', async () => {
    const { api, writtenLines } = makeMockApi()

    await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
    ])

    const pset = getPropertySetLines(writtenLines, 'Pset_PipeSegmentTypeCommon')[0]
    const pipeSegmentTypeLines = getLinesByType(writtenLines, IFCPIPESEGMENTTYPE)
    const finalPipeSegmentTypeLine = pipeSegmentTypeLines[pipeSegmentTypeLines.length - 1]
    const psetRelations = getLinesByType(writtenLines, IFCRELDEFINESBYPROPERTIES).filter(
      (line) => (line.RelatingPropertyDefinition as { value: number } | undefined)?.value === pset.expressID,
    )

    expect(finalPipeSegmentTypeLine.HasPropertySets).toEqual([{ type: 5, value: pset.expressID }])
    expect(psetRelations).toHaveLength(1)
  })

  it('writes Pset_FlowSegmentOccurrence with SystemType=SANITARY, FlowDirection=NOTDEFINED, Length matching extrusion', async () => {
    const { api, writtenLines } = makeMockApi()

    await exportFullIfcWithRisers(api, new Uint8Array([1, 2, 3]), 66, [
      { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
      { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
    ])

    expect(getPropertySetLines(writtenLines, 'Pset_FlowSegmentOccurrence')).toHaveLength(1)
    expect(getPropertySingleValue(writtenLines, 'SystemType')?.NominalValue).toMatchObject({
      type: 8,
      value: 'SANITARY',
    })
    expect(getPropertySingleValue(writtenLines, 'FlowDirection')?.NominalValue).toMatchObject({
      type: 8,
      value: 'NOTDEFINED',
    })
    expect(getPropertySingleValue(writtenLines, 'Length')?.NominalValue).toMatchObject({
      type: IFCPOSITIVELENGTHMEASURE,
      value: 300,
    })
  })

  it('writes Qto_PipeSegmentBaseQuantities with NetLength and GrossLength matching extrusion length', async () => {
    const { api, writtenLines } = makeMockApi()

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      [
        { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
        { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
      ],
    )

    const quantitySets = getLinesByType(writtenLines, IFCELEMENTQUANTITY)
    expect(quantitySets).toHaveLength(1)
    expect(quantitySets[0]).toMatchObject({
      Name: { value: 'Qto_PipeSegmentBaseQuantities' },
      MethodOfMeasurement: null,
    })
    expect(quantitySets[0].Quantities).toHaveLength(2)
    expect(getQuantityLength(writtenLines, 'NetLength')?.LengthValue).toMatchObject({
      type: 9,
      value: 300,
    })
    expect(getQuantityLength(writtenLines, 'GrossLength')?.LengthValue).toMatchObject({
      type: 9,
      value: 300,
    })
    expect(result.debugMapping.risers[0].createdEntityIds.qtoSet).toEqual(quantitySets[0].expressID)
  })

  it('emits one IfcRelDefinesByProperties per stack referencing the quantity set', async () => {
    const { api, writtenLines } = makeMockApi()

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      [
        { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
        { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
        { id: 'b-1', stackId: 'stack-b', stackLabel: 'R2', storeyId: 66, position: { x: 20, y: 100, z: 15 } },
        { id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 67, position: { x: 20, y: 400, z: 15 } },
      ],
      null,
      {
        storeys: [
          { id: 66, name: 'Level 1', elevation: 100 },
          { id: 67, name: 'Level 2', elevation: 400 },
        ],
      },
    )

    const quantitySets = getLinesByType(writtenLines, IFCELEMENTQUANTITY)
    const quantitySetIds = quantitySets.map((line) => line.expressID)
    const quantityRelations = getLinesByType(writtenLines, IFCRELDEFINESBYPROPERTIES).filter((line) =>
      quantitySetIds.includes((line.RelatingPropertyDefinition as { value: number }).value),
    )

    expect(quantitySets).toHaveLength(2)
    expect(quantityRelations).toHaveLength(2)
    expect(quantityRelations.map((line) => line.RelatingPropertyDefinition)).toEqual(
      quantitySetIds.map((expressID) => ({ type: 5, value: expressID })),
    )
    expect(result.debugMapping.risers.map((record) => record.createdEntityIds.qtoSet)).toEqual(quantitySetIds)
    expect(result.debugMapping.risers.map((record) => record.createdRelationIds.qtoSetRel)).toEqual(
      quantityRelations.map((line) => line.expressID),
    )
  })

  it('creates one IfcSystem with all flow segments grouped via IfcRelAssignsToGroup and serviced via IfcRelServicesBuildings', async () => {
    const { api, writtenLines } = makeMockApi()

    const result = await exportFullIfcWithRisersWithDebug(
      api,
      new Uint8Array([1, 2, 3]),
      66,
      [
        { id: 'a-1', stackId: 'stack-a', stackLabel: 'R1', storeyId: 66, position: { x: 10, y: 100, z: 5 } },
        { id: 'a-2', stackId: 'stack-a', stackLabel: 'R1', storeyId: 67, position: { x: 10, y: 400, z: 5 } },
        { id: 'b-1', stackId: 'stack-b', stackLabel: 'R2', storeyId: 66, position: { x: 20, y: 100, z: 15 } },
        { id: 'b-2', stackId: 'stack-b', stackLabel: 'R2', storeyId: 67, position: { x: 20, y: 400, z: 15 } },
      ],
      null,
      {
        storeys: [
          { id: 66, name: 'Level 1', elevation: 100 },
          { id: 67, name: 'Level 2', elevation: 400 },
        ],
      },
    )

    const systems = getLinesByType(writtenLines, IFCSYSTEM)
    const groupRelations = getLinesByType(writtenLines, IFCRELASSIGNSTOGROUP)
    const serviceRelations = getLinesByType(writtenLines, IFCRELSERVICESBUILDINGS)
    const flowSegments = getFlowSegmentLines(writtenLines)

    expect(systems).toHaveLength(1)
    expect(systems[0]).toMatchObject({
      Name: { value: 'BIMPipe Sanitary Stacks' },
      Description: { value: 'Sanitary drainage system generated by BIMPipe.' },
      ObjectType: { value: 'SANITARY' },
    })
    expect(groupRelations).toHaveLength(1)
    expect(groupRelations[0]).toMatchObject({
      RelatedObjectsType: { value: 'IFCFLOWSEGMENT' },
      RelatingGroup: { type: 5, value: systems[0].expressID },
    })
    expect(groupRelations[0].RelatedObjects).toEqual(
      flowSegments.map((segment) => ({ type: 5, value: segment.expressID })),
    )
    expect(serviceRelations).toHaveLength(1)
    expect(serviceRelations[0]).toMatchObject({
      RelatedBuildings: [{ type: 5, value: 51 }],
      RelatingSystem: { type: 5, value: systems[0].expressID },
    })
    expect(result.debugMapping.systemAssignment).toMatchObject({
      ifcSystemId: systems[0].expressID,
      ifcRelAssignsToGroupId: groupRelations[0].expressID,
      ifcRelServicesBuildingsId: serviceRelations[0].expressID,
      ifcBuildingId: 51,
      name: 'BIMPipe Sanitary Stacks',
      objectType: 'SANITARY',
      description: 'Sanitary drainage system generated by BIMPipe.',
    })
  })
})
