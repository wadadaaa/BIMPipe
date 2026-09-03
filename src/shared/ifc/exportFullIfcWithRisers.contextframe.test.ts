import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { exportFullIfcWithRisers, exportFullIfcWithRisersWithDebug } from './exportFullIfcWithRisers'
import { readBimPipeFramePset } from './exportFullIfcWithRisers.frame.testutil'
import { readRepresentationContextFrame } from './readRepresentationContextFrame'
import { resolveLocalPlacementWorldMatrix } from './localPlacementMatrix'
import {
  buildContextWcsIfc,
  CONTEXT_FIXTURE_TRUE_NORTH_DEG,
  CONTEXT_FIXTURE_WCS_CM,
} from './contextWcsFixture.testutil'
import type { Riser } from '@/domain/types'

// Context-WCS frame round trip: a Revit "Project Base Point" style model keeps
// its survey offset and TrueNorth in the representation context, not in the
// placement chain. web-ifc renders such geometry near the origin, so the
// export must (a) leave riser coordinates in project-base-point space — no
// shifting by the ~770 km offset — (b) preserve the context WCS/TrueNorth
// byte-for-byte through web-ifc's SaveModel, and (c) document the frame in
// the BIMPipe_Frame property set on IfcProject and in the debug artifact.

function idsOfType(api: IfcAPI, modelId: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelId, type)
  const ids: number[] = []
  for (let i = 0; i < vector.size(); i += 1) ids.push(vector.get(i))
  return ids
}

const RISERS: Riser[] = [
  { id: 'r-f2', stackId: 'stack-1', stackLabel: 'R1', storeyId: 70, position: { x: 1.5, y: 0, z: 2.5 } },
  { id: 'r-f3', stackId: 'stack-1', stackLabel: 'R1', storeyId: 73, position: { x: 1.5, y: 0, z: 2.5 } },
]

describe('exportFullIfcWithRisers with a far context WCS (project base point export)', () => {
  it('keeps riser coordinates unshifted, preserves the context WCS/TrueNorth and writes BIMPipe_Frame', async () => {
    const ifc = await import('web-ifc')
    const exportApi = new ifc.IfcAPI()
    await exportApi.Init()
    const { ifcBytes, debugMapping } = await exportFullIfcWithRisersWithDebug(
      exportApi,
      new TextEncoder().encode(buildContextWcsIfc()),
      70,
      RISERS,
      null,
      {
        exportRunId: 'context-frame-test',
        timestamp: '2026-01-01T00:00:00.000Z',
        modelOrigin: {
          origin: { x: 0, y: 0, z: 0 },
          detectedBy: 'context',
          sourceFrame: {
            detectedBy: 'context',
            offsetSourceUnits: CONTEXT_FIXTURE_WCS_CM,
            offsetM: { x: 196_714.72399833947, y: 743_288.86584343016, z: 12.5 },
            lengthUnit: 'cm',
            trueNorthDeg: CONTEXT_FIXTURE_TRUE_NORTH_DEG,
            wcsRotationDeg: 0,
          },
        },
      },
    )

    // Debug artifact: the frame read from the source file says context / 6.53.
    expect(debugMapping.sourceFrame).not.toBeNull()
    expect(debugMapping.sourceFrame!.detectedBy).toBe('context')
    expect(debugMapping.sourceFrame!.lengthUnit).toBe('cm')
    expect(debugMapping.sourceFrame!.offsetSourceUnits.x).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.x, 6)
    expect(debugMapping.sourceFrame!.trueNorthDeg).toBeCloseTo(6.53, 9)
    expect(debugMapping.modelOrigin?.detectedBy).toBe('context')
    expect(debugMapping.notes.some((note) => note.includes('BIMPipe_Frame'))).toBe(true)
    const reopenApi = new ifc.IfcAPI()
    await reopenApi.Init()
    const modelId = reopenApi.OpenModel(ifcBytes)
    try {
      // (a) Riser stays in project-base-point space: viewer (1.5, 2.5) m -> IFC
      // (150, -250) cm relative to the origin-placed storey; no 770 km shift.
      const flowSegmentIds = idsOfType(reopenApi, modelId, ifc.IFCFLOWSEGMENT)
      expect(flowSegmentIds).toHaveLength(1)
      const flowSegment = reopenApi.GetLine(modelId, flowSegmentIds[0], false) as {
        ObjectPlacement?: { value?: number } | null
      }
      const world = resolveLocalPlacementWorldMatrix(reopenApi, modelId, flowSegment.ObjectPlacement!.value!)
      expect(world.elements[12]).toBeCloseTo(150, 6)
      expect(world.elements[13]).toBeCloseTo(-250, 6)
      expect(Math.abs(world.elements[12])).toBeLessThan(1_000)

      // (b) Context WCS and TrueNorth survive web-ifc's SaveModel unchanged.
      const context = await readRepresentationContextFrame(reopenApi, modelId, 'cm')
      expect(context).not.toBeNull()
      expect(context!.contextExpressId).toBe(23)
      expect(context!.wcsLocationSource.x).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.x, 6)
      expect(context!.wcsLocationSource.y).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.y, 6)
      expect(context!.wcsLocationSource.z).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.z, 6)
      expect(context!.trueNorthDeg).toBeCloseTo(6.53, 9)

      // (c) BIMPipe_Frame on IfcProject, offsets in model units, angle in degrees.
      const pset = readBimPipeFramePset(reopenApi, modelId)
      expect(pset).not.toBeNull()
      expect(pset!.relatedObjectTypes).toEqual(['IfcProject'])
      const props = pset!.properties
      expect(props.DetectedBy).toBe('context')
      expect(props.LengthUnit).toBe('cm')
      expect(props.OffsetX as number).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.x, 6)
      expect(props.OffsetY as number).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.y, 6)
      expect(props.OffsetZ as number).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.z, 6)
      expect(props.TrueNorthDeg as number).toBeCloseTo(6.53, 9)
      expect(props.WcsRotationDeg).toBe(0)
    } finally {
      reopenApi.CloseModel(modelId)
    }
  })

  it('omits TrueNorthDeg when the source declares no TrueNorth', async () => {
    const ifc = await import('web-ifc')
    const exportApi = new ifc.IfcAPI()
    await exportApi.Init()
    const ifcBytes = await exportFullIfcWithRisers(
      exportApi,
      new TextEncoder().encode(buildContextWcsIfc({ trueNorthDeg: null })),
      70,
      RISERS,
    )
    const reopenApi = new ifc.IfcAPI()
    await reopenApi.Init()
    const modelId = reopenApi.OpenModel(ifcBytes)
    try {
      const pset = readBimPipeFramePset(reopenApi, modelId)
      expect(pset).not.toBeNull()
      expect(pset!.properties.DetectedBy).toBe('context')
      expect('TrueNorthDeg' in pset!.properties).toBe(false)
      const context = await readRepresentationContextFrame(reopenApi, modelId, 'cm')
      expect(context!.trueNorthDeg).toBeNull()
    } finally {
      reopenApi.CloseModel(modelId)
    }
  })

  it('writes no BIMPipe_Frame for an identity context WCS (placement/near-origin models unchanged)', async () => {
    const ifc = await import('web-ifc')
    const exportApi = new ifc.IfcAPI()
    await exportApi.Init()
    const { ifcBytes, debugMapping } = await exportFullIfcWithRisersWithDebug(
      exportApi,
      new TextEncoder().encode(buildContextWcsIfc({ wcsCm: { x: 0, y: 0, z: 0 }, trueNorthDeg: null })),
      70,
      RISERS,
    )
    expect(debugMapping.sourceFrame).toBeNull()
    expect(debugMapping.modelOrigin).toBeNull()

    const reopenApi = new ifc.IfcAPI()
    await reopenApi.Init()
    const modelId = reopenApi.OpenModel(ifcBytes)
    try {
      expect(readBimPipeFramePset(reopenApi, modelId)).toBeNull()
    } finally {
      reopenApi.CloseModel(modelId)
    }
  })
})
