import { describe, it, expect, beforeAll } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import type { LengthUnit } from '@/shared/lengthUnits'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'

// Exercises the reader against the real web-ifc engine (no mocks) using minimal
// crafted IFC text, following the pattern of exportFullIfcWithRisers.realengine.test.ts.
// The unit section is parameterized per test case; everything else is a shared shell.
function buildIfc(unitSection: string, unitsInContextRef: string): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('units.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'',$,$,$,$,$);
#2=IFCORGANIZATION($,'Org',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','BIMPipe','BIMPipe');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
${unitSection}
#8=IFCDIRECTION((1.,0.,0.));
#9=IFCDIRECTION((0.,0.,1.));
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCAXIS2PLACEMENT3D(#10,#9,#8);
#23=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#11,$);
#30=IFCPROJECT('0Project00000000000000',#5,'Project',$,$,$,$,(#23),${unitsInContextRef});
ENDSEC;
END-ISO-10303-21;
`
}

let api: IfcAPI

beforeAll(async () => {
  const { IfcAPI } = await import('web-ifc')
  api = new IfcAPI()
  await api.Init()
}, 60_000)

async function resolveFromIfc(unitSection: string, unitsInContextRef = '#7'): Promise<LengthUnit | null> {
  const modelId = api.OpenModel(new TextEncoder().encode(buildIfc(unitSection, unitsInContextRef)))
  try {
    return await resolveModelLengthUnit(api, modelId)
  } finally {
    api.CloseModel(modelId)
  }
}

describe('resolveModelLengthUnit (real web-ifc engine)', () => {
  it('resolves MILLI-prefixed SI metre to mm', async () => {
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBe('mm')
  }, 30_000)

  it('resolves CENTI-prefixed SI metre to cm', async () => {
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBe('cm')
  }, 30_000)

  it('resolves unprefixed SI metre to m', async () => {
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBe('m')
  }, 30_000)

  it('skips non-length units, including conversion-based angle units (Revit-style assignment)', async () => {
    // Mirrors the structure of the 096 Revit 2026 exports: length cm + area +
    // volume + conversion-based DEGREE plane angle in one assignment.
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);
#12=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#13=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#14=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#15=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);
#16=IFCMEASUREWITHUNIT(IFCPLANEANGLEMEASURE(0.017453292519943295),#14);
#17=IFCCONVERSIONBASEDUNIT(#15,.PLANEANGLEUNIT.,'DEGREE',#16);
#7=IFCUNITASSIGNMENT((#6,#12,#13,#17));`,
    )
    expect(unit).toBe('cm')
  }, 30_000)

  it('returns null for a conversion-based length unit (feet) instead of guessing', async () => {
    const unit = await resolveFromIfc(
      `#12=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#13=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#12);
#14=IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0);
#6=IFCCONVERSIONBASEDUNIT(#14,.LENGTHUNIT.,'FOOT',#13);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBeNull()
  }, 30_000)

  it('returns null for an unsupported SI prefix instead of guessing', async () => {
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.LENGTHUNIT.,.DECI.,.METRE.);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBeNull()
  }, 30_000)

  it('returns null when the assignment has no length unit', async () => {
    const unit = await resolveFromIfc(
      `#6=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#7=IFCUNITASSIGNMENT((#6));`,
    )
    expect(unit).toBeNull()
  }, 30_000)

  it('returns null when the project has no unit assignment', async () => {
    const unit = await resolveFromIfc('', '$')
    expect(unit).toBeNull()
  }, 30_000)
})
