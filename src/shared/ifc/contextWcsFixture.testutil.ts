/**
 * Synthetic IFC2X3 fixture (test-only) modelled on a Revit "Project Base Point"
 * export: IfcSite and IfcBuilding placements sit at the origin while the survey
 * offset and the TrueNorth rotation live in the 3D 'Model' representation
 * context's WorldCoordinateSystem / TrueNorth. Units are centimetres; the Body
 * sub-context is #24 like the other exporter fixtures.
 */

export const CONTEXT_FIXTURE_WCS_CM = { x: 19_671_472.399833947, y: 74_328_886.584343016, z: 1250 }
export const CONTEXT_FIXTURE_TRUE_NORTH_DEG = 6.53

export interface ContextWcsFixtureOptions {
  /** Defaults to CONTEXT_FIXTURE_WCS_CM. */
  wcsCm?: { x: number; y: number; z: number }
  /** Defaults to CONTEXT_FIXTURE_TRUE_NORTH_DEG; `null` omits TrueNorth (`$`). */
  trueNorthDeg?: number | null
  /** When true, WCS RefDirection rotates the WCS 90 degrees about +Z. */
  rotateWcs?: boolean
}

export function buildContextWcsIfc(options: ContextWcsFixtureOptions = {}): string {
  const wcs = options.wcsCm ?? CONTEXT_FIXTURE_WCS_CM
  const trueNorthDeg = options.trueNorthDeg === undefined ? CONTEXT_FIXTURE_TRUE_NORTH_DEG : options.trueNorthDeg
  const trueNorthLine =
    trueNorthDeg === null
      ? ''
      : `#13=IFCDIRECTION((${formatNumber(Math.sin((trueNorthDeg * Math.PI) / 180))},${formatNumber(
          Math.cos((trueNorthDeg * Math.PI) / 180),
        )}));\n`
  const trueNorthRef = trueNorthDeg === null ? '$' : '#13'
  const wcsRefDirection = options.rotateWcs ? '#15' : '$'

  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]','CoordinateReference [CoordinateBase: Project Base Point]'),'2;1');
FILE_NAME('context-wcs.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'',$,$,$,$,$);
#2=IFCORGANIZATION($,'Org',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','BIMPipe','BIMPipe');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#6=IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.);
#7=IFCUNITASSIGNMENT((#6));
#8=IFCDIRECTION((1.,0.,0.));
#9=IFCDIRECTION((0.,0.,1.));
#10=IFCCARTESIANPOINT((0.,0.,0.));
#11=IFCCARTESIANPOINT((${formatNumber(wcs.x)},${formatNumber(wcs.y)},${formatNumber(wcs.z)}));
#12=IFCAXIS2PLACEMENT3D(#11,${options.rotateWcs ? '#9' : '$'},${wcsRefDirection});
${trueNorthLine}#15=IFCDIRECTION((0.,1.,0.));
#23=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#12,${trueNorthRef});
#24=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#23,$,.MODEL_VIEW.,$);
#25=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,#23,$,.GRAPH_VIEW.,$);
#30=IFCPROJECT('0Project00000000000000',#5,'Project',$,$,$,$,(#23),#7);
#40=IFCAXIS2PLACEMENT3D(#10,$,$);
#42=IFCLOCALPLACEMENT($,#40);
#45=IFCSITE('0Site00000000000000000',#5,'Default',$,$,#42,$,$,.ELEMENT.,$,$,$,$,$);
#46=IFCAXIS2PLACEMENT3D(#10,$,$);
#47=IFCLOCALPLACEMENT(#42,#46);
#50=IFCBUILDING('0Building0000000000000',#5,'Building',$,$,#47,$,$,.ELEMENT.,$,$,$);
#60=IFCAXIS2PLACEMENT3D(#10,$,$);
#62=IFCLOCALPLACEMENT(#47,#60);
#70=IFCBUILDINGSTOREY('0Storey2A0000000000000',#5,'Level 2',$,$,#62,$,$,.ELEMENT.,0.);
#71=IFCAXIS2PLACEMENT3D(#10,$,$);
#72=IFCLOCALPLACEMENT(#47,#71);
#73=IFCBUILDINGSTOREY('0Storey3A0000000000000',#5,'Level 3',$,$,#72,$,$,.ELEMENT.,300.);
#80=IFCRELAGGREGATES('0Agg000000000000000000',#5,$,$,#50,(#70,#73));
#81=IFCRELAGGREGATES('0AggB00000000000000000',#5,$,$,#45,(#50));
#82=IFCRELAGGREGATES('0AggP00000000000000000',#5,$,$,#30,(#45));
ENDSEC;
END-ISO-10303-21;
`
}

/** STEP real literal: always carries a decimal point, full double precision. */
function formatNumber(value: number): string {
  const text = value.toPrecision(17).replace(/0+$/, '')
  return text.includes('.') ? text : `${text}.`
}
