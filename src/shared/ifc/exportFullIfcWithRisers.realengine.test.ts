import { describe, expect, it } from 'vitest'
import { exportFullIfcWithRisers } from './exportFullIfcWithRisers'
import type { Riser } from '@/domain/types'
import type { SanitaryFixtureRoute } from '@/shared/routes/buildSanitaryRoutes'

// Minimal IFC2X3 model: project + mm unit + Body subcontext (#24) + building + two storeys.
// Exercises the full export against the real web-ifc engine (no mocks) to catch binding/type
// errors that mocked unit tests cannot — e.g. SELECT-typed attributes needing a real Handle.
const MINIMAL_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('minimal.ifc','',(''),(''),'','','');
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
#23=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#11,$);
#24=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#23,$,.MODEL_VIEW.,$);
#30=IFCPROJECT('0Project00000000000000',#5,'Project',$,$,$,$,(#23),#7);
#40=IFCAXIS2PLACEMENT3D(#10,$,$);
#42=IFCLOCALPLACEMENT($,#40);
#50=IFCBUILDING('0Building0000000000000',#5,'Building',$,$,#42,$,$,.ELEMENT.,$,$,$);
#60=IFCAXIS2PLACEMENT3D(#10,$,$);
#62=IFCLOCALPLACEMENT(#42,#60);
#70=IFCBUILDINGSTOREY('0Storey2A0000000000000',#5,'\\X2\\05E705D805DC\\X0\\ 2',$,$,#62,$,$,.ELEMENT.,0.);
#71=IFCAXIS2PLACEMENT3D(#10,$,$);
#72=IFCLOCALPLACEMENT(#42,#71);
#73=IFCBUILDINGSTOREY('0Storey3A0000000000000',#5,'\\X2\\05E705D805DC\\X0\\ 3',$,$,#72,$,$,.ELEMENT.,3000.);
#80=IFCRELAGGREGATES('0Agg000000000000000000',#5,$,$,#50,(#70,#73));
#81=IFCRELAGGREGATES('0AggP00000000000000000',#5,$,$,#30,(#50));
ENDSEC;
END-ISO-10303-21;
`

const risers: Riser[] = [
  { id: 'r1-f2', stackId: 'stack-1', stackLabel: 'R5', storeyId: 70, position: { x: 1, y: 0, z: 1 } },
  { id: 'r1-f3', stackId: 'stack-1', stackLabel: 'R5', storeyId: 73, position: { x: 1, y: 0, z: 1 } },
]

const sanitaryRoutes: SanitaryFixtureRoute[] = [
  {
    fixtureExpressId: 501,
    fixtureName: 'WC-5',
    fixtureKind: 'TOILETPAN',
    riserId: 'r1-f2',
    pipeDiameterMm: 110,
    startHeightAboveFloorM: 0.2,
    slope: 0.02,
    segments: [{ from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 1 }, kind: 'main', pipeDiameterMm: 110 }],
  },
  {
    fixtureExpressId: 502,
    fixtureName: 'WC-2',
    fixtureKind: 'TOILETPAN',
    riserId: 'r1-f2',
    pipeDiameterMm: 110,
    startHeightAboveFloorM: 0.2,
    slope: 0.02,
    segments: [{ from: { x: 2, y: 0, z: 2 }, to: { x: 1, y: 0, z: 1 }, kind: 'branch', pipeDiameterMm: 110 }],
  },
]

describe('exportFullIfcWithRisers against the real web-ifc engine', () => {
  it('exports risers + sanitary routes to a non-empty IFC without binding errors', async () => {
    const { IfcAPI } = await import('web-ifc')
    const api = new IfcAPI()
    await api.Init()

    const bytes = await exportFullIfcWithRisers(
      api,
      new TextEncoder().encode(MINIMAL_IFC),
      70,
      risers,
      null,
      sanitaryRoutes,
    )

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)

    const text = new TextDecoder().decode(bytes)
    // Both the riser stack system and the sanitary route system are written.
    expect(text).toContain('BIMPipe Sanitary Routes')
    expect(text).toContain('BIMPipe Sanitary Stacks')
    // Pipe segment elements exist for the exported geometry.
    expect(text).toMatch(/IFCFLOWSEGMENT/)
  })

  it('still exports cleanly when no sanitary routes are provided', async () => {
    const { IfcAPI } = await import('web-ifc')
    const api = new IfcAPI()
    await api.Init()

    const bytes = await exportFullIfcWithRisers(api, new TextEncoder().encode(MINIMAL_IFC), 70, risers, null, [])

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('skips a zero-length route segment instead of aborting the export', async () => {
    const { IfcAPI } = await import('web-ifc')
    const api = new IfcAPI()
    await api.Init()

    const routesWithCoincident: SanitaryFixtureRoute[] = [
      // Degenerate: fixture point coincides with the riser (from === to).
      {
        fixtureExpressId: 777,
        fixtureName: 'WC-coincident',
        fixtureKind: 'TOILETPAN',
        riserId: 'r1-f2',
        pipeDiameterMm: 110,
        startHeightAboveFloorM: 0.2,
        slope: 0.02,
        segments: [{ from: { x: 1, y: 0, z: 1 }, to: { x: 1, y: 0, z: 1 }, kind: 'main', pipeDiameterMm: 110 }],
      },
      // Valid route that must still export.
      ...sanitaryRoutes,
    ]

    const bytes = await exportFullIfcWithRisers(
      api,
      new TextEncoder().encode(MINIMAL_IFC),
      70,
      risers,
      null,
      routesWithCoincident,
    )

    expect(bytes).toBeInstanceOf(Uint8Array)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('BIMPipe Sanitary Routes')
    expect(text).toContain('BIMPipeSanitaryRoute')
  })
})
