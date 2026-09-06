import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { exportFullIfcWithRisers, type ExportRiser } from './exportFullIfcWithRisers'
import type { FloorRoutes } from '@/domain/branchRouting'
import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'

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

// Same stacks, but stack-2 carries an explicit non-default diameter (Ø160);
// stack-1 stays unspecified and must fall back to the Ø110 default.
const risersWithDiameters: ExportRiser[] = [
  { id: 's1-f2', stackId: 'stack-1', stackLabel: 'R1', storeyId: 70, position: { x: 1, y: 0, z: 1 } },
  { id: 's1-f3', stackId: 'stack-1', stackLabel: 'R1', storeyId: 73, position: { x: 1, y: 0, z: 1 } },
  { id: 's2-f2', stackId: 'stack-2', stackLabel: 'R2', storeyId: 70, position: { x: 3, y: 0, z: 2 }, diameterMm: 160 },
  { id: 's2-f3', stackId: 'stack-2', stackLabel: 'R2', storeyId: 73, position: { x: 3, y: 0, z: 2 }, diameterMm: 160 },
]

// Two branch runs on storey #70 draining to the two stacks; endpoint elevations
// use the routing datum (0 = the branch connection at the riser).
const BRANCH_SEGMENT_COUNT = 2
const branchRoutes: FloorRoutes[] = [
  {
    storeyId: 70,
    planUnits: 'm',
    segments: [
      {
        id: 'branch-seg|70|s1-f2|0',
        start: { x: 2, z: 1, elevation: 0.02 },
        end: { x: 1, z: 1, elevation: 0 },
        axis: 'x',
        kind: 'fixture-branch',
        servedFixtureExpressIds: [901],
        diameterMm: 110,
        riserId: 's1-f2',
        riserStackId: 'stack-1',
      },
      {
        id: 'branch-seg|70|s2-f2|0',
        start: { x: 3, z: 4, elevation: 0.04 },
        end: { x: 3, z: 2, elevation: 0 },
        axis: 'z',
        kind: 'trunk',
        servedFixtureExpressIds: [902, 903],
        diameterMm: 63,
        riserId: 's2-f2',
        riserStackId: 'stack-2',
      },
    ],
  },
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

/**
 * Same minimal model, but with no Body sub-context at all: its only Body shape
 * representation (an empty swept-solid placeholder on the storey) points
 * straight at the 'Model' context, the way the bundled Duplex MEP sample does.
 */
function buildIfcWithoutBodySubContext(schema: 'IFC2X3' | 'IFC4'): string {
  return buildMinimalIfc(schema)
    .replace(`#24=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#23,$,.MODEL_VIEW.,$);\n`, '')
    .replace(
      'ENDSEC;\nEND-ISO-10303-21;',
      `#90=IFCCARTESIANPOINT((0.,0.));
#91=IFCPOLYLINE((#90,#90));
#92=IFCSHAPEREPRESENTATION(#23,'Body','Curve2D',(#91));
#93=IFCPRODUCTDEFINITIONSHAPE($,$,(#92));
#94=IFCBUILDINGELEMENTPROXY('0Proxy0000000000000000',#5,'Marker',$,$,#62,#93,$,$);
ENDSEC;
END-ISO-10303-21;`,
    )
}

async function exportAndReopen(
  schema: 'IFC2X3' | 'IFC4',
  options: {
    risers?: ExportRiser[]
    branchRoutes?: FloorRoutes[]
    sanitaryRoutes?: SanitaryFixtureRoute[]
    sourceIfc?: string
  } = {},
): Promise<{
  ifc: ImportedIfc
  api: IfcAPI
  modelId: number
}> {
  const ifc = await import('web-ifc')

  const exportApi = new ifc.IfcAPI()
  await exportApi.Init()
  const exportedBytes = await exportFullIfcWithRisers(
    exportApi,
    new TextEncoder().encode(options.sourceIfc ?? buildMinimalIfc(schema)),
    70,
    options.risers ?? risers,
    null,
    options.sanitaryRoutes ?? [],
    options.branchRoutes ?? [],
  )
  expect(exportedBytes).toBeInstanceOf(Uint8Array)
  expect(exportedBytes.length).toBeGreaterThan(0)

  // Reopen with a fresh engine instance so nothing leaks from the export session.
  const reopenApi = new ifc.IfcAPI()
  await reopenApi.Init()
  const modelId = reopenApi.OpenModel(exportedBytes)
  return { ifc, api: reopenApi, modelId }
}

function readRadiusValue(api: IfcAPI, modelId: number, profileId: number): number | null {
  const line = api.GetLine(modelId, profileId, false) as { Radius?: { value?: number } | number | null } | null
  const radius = line?.Radius
  if (typeof radius === 'number') return radius
  if (typeof radius?.value === 'number') return radius.value
  return null
}

/** Express IDs grouped into the IfcSystem with the given name via IfcRelAssignsToGroup. */
function systemMemberIds(api: IfcAPI, modelId: number, ifc: ImportedIfc, systemName: string): number[] {
  for (const relId of idsOfType(api, modelId, ifc.IFCRELASSIGNSTOGROUP)) {
    const relation = api.GetLine(modelId, relId, false) as {
      RelatedObjects?: Array<{ value?: number } | null> | null
      RelatingGroup?: { value?: number } | null
    } | null
    const groupId = relation?.RelatingGroup?.value
    if (typeof groupId !== 'number') continue
    if (readNameValue(api, modelId, groupId) !== systemName) continue
    return (relation?.RelatedObjects ?? [])
      .flatMap((ref) => (typeof ref?.value === 'number' ? [ref.value] : []))
  }
  return []
}

/** Values of every IfcQuantityLength with the given name, across the whole model. */
function quantityLengthValues(api: IfcAPI, modelId: number, ifc: ImportedIfc, name: string): number[] {
  const values: number[] = []
  for (const quantityId of idsOfType(api, modelId, ifc.IFCQUANTITYLENGTH)) {
    if (readNameValue(api, modelId, quantityId) !== name) continue
    const line = api.GetLine(modelId, quantityId, false) as {
      LengthValue?: { value?: number } | number | null
    } | null
    const raw = line?.LengthValue
    const value = typeof raw === 'number' ? raw : raw?.value
    if (typeof value === 'number') values.push(value)
  }
  return values
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

  it('IFC2X3: a model without a Body sub-context exports into the context its Body shapes use', async () => {
    const { ifc, api, modelId } = await exportAndReopen('IFC2X3', {
      sourceIfc: buildIfcWithoutBodySubContext('IFC2X3'),
      branchRoutes,
    })
    try {
      expect(idsOfType(api, modelId, ifc.IFCGEOMETRICREPRESENTATIONSUBCONTEXT)).toHaveLength(0)
      const flowSegmentIds = idsOfType(api, modelId, ifc.IFCFLOWSEGMENT)
      expect(flowSegmentIds).toHaveLength(STACK_COUNT + BRANCH_SEGMENT_COUNT)
      // Every exported pipe body sits in the model's 'Model' context (#23).
      for (const id of flowSegmentIds) {
        const element = api.GetLine(modelId, id, false) as { Representation?: { value: number } | null }
        const shapeDef = api.GetLine(modelId, element.Representation!.value, false) as {
          Representations: Array<{ value: number }>
        }
        for (const shapeRef of shapeDef.Representations) {
          const shape = api.GetLine(modelId, shapeRef.value, false) as { ContextOfItems: { value: number } }
          expect(shape.ContextOfItems.value).toBe(23)
        }
      }
    } finally {
      api.CloseModel(modelId)
    }
  })

  for (const schema of ['IFC2X3', 'IFC4'] as const) {
    it(`${schema}: branch segments and stack diameters reopen correctly (count, system, profiles, quantities)`, async () => {
      const { ifc, api, modelId } = await exportAndReopen(schema, {
        risers: risersWithDiameters,
        branchRoutes,
      })

      try {
        const elementType = schema === 'IFC2X3' ? ifc.IFCFLOWSEGMENT : ifc.IFCPIPESEGMENT
        const otherType = schema === 'IFC2X3' ? ifc.IFCPIPESEGMENT : ifc.IFCFLOWSEGMENT

        // Segment count = stacks + branch segments, all on the schema's element type.
        const elementIds = idsOfType(api, modelId, elementType)
        expect(elementIds).toHaveLength(STACK_COUNT + BRANCH_SEGMENT_COUNT)
        expect(idsOfType(api, modelId, otherType)).toHaveLength(0)

        // Branch elements are named after their role and target stack.
        const elementNames = elementIds.map((id) => readNameValue(api, modelId, id))
        // Segment names carry the per-segment diameter: Ø110 WC branch, Ø63 shared trunk.
        expect(elementNames).toContain('BIMPipe Branch 110mm -> R1')
        expect(elementNames).toContain('BIMPipe Trunk 63mm -> R2')

        // The stacks system groups stacks AND branch segments.
        const memberIds = systemMemberIds(api, modelId, ifc, 'BIMPipe Sanitary Stacks')
        expect(memberIds).toHaveLength(STACK_COUNT + BRANCH_SEGMENT_COUNT)
        expect([...memberIds].sort((a, b) => a - b)).toEqual([...elementIds].sort((a, b) => a - b))

        // Diameters round-trip through the written circle profiles (source units = mm):
        // Ø63 shared trunk -> radius 31.5, Ø110 default stack-1 + Ø110 WC branch -> radius 55,
        // explicit Ø160 stack-2 -> radius 80.
        const radii = idsOfType(api, modelId, ifc.IFCCIRCLEPROFILEDEF)
          .map((id) => readRadiusValue(api, modelId, id))
          .sort((a, b) => (a ?? 0) - (b ?? 0))
        expect(radii).toEqual([31.5, 55, 55, 80])

        // ...and through the NominalDiameter base quantity on every segment.
        const diameterQuantities = quantityLengthValues(api, modelId, ifc, 'NominalDiameter').sort((a, b) => a - b)
        expect(diameterQuantities).toEqual([63, 110, 110, 160])

        if (schema === 'IFC2X3') {
          // One type per stack + one shared branch type per distinct branch diameter
          // (Ø63 and Ø110 here), each with the type-common pset.
          const BRANCH_DIAMETER_COUNT = 2
          expect(idsOfType(api, modelId, ifc.IFCPIPESEGMENTTYPE)).toHaveLength(STACK_COUNT + BRANCH_DIAMETER_COUNT)
          const psetNames = idsOfType(api, modelId, ifc.IFCPROPERTYSET).map((id) => readNameValue(api, modelId, id))
          expect(psetNames.filter((name) => name === 'Pset_PipeSegmentTypeCommon')).toHaveLength(
            STACK_COUNT + BRANCH_DIAMETER_COUNT,
          )
        } else {
          // TODO(BIM-51) parity: the IFC4 path still writes no type objects/psets,
          // for branches exactly as for stacks.
          expect(idsOfType(api, modelId, ifc.IFCPIPESEGMENTTYPE)).toHaveLength(0)
          const psetNames = idsOfType(api, modelId, ifc.IFCPROPERTYSET).map((id) => readNameValue(api, modelId, id))
          expect(psetNames.filter((name) => name === 'Pset_PipeSegmentTypeCommon')).toHaveLength(0)
        }

        // Every element (stack or branch) carries the occurrence pset and base quantities.
        for (const elementId of elementIds) {
          const attached = attachedDefinitionNames(api, modelId, ifc, elementId)
          expect(attached).toContain('Pset_FlowSegmentOccurrence')
          expect(attached).toContain('Qto_PipeSegmentBaseQuantities')
        }
      } finally {
        api.CloseModel(modelId)
      }
    })
  }

  it('refuses to export branch routes whose riser has drifted, naming the riser and distance', async () => {
    const ifc = await import('web-ifc')
    const api = new ifc.IfcAPI()
    await api.Init()

    // Riser s1-f2 sits at (1, 1) m but the routes (in mm plan units here to cover
    // unit conversion) connect to it at (1050, 1000) mm -> 50 mm drift.
    const driftedRoutes: FloorRoutes[] = [
      {
        storeyId: 70,
        planUnits: 'mm',
        segments: [
          {
            id: 'branch-seg|70|s1-f2|0',
            start: { x: 2050, z: 1000, elevation: 20 },
            end: { x: 1050, z: 1000, elevation: 0 },
            axis: 'x',
            kind: 'fixture-branch',
            servedFixtureExpressIds: [901],
            diameterMm: 110,
            riserId: 's1-f2',
            riserStackId: 'stack-1',
          },
        ],
      },
    ]

    await expect(
      exportFullIfcWithRisers(
        api,
        new TextEncoder().encode(buildMinimalIfc('IFC2X3')),
        70,
        risers,
        null,
        [],
        driftedRoutes,
      ),
    ).rejects.toThrow(/riser s1-f2 \(stack R1\).*50\.0 mm drift.*Recompute branch routes/s)
  })

  it('refuses to export branch routes that reference a riser which no longer exists', async () => {
    const ifc = await import('web-ifc')
    const api = new ifc.IfcAPI()
    await api.Init()

    const staleRoutes: FloorRoutes[] = [
      {
        storeyId: 70,
        planUnits: 'm',
        segments: [
          {
            id: 'branch-seg|70|ghost|0',
            start: { x: 2, z: 1, elevation: 0.02 },
            end: { x: 1, z: 1, elevation: 0 },
            axis: 'x',
            kind: 'fixture-branch',
            servedFixtureExpressIds: [901],
            diameterMm: 110,
            riserId: 'ghost',
          },
        ],
      },
    ]

    await expect(
      exportFullIfcWithRisers(
        api,
        new TextEncoder().encode(buildMinimalIfc('IFC2X3')),
        70,
        risers,
        null,
        [],
        staleRoutes,
      ),
    ).rejects.toThrow(/riser ghost, which no longer exists.*Recompute branch routes/s)
  })

  // One sanitary fixture route draining to stack-1 on storey #70 -> exactly one route element.
  const sanitaryRoutes: SanitaryFixtureRoute[] = [
    {
      fixtureExpressId: 501,
      fixtureName: 'WC-5',
      fixtureKind: 'TOILETPAN',
      riserId: 's1-f2',
      pipeDiameterMm: 110,
      startHeightAboveFloorM: 0.2,
      slope: 0.02,
      segments: [{ from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 1 }, kind: 'main', pipeDiameterMm: 110 }],
    },
  ]

  for (const schema of ['IFC2X3', 'IFC4'] as const) {
    it(`${schema}: sanitary-route system membership survives reopen (RelatingGroup non-null, correct members)`, async () => {
      const { ifc, api, modelId } = await exportAndReopen(schema, { sanitaryRoutes })

      try {
        const elementType = schema === 'IFC2X3' ? ifc.IFCFLOWSEGMENT : ifc.IFCPIPESEGMENT
        const elementIds = idsOfType(api, modelId, elementType)
        expect(elementIds).toHaveLength(STACK_COUNT + 1)

        // The route assignment's RelatingGroup must reopen non-null and resolve to
        // the routes system (guards the IFC4 `*`-serialization misparse regression).
        const routeAssignment = idsOfType(api, modelId, ifc.IFCRELASSIGNSTOGROUP)
          .map((relId) => api.GetLine(modelId, relId, false) as {
            Name?: { value?: string } | string | null
            RelatingGroup?: { value?: number } | null
          } | null)
          .find((relation) => {
            const name = relation?.Name
            const nameValue = typeof name === 'string' ? name : name?.value
            return nameValue === 'BIMPipe Sanitary Route Assignment'
          })
        expect(routeAssignment).toBeDefined()
        expect(routeAssignment?.RelatingGroup?.value).toEqual(expect.any(Number))
        expect(readNameValue(api, modelId, routeAssignment!.RelatingGroup!.value!)).toBe(
          'BIMPipe Sanitary Routes',
        )

        // Membership: exactly the one route element in the routes system, exactly the
        // two stacks in the stacks system, together covering every exported element.
        const routeMembers = systemMemberIds(api, modelId, ifc, 'BIMPipe Sanitary Routes')
        const stackMembers = systemMemberIds(api, modelId, ifc, 'BIMPipe Sanitary Stacks')
        expect(routeMembers).toHaveLength(1)
        expect(stackMembers).toHaveLength(STACK_COUNT)
        expect(stackMembers).not.toContain(routeMembers[0])
        expect([...routeMembers, ...stackMembers].sort((a, b) => a - b)).toEqual(
          [...elementIds].sort((a, b) => a - b),
        )
        expect(readNameValue(api, modelId, routeMembers[0])).toContain('BIMPipe Main 110mm')
      } finally {
        api.CloseModel(modelId)
      }
    })
  }
})
