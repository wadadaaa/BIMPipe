import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { exportFullIfcWithRisers } from './exportFullIfcWithRisers'
import type { Riser } from '@/domain/types'

type ImportedIfc = Awaited<typeof import('web-ifc')>

// Round-trip validation: export against the real web-ifc engine, then REOPEN the produced
// bytes with a fresh IfcAPI and assert structure (entity counts, property sets, linkage).
// This catches corruption that string/`toContain` checks on the raw bytes cannot.
//
// Fixture: minimal project + mm unit + Body subcontext (#24) + building + two storeys,
// identical to exportFullIfcWithRisers.realengine.test.ts but parameterized by schema
// (the entity attribute layouts used here are identical in IFC2X3 and IFC4).
function buildMinimalIfc(schema: 'IFC2X3' | 'IFC4'): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('minimal.ifc','',(''),(''),'','','');
FILE_SCHEMA(('${schema}'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'',$,$,$,$,$);
#2=IFCORGANIZATION($,'Org',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','BIMPipe','BIMPipe');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#6=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#7=IFCUNITASSIGNMENT((#6));
#8=IFCDIRECTION((1.,0.,0.));
#9=IFCDIRECTION((0.,0.,1.));
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,#9,#8);
#23=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#11,$);
#24=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#23,$,.MODEL_VIEW.,$);
#30=IFCPROJECT('0Project00000000000000',#5,'Project',$,$,$,$,(#23),#7);
#40=IFCAXIS2PLACEMENT3D(#10,$,$);
#42=IFCLOCALPLACEMENT($,#40);
#50=IFCBUILDING('0Building0000000000000',#5,'Building',$,$,#42,$,$,.ELEMENT.,$,$,$);
#60=IFCAXIS2PLACEMENT3D(#10,$,$);
#62=IFCLOCALPLACEMENT(#42,#60);
#70=IFCBUILDINGSTOREY('0Storey2A0000000000000',#5,'Level 2',$,$,#62,$,$,.ELEMENT.,0.);
#71=IFCAXIS2PLACEMENT3D(#10,$,$);
#72=IFCLOCALPLACEMENT(#42,#71);
#73=IFCBUILDINGSTOREY('0Storey3A0000000000000',#5,'Level 3',$,$,#72,$,$,.ELEMENT.,3000.);
#80=IFCRELAGGREGATES('0Agg000000000000000000',#5,$,$,#50,(#70,#73));
#81=IFCRELAGGREGATES('0AggP00000000000000000',#5,$,$,#30,(#50));
ENDSEC;
END-ISO-10303-21;
`
}

// Two vertical stacks, each spanning storeys #70 (0 mm) -> #73 (3000 mm).
const STACK_COUNT = 2
const risers: Riser[] = [
  { id: 's1-f2', stackId: 'stack-1', stackLabel: 'R1', storeyId: 70, position: { x: 1, y: 0, z: 1 } },
  { id: 's1-f3', stackId: 'stack-1', stackLabel: 'R1', storeyId: 73, position: { x: 1, y: 0, z: 1 } },
  { id: 's2-f2', stackId: 'stack-2', stackLabel: 'R2', storeyId: 70, position: { x: 3, y: 0, z: 2 } },
  { id: 's2-f3', stackId: 'stack-2', stackLabel: 'R2', storeyId: 73, position: { x: 3, y: 0, z: 2 } },
]

function idsOfType(api: IfcAPI, modelId: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelId, type)
  const ids: number[] = []
  for (let i = 0; i < vector.size(); i += 1) {
    ids.push(vector.get(i))
  }
  return ids
}

function readNameValue(api: IfcAPI, modelId: number, expressId: number): string | null {
  const line = api.GetLine(modelId, expressId, false) as { Name?: { value?: string } | string | null } | null
  const name = line?.Name
  if (typeof name === 'string') return name
  if (typeof name?.value === 'string') return name.value
  return null
}

/**
 * Names of every IfcPropertySetDefinition (property set or element quantity) attached
 * to the given element/type through IfcRelDefinesByProperties.
 */
function attachedDefinitionNames(
  api: IfcAPI,
  modelId: number,
  ifc: ImportedIfc,
  targetExpressId: number,
): string[] {
  const names: string[] = []
  for (const relId of idsOfType(api, modelId, ifc.IFCRELDEFINESBYPROPERTIES)) {
    const relation = api.GetLine(modelId, relId, false) as {
      RelatedObjects?: Array<{ value?: number } | null> | null
      RelatingPropertyDefinition?: { value?: number } | null
    } | null
    const related = relation?.RelatedObjects ?? []
    if (!related?.some((ref) => ref?.value === targetExpressId)) continue
    const definitionId = relation?.RelatingPropertyDefinition?.value
    if (typeof definitionId !== 'number') continue
    const name = readNameValue(api, modelId, definitionId)
    if (name !== null) names.push(name)
  }
  return names
}

async function exportAndReopen(schema: 'IFC2X3' | 'IFC4'): Promise<{
  ifc: ImportedIfc
  api: IfcAPI
  modelId: number
}> {
  const ifc = await import('web-ifc')

  const exportApi = new ifc.IfcAPI()
  await exportApi.Init()
  const exportedBytes = await exportFullIfcWithRisers(
    exportApi,
    new TextEncoder().encode(buildMinimalIfc(schema)),
    70,
    risers,
    null,
    [],
  )
  expect(exportedBytes).toBeInstanceOf(Uint8Array)
  expect(exportedBytes.length).toBeGreaterThan(0)

  // Reopen with a fresh engine instance so nothing leaks from the export session.
  const reopenApi = new ifc.IfcAPI()
  await reopenApi.Init()
  const modelId = reopenApi.OpenModel(exportedBytes)
  return { ifc, api: reopenApi, modelId }
}

describe('exportFullIfcWithRisers round-trip (reopen exported bytes with web-ifc)', () => {
  it('IFC2X3: reopened model has one IfcFlowSegment per stack with typed psets and quantities', async () => {
    const { ifc, api, modelId } = await exportAndReopen('IFC2X3')

    try {
      expect(api.GetModelSchema(modelId)).toBe('IFC2X3')

      const flowSegmentIds = idsOfType(api, modelId, ifc.IFCFLOWSEGMENT)
      expect(flowSegmentIds).toHaveLength(STACK_COUNT)
      // IFC2X3 path writes IfcFlowSegment occurrences, never IfcPipeSegment.
      expect(idsOfType(api, modelId, ifc.IFCPIPESEGMENT)).toHaveLength(0)

      const pipeSegmentTypeIds = idsOfType(api, modelId, ifc.IFCPIPESEGMENTTYPE)
      expect(pipeSegmentTypeIds).toHaveLength(STACK_COUNT)

      const psetNames = idsOfType(api, modelId, ifc.IFCPROPERTYSET).map((id) => readNameValue(api, modelId, id))
      expect(psetNames.filter((name) => name === 'Pset_PipeSegmentTypeCommon')).toHaveLength(STACK_COUNT)
      expect(psetNames.filter((name) => name === 'Pset_FlowSegmentOccurrence')).toHaveLength(STACK_COUNT)

      for (const flowSegmentId of flowSegmentIds) {
        const attached = attachedDefinitionNames(api, modelId, ifc, flowSegmentId)
        expect(attached).toContain('Pset_FlowSegmentOccurrence')
        expect(attached).toContain('Qto_PipeSegmentBaseQuantities')
      }
      for (const typeId of pipeSegmentTypeIds) {
        expect(attachedDefinitionNames(api, modelId, ifc, typeId)).toContain('Pset_PipeSegmentTypeCommon')
      }

      const systemNames = idsOfType(api, modelId, ifc.IFCSYSTEM).map((id) => readNameValue(api, modelId, id))
      expect(systemNames).toContain('BIMPipe Sanitary Stacks')
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('IFC4: reopened model has one IfcPipeSegment per stack with occurrence pset and quantities', async () => {
    const { ifc, api, modelId } = await exportAndReopen('IFC4')

    try {
      expect(api.GetModelSchema(modelId)).toBe('IFC4')

      const pipeSegmentIds = idsOfType(api, modelId, ifc.IFCPIPESEGMENT)
      expect(pipeSegmentIds).toHaveLength(STACK_COUNT)
      // IFC4 path writes IfcPipeSegment occurrences, never bare IfcFlowSegment.
      expect(idsOfType(api, modelId, ifc.IFCFLOWSEGMENT)).toHaveLength(0)

      // The IFC4 path intentionally writes no IfcPipeSegmentType and no type-level
      // Pset_PipeSegmentTypeCommon (see TODO(BIM-51) in the exporter). Assert the
      // current honest behavior so a future BIM-51 change updates this on purpose.
      expect(idsOfType(api, modelId, ifc.IFCPIPESEGMENTTYPE)).toHaveLength(0)

      const psetNames = idsOfType(api, modelId, ifc.IFCPROPERTYSET).map((id) => readNameValue(api, modelId, id))
      expect(psetNames.filter((name) => name === 'Pset_FlowSegmentOccurrence')).toHaveLength(STACK_COUNT)
      expect(psetNames.filter((name) => name === 'Pset_PipeSegmentTypeCommon')).toHaveLength(0)

      for (const pipeSegmentId of pipeSegmentIds) {
        const attached = attachedDefinitionNames(api, modelId, ifc, pipeSegmentId)
        expect(attached).toContain('Pset_FlowSegmentOccurrence')
        expect(attached).toContain('Qto_PipeSegmentBaseQuantities')
      }

      const systemNames = idsOfType(api, modelId, ifc.IFCSYSTEM).map((id) => readNameValue(api, modelId, id))
      expect(systemNames).toContain('BIMPipe Sanitary Stacks')
    } finally {
      api.CloseModel(modelId)
    }
  })
})
