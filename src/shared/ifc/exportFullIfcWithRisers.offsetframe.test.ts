import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { exportFullIfcWithRisers } from './exportFullIfcWithRisers'
import { resolveLocalPlacementWorldMatrix } from './localPlacementMatrix'
import { createModelFrame, toLocalPoint, toSourcePoint } from '@/shared/frame/modelFrame'
import type { Riser } from '@/domain/types'

// W1 offset-frame round trip: prove that rendering in a local frame does not
// bend the export path. The building sits at 096-scale shared coordinates
// (~18 km / ~66 km in a millimetre model). A riser is placed the way the UI
// now produces it — a small local-frame position converted back to source
// coordinates with toSourcePoint — exported, reopened with a fresh web-ifc
// engine, and asserted to land at the correct ABSOLUTE source coordinates.
//
// Fixture: the T0 minimal project (mm units, Body subcontext #24, building,
// two storeys), with one change — the building placement #40 sits at the
// far-from-origin point #12 instead of the world origin.

// 096-P shared coordinates are ~(18144051, 66462427) in cm; this millimetre
// fixture reuses the same digit string, giving ~18.1 km / ~66.5 km — far
// beyond the 1 km far-from-origin threshold either way.
const BUILDING_EAST_MM = 18_144_051
const BUILDING_NORTH_MM = 66_462_427

function buildOffsetIfc(): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('offset.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC2X3'));
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
#12=IFCCARTESIANPOINT((${BUILDING_EAST_MM}.,${BUILDING_NORTH_MM}.,0.));
#23=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#11,$);
#24=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#23,$,.MODEL_VIEW.,$);
#30=IFCPROJECT('0Project00000000000000',#5,'Project',$,$,$,$,(#23),#7);
#40=IFCAXIS2PLACEMENT3D(#12,$,$);
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

// The viewer frame is metres, Y-up: IFC X -> X, IFC Y (north) -> -Z. The
// building's source-frame plan centre therefore sits at these viewer coords.
const BUILDING_VIEWER_X_M = BUILDING_EAST_MM / 1000
const BUILDING_VIEWER_Z_M = -BUILDING_NORTH_MM / 1000

function idsOfType(api: IfcAPI, modelId: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelId, type)
  const ids: number[] = []
  for (let i = 0; i < vector.size(); i += 1) {
    ids.push(vector.get(i))
  }
  return ids
}

describe('exportFullIfcWithRisers offset frame (far-from-origin building)', () => {
  it('a riser placed via local-frame conversion lands at the correct absolute source coordinates', async () => {
    // The model frame the viewer would resolve for this building (origin
    // quantized to whole metres by createModelFrame).
    const frame = createModelFrame({ x: BUILDING_VIEWER_X_M, y: 0, z: BUILDING_VIEWER_Z_M })
    expect(Math.hypot(frame.origin.x, frame.origin.z)).toBeGreaterThan(1_000)

    // The engineer drags a riser to a small local position; the page handler
    // converts it back to source coordinates before it reaches domain state.
    const localPosition = { x: 1.5, y: 0, z: 2.5 }
    const sourcePosition = toSourcePoint(frame, localPosition)

    // The conversion must be lossless at this magnitude (Sterbenz range).
    expect(toLocalPoint(frame, sourcePosition)).toEqual(localPosition)

    // One vertical stack spanning both storeys at the converted source position.
    const risers: Riser[] = [
      { id: 'r-f2', stackId: 'stack-1', stackLabel: 'R1', storeyId: 70, position: sourcePosition },
      { id: 'r-f3', stackId: 'stack-1', stackLabel: 'R1', storeyId: 73, position: sourcePosition },
    ]

    const ifc = await import('web-ifc')
    const exportApi = new ifc.IfcAPI()
    await exportApi.Init()
    const exportedBytes = await exportFullIfcWithRisers(
      exportApi,
      new TextEncoder().encode(buildOffsetIfc()),
      70,
      risers,
      null,
      [],
      [],
    )
    expect(exportedBytes.length).toBeGreaterThan(0)

    // Reopen with a fresh engine so nothing leaks from the export session.
    const reopenApi = new ifc.IfcAPI()
    await reopenApi.Init()
    const modelId = reopenApi.OpenModel(exportedBytes)

    try {
      const flowSegmentIds = idsOfType(reopenApi, modelId, ifc.IFCFLOWSEGMENT)
      expect(flowSegmentIds).toHaveLength(1)

      const flowSegment = reopenApi.GetLine(modelId, flowSegmentIds[0], false) as {
        ObjectPlacement?: { value?: number } | null
      }
      const placementId = flowSegment.ObjectPlacement?.value
      expect(typeof placementId).toBe('number')

      // Resolve the reopened placement chain to ABSOLUTE model coordinates.
      const world = resolveLocalPlacementWorldMatrix(reopenApi, modelId, placementId as number)
      const [worldX, worldY] = [world.elements[12], world.elements[13]]

      // Expected absolute source coordinates (mm): the source position the
      // local-frame conversion produced, converted viewer->IFC (x -> x, z -> -y).
      const expectedXMm = sourcePosition.x * 1000
      const expectedYMm = -sourcePosition.z * 1000

      expect(Math.abs(worldX - expectedXMm)).toBeLessThan(0.5)
      expect(Math.abs(worldY - expectedYMm)).toBeLessThan(0.5)

      // And in absolute terms: the riser is ~18 km east / ~66 km north, i.e.
      // the export stayed in the source frame end to end.
      expect(worldX).toBeGreaterThan(18_000_000)
      expect(worldY).toBeGreaterThan(66_000_000)
    } finally {
      reopenApi.CloseModel(modelId)
    }
  })
})
