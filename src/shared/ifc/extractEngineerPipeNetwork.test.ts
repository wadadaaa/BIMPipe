import { describe, expect, it } from 'vitest'
import {
  extractEngineerPipeNetwork,
  filterOriginArtifacts,
  resolveMetersPerSourceUnit,
} from './extractEngineerPipeNetwork'
import { classifyEngineerRiserStacks, fittingConnectorExpressId } from '@/domain/engineerPipes'
import type { IfcAPI } from 'web-ifc'

/**
 * Programmatic synthetic plumbing IFC (IFC2X3, CENTIMETRE units, neutral
 * names). Exercised against the real web-ifc engine — no mocks — so line
 * shapes, enum values, and geometry maths match production behaviour.
 */

function formatStepNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.` : `${value}`
}

function syntheticGuid(counter: number): string {
  return String(counter).padStart(22, '0')
}

class StepBuilder {
  private lines: string[] = []
  private nextId = 1
  private guidCounter = 0

  add(body: string): number {
    const id = this.nextId
    this.nextId += 1
    this.lines.push(`#${id}=${body};`)
    return id
  }

  guid(): string {
    this.guidCounter += 1
    return syntheticGuid(this.guidCounter)
  }

  build(): string {
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''),'2;1');",
      "FILE_NAME('synthetic.ifc','',(''),(''),'','','');",
      "FILE_SCHEMA(('IFC2X3'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n')
  }
}

interface PipeSpec {
  name: string
  /** Extrusion base point in cm (source coordinates). */
  locationCm: [number, number, number]
  /** Pipe axis direction (the placement Z-axis); defaults to vertical. */
  axis?: [number, number, number]
  /** RefDirection hint for the placement; omitted -> IFC default. */
  refDirection?: [number, number, number]
  depthCm: number
  radiusCm: number
  /** Pset Length / InvertElevation in cm; omit for a pset-less pipe. */
  pset?: { lengthCm: number; invertElevationCm: number }
  system: string
  storey: string
}

interface SyntheticModel {
  text: string
}

interface SyntheticModelOptions {
  /** Put the CENTI-metre LENGTHUNIT into the project unit assignment (default true). */
  includeLengthUnit?: boolean
  /**
   * Declare DECI-metre and plain metre IfcSIUnit LENGTHUNITs that are only
   * elements of an IfcDerivedUnit (volumetric flow rate) in the assignment —
   * the Revit pattern that must not make the model's length unit ambiguous.
   */
  derivedUnitLengthUnits?: boolean
  /** SI prefixes of stray LENGTHUNIT lines referenced by nothing (fallback-scan cases). */
  strayLengthUnitPrefixes?: Array<'MILLI' | 'CENTI' | 'DECI' | null>
  /** Add an elbow IfcFlowFitting at the end of Branch 1, a single-port cap and a foreign-system elbow (R3). */
  withFittings?: boolean
  /**
   * Revit "vertical pipe" export: a Ø110 cut face (IfcFaceBasedSurfaceModel,
   * 16-gon disc) with two IfcDistributionPorts spanning 100..450 cm.
   */
  withCutFaceStack?: boolean
  /** A 300 × 11 cm flat rectangle (surface model, no ports): mesh-bounds fallback. */
  withSurfaceBar?: boolean
  /** A Ø110 cut face without any port: unresolved geometry. */
  withOrphanCutFace?: boolean
}

/** Local XY (cm) of a regular polygon inscribed in a circle, even count so opposite vertices span the diameter. */
function discPointsCm(centreX: number, centreY: number, radiusCm: number, count: number): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = []
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count
    points.push([centreX + radiusCm * Math.cos(angle), centreY + radiusCm * Math.sin(angle), 0])
  }
  return points
}

function buildSyntheticPlumbingIfc(options: SyntheticModelOptions = {}): SyntheticModel {
  const includeLengthUnit = options.includeLengthUnit ?? true
  const b = new StepBuilder()

  const person = b.add('IFCPERSON($,$,$,$,$,$,$,$)')
  const org = b.add("IFCORGANIZATION($,'Synthetic',$,$,$)")
  const personAndOrg = b.add(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`)
  const application = b.add(`IFCAPPLICATION(#${org},'1.0','Synthetic','Synthetic')`)
  const ownerHistory = b.add(`IFCOWNERHISTORY(#${personAndOrg},#${application},$,.ADDED.,$,$,$,0)`)

  const units: number[] = []
  if (includeLengthUnit) units.push(b.add('IFCSIUNIT(*,.LENGTHUNIT.,.CENTI.,.METRE.)'))
  units.push(b.add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'))
  if (options.derivedUnitLengthUnits) {
    const decimetre = b.add('IFCSIUNIT(*,.LENGTHUNIT.,.DECI.,.METRE.)')
    const metre = b.add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')
    const second = b.add('IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.)')
    const flowElements = [
      b.add(`IFCDERIVEDUNITELEMENT(#${decimetre},3)`),
      b.add(`IFCDERIVEDUNITELEMENT(#${second},-1)`),
    ]
    units.push(b.add(`IFCDERIVEDUNIT((${flowElements.map((id) => `#${id}`).join(',')}),.VOLUMETRICFLOWRATEUNIT.,$)`))
    const milligram = b.add('IFCSIUNIT(*,.MASSUNIT.,.MILLI.,.GRAM.)')
    const concentrationElements = [
      b.add(`IFCDERIVEDUNITELEMENT(#${milligram},1)`),
      b.add(`IFCDERIVEDUNITELEMENT(#${metre},-3)`),
    ]
    units.push(
      b.add(`IFCDERIVEDUNIT((${concentrationElements.map((id) => `#${id}`).join(',')}),.IONCONCENTRATIONUNIT.,$)`),
    )
  }
  for (const prefix of options.strayLengthUnitPrefixes ?? []) {
    b.add(`IFCSIUNIT(*,.LENGTHUNIT.,${prefix === null ? '$' : `.${prefix}.`},.METRE.)`)
  }
  const unitAssignment = b.add(`IFCUNITASSIGNMENT((${units.map((id) => `#${id}`).join(',')}))`)

  const worldOrigin = b.add('IFCCARTESIANPOINT((0.,0.,0.))')
  const worldAxis = b.add(`IFCAXIS2PLACEMENT3D(#${worldOrigin},$,$)`)
  const context = b.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${worldAxis},$)`)
  const project = b.add(
    `IFCPROJECT('${b.guid()}',#${ownerHistory},'Synthetic Project',$,$,$,$,(#${context}),#${unitAssignment})`,
  )

  const buildingPlacementAxis = b.add(`IFCAXIS2PLACEMENT3D(#${worldOrigin},$,$)`)
  const buildingPlacement = b.add(`IFCLOCALPLACEMENT($,#${buildingPlacementAxis})`)
  const building = b.add(
    `IFCBUILDING('${b.guid()}',#${ownerHistory},'Synthetic Building',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`,
  )

  const storeyIds = new Map<string, number>()
  for (const [name, elevationCm] of [
    ['Level A', 0],
    ['Level B', 300],
  ] as const) {
    const axis = b.add(`IFCAXIS2PLACEMENT3D(#${worldOrigin},$,$)`)
    const placement = b.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${axis})`)
    const storey = b.add(
      `IFCBUILDINGSTOREY('${b.guid()}',#${ownerHistory},'${name}',$,$,#${placement},$,'${name}',.ELEMENT.,${formatStepNumber(elevationCm)})`,
    )
    storeyIds.set(name, storey)
  }

  b.add(
    `IFCRELAGGREGATES('${b.guid()}',#${ownerHistory},$,$,#${project},(#${building}))`,
  )
  b.add(
    `IFCRELAGGREGATES('${b.guid()}',#${ownerHistory},$,$,#${building},(${[...storeyIds.values()].map((id) => `#${id}`).join(',')}))`,
  )

  const extrudeDirection = b.add('IFCDIRECTION((0.,0.,1.))')

  const pipesByStorey = new Map<string, number[]>()
  const pipesBySystem = new Map<string, number[]>()

  const addPipe = (spec: PipeSpec): number => {
    const profilePoint = b.add('IFCCARTESIANPOINT((0.,0.))')
    const profileDirection = b.add('IFCDIRECTION((1.,0.))')
    const profilePlacement = b.add(`IFCAXIS2PLACEMENT2D(#${profilePoint},#${profileDirection})`)
    const profile = b.add(
      `IFCCIRCLEPROFILEDEF(.AREA.,$,#${profilePlacement},${formatStepNumber(spec.radiusCm)})`,
    )

    const location = b.add(
      `IFCCARTESIANPOINT((${spec.locationCm.map(formatStepNumber).join(',')}))`,
    )
    const axisRef =
      spec.axis !== undefined
        ? `#${b.add(`IFCDIRECTION((${spec.axis.map(formatStepNumber).join(',')}))`)}`
        : '$'
    const refDirectionRef =
      spec.refDirection !== undefined
        ? `#${b.add(`IFCDIRECTION((${spec.refDirection.map(formatStepNumber).join(',')}))`)}`
        : '$'
    const position = b.add(`IFCAXIS2PLACEMENT3D(#${location},${axisRef},${refDirectionRef})`)
    const solid = b.add(
      `IFCEXTRUDEDAREASOLID(#${profile},#${position},#${extrudeDirection},${formatStepNumber(spec.depthCm)})`,
    )
    const shapeRep = b.add(
      `IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`,
    )
    const productShape = b.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`)

    const placementAxis = b.add(`IFCAXIS2PLACEMENT3D(#${worldOrigin},$,$)`)
    const placement = b.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${placementAxis})`)
    const pipe = b.add(
      `IFCFLOWSEGMENT('${b.guid()}',#${ownerHistory},'${spec.name}',$,$,#${placement},#${productShape},$)`,
    )

    if (spec.pset !== undefined) {
      const lengthProperty = b.add(
        `IFCPROPERTYSINGLEVALUE('Length',$,IFCPOSITIVELENGTHMEASURE(${formatStepNumber(spec.pset.lengthCm)}),$)`,
      )
      const invertProperty = b.add(
        `IFCPROPERTYSINGLEVALUE('InvertElevation',$,IFCLENGTHMEASURE(${formatStepNumber(spec.pset.invertElevationCm)}),$)`,
      )
      const pset = b.add(
        `IFCPROPERTYSET('${b.guid()}',#${ownerHistory},'Pset_FlowSegmentPipeSegment',$,(#${lengthProperty},#${invertProperty}))`,
      )
      b.add(
        `IFCRELDEFINESBYPROPERTIES('${b.guid()}',#${ownerHistory},$,$,(#${pipe}),#${pset})`,
      )
    }

    pipesByStorey.set(spec.storey, [...(pipesByStorey.get(spec.storey) ?? []), pipe])
    pipesBySystem.set(spec.system, [...(pipesBySystem.get(spec.system) ?? []), pipe])
    return pipe
  }

  /**
   * A pipe whose only body is a planar face (IfcFaceBasedSurfaceModel) in the
   * pipe's local frame, optionally with IfcDistributionPorts at local points —
   * the shape Revit exports for vertical pipes cut by the view range.
   */
  const addSurfacePipe = (spec: {
    name: string
    /** Pipe placement location in cm relative to the building. */
    locationCm: [number, number, number]
    facePointsCm: Array<[number, number, number]>
    /** Port locations in cm relative to the pipe placement. */
    portsCm?: Array<[number, number, number]>
    pset?: { lengthCm: number; invertElevationCm: number }
    system: string
    storey: string
  }): number => {
    const pointIds = spec.facePointsCm.map((point) =>
      b.add(`IFCCARTESIANPOINT((${point.map(formatStepNumber).join(',')}))`),
    )
    const loop = b.add(`IFCPOLYLOOP((${pointIds.map((id) => `#${id}`).join(',')}))`)
    const bound = b.add(`IFCFACEOUTERBOUND(#${loop},.T.)`)
    const face = b.add(`IFCFACE((#${bound}))`)
    const faceSet = b.add(`IFCCONNECTEDFACESET((#${face}))`)
    const surfaceModel = b.add(`IFCFACEBASEDSURFACEMODEL((#${faceSet}))`)
    const shapeRep = b.add(`IFCSHAPEREPRESENTATION(#${context},'Body','SurfaceModel',(#${surfaceModel}))`)
    const productShape = b.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`)

    const location = b.add(`IFCCARTESIANPOINT((${spec.locationCm.map(formatStepNumber).join(',')}))`)
    const placementAxis = b.add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`)
    const placement = b.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${placementAxis})`)
    const pipe = b.add(
      `IFCFLOWSEGMENT('${b.guid()}',#${ownerHistory},'${spec.name}',$,$,#${placement},#${productShape},$)`,
    )

    for (const [index, portCm] of (spec.portsCm ?? []).entries()) {
      const portPoint = b.add(`IFCCARTESIANPOINT((${portCm.map(formatStepNumber).join(',')}))`)
      const portAxis = b.add(`IFCAXIS2PLACEMENT3D(#${portPoint},$,$)`)
      const portPlacement = b.add(`IFCLOCALPLACEMENT(#${placement},#${portAxis})`)
      const port = b.add(
        `IFCDISTRIBUTIONPORT('${b.guid()}',#${ownerHistory},'Port ${index}',$,$,#${portPlacement},$,.SOURCEANDSINK.)`,
      )
      b.add(`IFCRELCONNECTSPORTTOELEMENT('${b.guid()}',#${ownerHistory},$,$,#${port},#${pipe})`)
    }

    if (spec.pset !== undefined) {
      const lengthProperty = b.add(
        `IFCPROPERTYSINGLEVALUE('Length',$,IFCPOSITIVELENGTHMEASURE(${formatStepNumber(spec.pset.lengthCm)}),$)`,
      )
      const invertProperty = b.add(
        `IFCPROPERTYSINGLEVALUE('InvertElevation',$,IFCLENGTHMEASURE(${formatStepNumber(spec.pset.invertElevationCm)}),$)`,
      )
      const pset = b.add(
        `IFCPROPERTYSET('${b.guid()}',#${ownerHistory},'Pset_FlowSegmentPipeSegment',$,(#${lengthProperty},#${invertProperty}))`,
      )
      b.add(`IFCRELDEFINESBYPROPERTIES('${b.guid()}',#${ownerHistory},$,$,(#${pipe}),#${pset})`)
    }

    pipesByStorey.set(spec.storey, [...(pipesByStorey.get(spec.storey) ?? []), pipe])
    pipesBySystem.set(spec.system, [...(pipesBySystem.get(spec.system) ?? []), pipe])
    return pipe
  }

  /**
   * A body-less IfcFlowFitting (Revit exports carry a mesh; only placement and
   * ports matter here) with ports at local points relative to its placement.
   */
  const addFitting = (spec: {
    name: string
    locationCm: [number, number, number]
    portsCm: Array<[number, number, number]>
    system: string
    storey: string
  }): number => {
    const location = b.add(`IFCCARTESIANPOINT((${spec.locationCm.map(formatStepNumber).join(',')}))`)
    const placementAxis = b.add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`)
    const placement = b.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${placementAxis})`)
    const fitting = b.add(`IFCFLOWFITTING('${b.guid()}',#${ownerHistory},'${spec.name}',$,$,#${placement},$,$)`)
    for (const [index, portCm] of spec.portsCm.entries()) {
      const portPoint = b.add(`IFCCARTESIANPOINT((${portCm.map(formatStepNumber).join(',')}))`)
      const portAxis = b.add(`IFCAXIS2PLACEMENT3D(#${portPoint},$,$)`)
      const portPlacement = b.add(`IFCLOCALPLACEMENT(#${placement},#${portAxis})`)
      const port = b.add(
        `IFCDISTRIBUTIONPORT('${b.guid()}',#${ownerHistory},'Port ${index}',$,$,#${portPlacement},$,.SOURCEANDSINK.)`,
      )
      b.add(`IFCRELCONNECTSPORTTOELEMENT('${b.guid()}',#${ownerHistory},$,$,#${port},#${fitting})`)
    }
    pipesByStorey.set(spec.storey, [...(pipesByStorey.get(spec.storey) ?? []), fitting])
    pipesBySystem.set(spec.system, [...(pipesBySystem.get(spec.system) ?? []), fitting])
    return fitting
  }

  if (options.withFittings) {
    // Elbow at the downstream end of Branch 1 (which ends at ≈ (350, 200, 15)):
    // body origin 5 cm past the pipe end, one port on the pipe end, one port
    // turning +y. A single-port cap elsewhere yields no connector.
    addFitting({
      name: 'XX-GRV Elbow',
      locationCm: [355, 200, 15],
      portsCm: [
        [-5, 0, 0],
        [0, 5, 0],
      ],
      system: 'XX-GRV 1',
      storey: 'Level A',
    })
    addFitting({
      name: 'XX-GRV Cap',
      locationCm: [800, 800, 15],
      portsCm: [[0, 0, -3]],
      system: 'XX-GRV 1',
      storey: 'Level A',
    })
    // A fitting of another system is ignored entirely.
    addFitting({
      name: 'XX-CW Elbow',
      locationCm: [50, 50, 300],
      portsCm: [
        [-5, 0, 0],
        [0, 5, 0],
      ],
      system: 'XX-CW 1',
      storey: 'Level A',
    })
  }

  if (options.withCutFaceStack) {
    // Disc centred at local (5.5, 5.5), radius 5.5 cm -> Ø110; cut at 200 cm
    // above Level A; ports 100 cm below and 250 cm above the cut.
    addSurfacePipe({
      name: 'XX-GRV Vertical Cut Face',
      locationCm: [300, 400, 200],
      facePointsCm: discPointsCm(5.5, 5.5, 5.5, 16),
      portsCm: [
        [5.5, 5.5, -100],
        [5.5, 5.5, 250],
      ],
      pset: { lengthCm: 350, invertElevationCm: 100 },
      system: 'XX-GRV 3',
      storey: 'Level A',
    })
  }
  if (options.withSurfaceBar) {
    addSurfacePipe({
      name: 'XX-GRV Surface Bar',
      locationCm: [1000, 1000, 50],
      facePointsCm: [
        [0, 0, 0],
        [300, 0, 0],
        [300, 11, 0],
        [0, 11, 0],
      ],
      system: 'XX-GRV 3',
      storey: 'Level A',
    })
  }
  if (options.withOrphanCutFace) {
    addSurfacePipe({
      name: 'XX-GRV Orphan Cut Face',
      locationCm: [700, 700, 200],
      facePointsCm: discPointsCm(5.5, 5.5, 5.5, 16),
      system: 'XX-GRV 3',
      storey: 'Level A',
    })
  }

  // Stack 1: vertical Ø110 runs on both storeys, XY within grouping tolerance.
  addPipe({
    name: 'XX-GRV Riser 1 Level A',
    locationCm: [100, 200, 0],
    depthCm: 300,
    radiusCm: 5.5,
    pset: { lengthCm: 300, invertElevationCm: 15 },
    system: 'XX-GRV 1',
    storey: 'Level A',
  })
  addPipe({
    name: 'XX-GRV Riser 1 Level B',
    locationCm: [110, 205, 300],
    depthCm: 320,
    radiusCm: 5.5,
    pset: { lengthCm: 320, invertElevationCm: 315 },
    system: 'XX-GRV 1',
    storey: 'Level B',
  })
  // Stack 2: one vertical Ø110 gravity run plus one vent nearby on Level A.
  addPipe({
    name: 'XX-GRV Riser 2 Level A',
    locationCm: [500, 200, 0],
    depthCm: 300,
    radiusCm: 5.5,
    pset: { lengthCm: 300, invertElevationCm: 20 },
    system: 'XX-GRV 2',
    storey: 'Level A',
  })
  addPipe({
    name: 'XX-VNT Riser 2 Level A',
    locationCm: [505, 195, 0],
    depthCm: 300,
    radiusCm: 5.5,
    pset: { lengthCm: 300, invertElevationCm: 20 },
    system: 'XX-VNT 1',
    storey: 'Level A',
  })
  // Sloped horizontal Ø50 branch (2% slope along X) on Level A.
  addPipe({
    name: 'XX-GRV Branch 1',
    locationCm: [100, 200, 10],
    axis: [1, 0, 0.02],
    depthCm: 250,
    radiusCm: 2.5,
    pset: { lengthCm: 250, invertElevationCm: 10 },
    system: 'XX-GRV 1',
    storey: 'Level A',
  })
  // Small vertical Ø50 without a pset: extraction keeps it, riser grouping must not.
  addPipe({
    name: 'XX-GRV Small Vertical',
    locationCm: [900, 900, 0],
    depthCm: 300,
    radiusCm: 2.5,
    system: 'XX-GRV 2',
    storey: 'Level A',
  })
  // Different system: excluded by the prefix filter entirely.
  addPipe({
    name: 'XX-CW Supply',
    locationCm: [50, 50, 0],
    depthCm: 300,
    radiusCm: 2.5,
    pset: { lengthCm: 300, invertElevationCm: 0 },
    system: 'XX-CW 1',
    storey: 'Level A',
  })

  for (const [storeyName, pipeIds] of pipesByStorey) {
    b.add(
      `IFCRELCONTAINEDINSPATIALSTRUCTURE('${b.guid()}',#${ownerHistory},$,$,(${pipeIds.map((id) => `#${id}`).join(',')}),#${storeyIds.get(storeyName)})`,
    )
  }
  for (const [systemName, pipeIds] of pipesBySystem) {
    const system = b.add(`IFCSYSTEM('${b.guid()}',#${ownerHistory},'${systemName}',$,$)`)
    b.add(
      `IFCRELASSIGNSTOGROUP('${b.guid()}',#${ownerHistory},$,$,(${pipeIds.map((id) => `#${id}`).join(',')}),$,#${system})`,
    )
  }

  return { text: b.build() }
}

async function openModel(text: string): Promise<{ api: IfcAPI; modelId: number }> {
  const { IfcAPI } = await import('web-ifc')
  const api = new IfcAPI()
  await api.Init()
  const modelId = api.OpenModel(new TextEncoder().encode(text))
  return { api, modelId }
}

const CM_PER_M = 100

describe('extractEngineerPipeNetwork on a synthetic centimetre model (real web-ifc engine)', () => {
  it('extracts filtered segments with endpoints, diameters, psets, storeys, and systems', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc().text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, {
        systemPrefixes: ['XX-GRV'],
      })

      expect(networkResult.metersPerSourceUnit).toBe(0.01)
      expect(networkResult.storeys.map((storey) => storey.name)).toEqual(['Level A', 'Level B'])

      // 5 XX-GRV pipes; the XX-VNT and XX-CW pipes are excluded by the prefix.
      expect(networkResult.segments).toHaveLength(5)
      const byName = new Map(networkResult.segments.map((segment) => [segment.name, segment]))

      const riser1A = byName.get('XX-GRV Riser 1 Level A')!
      expect(riser1A.systemName).toBe('XX-GRV 1')
      expect(riser1A.storeyName).toBe('Level A')
      expect(riser1A.endpointSource).toBe('extrusion-axis')
      expect(riser1A.start).not.toBeNull()
      expect(riser1A.end).not.toBeNull()
      // Endpoints in SOURCE coordinates (cm).
      expect(riser1A.start!.x).toBeCloseTo(100, 6)
      expect(riser1A.start!.y).toBeCloseTo(200, 6)
      expect(riser1A.start!.z).toBeCloseTo(0, 6)
      expect(riser1A.end!.x).toBeCloseTo(100, 6)
      expect(riser1A.end!.y).toBeCloseTo(200, 6)
      expect(riser1A.end!.z).toBeCloseTo(300, 6)
      // Radius 5.5 cm -> outer diameter 110 mm; pset values converted to metres.
      expect(riser1A.outerDiameterMm).toBeCloseTo(110, 9)
      expect(riser1A.lengthM).toBeCloseTo(3, 9)
      expect(riser1A.invertElevationM).toBeCloseTo(0.15, 9)

      const riser1B = byName.get('XX-GRV Riser 1 Level B')!
      expect(riser1B.storeyName).toBe('Level B')
      expect(riser1B.start!.z).toBeCloseTo(300, 6)
      expect(riser1B.end!.z).toBeCloseTo(620, 6)
      expect(riser1B.invertElevationM).toBeCloseTo(3.15, 9)

      // Sloped branch: axis (1, 0, 0.02) normalised, depth 250 cm.
      const branch = byName.get('XX-GRV Branch 1')!
      const axisNorm = Math.sqrt(1 + 0.02 * 0.02)
      expect(branch.outerDiameterMm).toBeCloseTo(50, 9)
      expect(branch.start!.x).toBeCloseTo(100, 6)
      expect(branch.start!.z).toBeCloseTo(10, 6)
      expect(branch.end!.x).toBeCloseTo(100 + (1 / axisNorm) * 250, 6)
      expect(branch.end!.y).toBeCloseTo(200, 6)
      expect(branch.end!.z).toBeCloseTo(10 + (0.02 / axisNorm) * 250, 6)

      // Pset-less pipe surfaces nulls, never fabricated values.
      const psetless = byName.get('XX-GRV Small Vertical')!
      expect(psetless.lengthM).toBeNull()
      expect(psetless.invertElevationM).toBeNull()
      expect(psetless.outerDiameterMm).toBeCloseTo(50, 9)

      // Segments sorted by expressId ascending (determinism).
      const expressIds = networkResult.segments.map((segment) => segment.expressId)
      expect(expressIds).toEqual([...expressIds].sort((a, b) => a - b))
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('classifies vertical Ø110 runs into 2 sanitary stacks and 1 separate vent stack', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc().text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, {
        systemPrefixes: ['XX-GRV', 'XX-VNT'],
      })
      expect(networkResult.segments).toHaveLength(6)

      const classification = classifyEngineerRiserStacks(networkResult, {
        sanitarySystemPrefixes: ['XX-GRV'],
        ventSystemPrefixes: ['XX-VNT'],
      })
      // Two storeys 3 m apart -> the stack extent threshold is the 3 m pitch.
      expect(classification.minStackExtentM).toBeCloseTo(3, 9)
      expect(classification.minStackExtentSource).toBe('storey-pitch-median')

      const stacks = classification.sanitaryStacks
      expect(stacks).toHaveLength(2)
      expect(stacks.map((stack) => stack.id)).toEqual(['engineer-riser-1', 'engineer-riser-2'])

      // Stack 1 near x = 1.05 m spans both storeys: z 0..6.2 m.
      expect(stacks[0].xM).toBeCloseTo((100 + 110) / 2 / CM_PER_M, 6)
      expect(stacks[0].storeys.map((storey) => storey.name)).toEqual(['Level A', 'Level B'])
      expect(stacks[0].zMinM).toBeCloseTo(0, 6)
      expect(stacks[0].zMaxM).toBeCloseTo(6.2, 6)
      expect(stacks[0].spannedStoreyIds).toHaveLength(2)
      expect(stacks[0].diameterMm).toBeCloseTo(110, 9)

      // Stack 2 near x = 5 m: the gravity run alone (exactly one storey tall).
      expect(stacks[1].xM).toBeCloseTo(500 / CM_PER_M, 6)
      expect(stacks[1].storeys.map((storey) => storey.name)).toEqual(['Level A'])
      expect(stacks[1].segmentExpressIds).toHaveLength(1)
      expect(stacks[1].extentM).toBeCloseTo(3, 6)

      // The nearby vent is a vent stack of its own, never merged into stack 2.
      expect(classification.ventStacks).toHaveLength(1)
      expect(classification.ventStacks[0].id).toBe('engineer-vent-1')
      expect(classification.ventStacks[0].xM).toBeCloseTo(505 / CM_PER_M, 6)
      expect(classification.stubs).toHaveLength(0)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('is deterministic: two extractions produce identical output', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc().text)
    try {
      const options = { systemPrefixes: ['XX-GRV', 'XX-VNT'] }
      const first = await extractEngineerPipeNetwork(api, modelId, options)
      const second = await extractEngineerPipeNetwork(api, modelId, options)
      expect(second).toEqual(first)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('throws an explicit error when the model has no SI length unit', async () => {
    const { api, modelId } = await openModel(
      buildSyntheticPlumbingIfc({ includeLengthUnit: false }).text,
    )
    try {
      await expect(resolveMetersPerSourceUnit(api, modelId)).rejects.toThrow(/length unit/i)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('reports a geometry summary: every extrusion pipe counted, nothing unresolved', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc().text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV'] })
      expect(networkResult.geometrySummary).toEqual({
        endpointSourceCounts: { 'extrusion-axis': 5, 'distribution-ports': 0, 'mesh-bounds': 0, unresolved: 0 },
        unresolvedSegments: [],
      })
    } finally {
      api.CloseModel(modelId)
    }
  })
})

describe('resolveMetersPerSourceUnit: project unit assignment first', () => {
  it('ignores SI length units that only serve derived units when the assignment declares centimetres', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc({ derivedUnitLengthUnits: true }).text)
    try {
      // Three distinct LENGTHUNIT factors exist in the file (cm, dm, m) …
      const { IFCSIUNIT } = await import('web-ifc')
      const lengthUnitPrefixes = new Set<string>()
      const ids = api.GetLineIDsWithType(modelId, IFCSIUNIT)
      for (let i = 0; i < ids.size(); i++) {
        const line = api.GetLine(modelId, ids.get(i), false) as { UnitType?: { value?: string }; Prefix?: { value?: string } | null }
        if (line.UnitType?.value === 'LENGTHUNIT') lengthUnitPrefixes.add(line.Prefix?.value ?? 'none')
      }
      expect(lengthUnitPrefixes).toEqual(new Set(['CENTI', 'DECI', 'none']))

      // … but the project assignment names exactly one, and that one wins.
      await expect(resolveMetersPerSourceUnit(api, modelId)).resolves.toBe(0.01)
      const networkResult = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV'] })
      expect(networkResult.metersPerSourceUnit).toBe(0.01)
      expect(networkResult.segments).toHaveLength(5)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('falls back to the single stray SI length unit when the assignment has none', async () => {
    const { api, modelId } = await openModel(
      buildSyntheticPlumbingIfc({ includeLengthUnit: false, strayLengthUnitPrefixes: ['MILLI'] }).text,
    )
    try {
      await expect(resolveMetersPerSourceUnit(api, modelId)).resolves.toBe(0.001)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('throws "ambiguous" only when the assignment has no length unit AND the scan finds several', async () => {
    const { api, modelId } = await openModel(
      buildSyntheticPlumbingIfc({ includeLengthUnit: false, strayLengthUnitPrefixes: ['MILLI', 'CENTI'] }).text,
    )
    try {
      await expect(resolveMetersPerSourceUnit(api, modelId)).rejects.toThrow(/ambiguous length unit/i)
    } finally {
      api.CloseModel(modelId)
    }
  })
})

describe('extractEngineerPipeNetwork: fitting connectors (R3)', () => {
  it('turns a two-port IfcFlowFitting into origin → port connectors with the neighbouring pipe diameter; caps and foreign systems yield none', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc({ withFittings: true }).text)
    try {
      const network = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV'] })
      const pipeOnly = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV'] })
      // Pipe extraction is untouched by fittings (same segments, no fitting among them).
      expect(pipeOnly.segments).toEqual(network.segments)
      expect(network.segments.every((segment) => segment.elementKind === undefined)).toBe(true)

      expect(network.fittingSummary.fittings).toBe(2)
      expect(network.fittingSummary.connectors).toBe(2)
      expect(network.fittingSummary.byPortCount).toEqual({ '1': 1, '2': 1 })
      expect(network.fittingSummary.originReplacedByPortCentroid).toBe(0)
      expect(network.fittingSummary.skipped).toHaveLength(1)
      expect(network.fittingSummary.skipped[0].reason).toBe('single port')

      const elbow = network.fittingConnectors
      expect(elbow).toHaveLength(2)
      const fittingId = elbow[0].fittingExpressId!
      expect(elbow.map((c) => c.expressId)).toEqual(
        [fittingConnectorExpressId(fittingId, 0), fittingConnectorExpressId(fittingId, 1)].sort((a, b) => a - b),
      )
      for (const connector of elbow) {
        expect(connector.elementKind).toBe('fitting')
        expect(connector.systemName).toBe('XX-GRV 1')
        expect(connector.storeyName).toBe('Level A')
        expect(connector.endpointSource).toBe('distribution-ports')
        expect(connector.lengthM).toBeNull()
        // start = body origin (355, 200, 15) in cm
        expect(connector.start!.x).toBeCloseTo(355, 3)
        expect(connector.start!.y).toBeCloseTo(200, 3)
        expect(connector.start!.z).toBeCloseTo(15, 3)
      }
      const ports = elbow.map((c) => [c.end!.x, c.end!.y, c.end!.z].map((v) => Math.round(v * 1000) / 1000)).sort()
      expect(ports).toEqual([
        [350, 200, 15],
        [355, 205, 15],
      ])
      // Ø50 borrowed from Branch 1, whose downstream end sits on the first port; the free port has no neighbour.
      const byPort = new Map(elbow.map((c) => [Math.round(c.end!.y), c.outerDiameterMm]))
      expect(byPort.get(200)).toBe(50)
      expect(byPort.get(205)).toBeNull()
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('reports an empty fitting census on a model without fittings', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc().text)
    try {
      const network = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV'] })
      expect(network.fittingConnectors).toEqual([])
      expect(network.fittingSummary).toEqual({ fittings: 0, connectors: 0, byPortCount: {}, originReplacedByPortCentroid: 0, skipped: [] })
    } finally {
      api.CloseModel(modelId)
    }
  })
})

describe('extractEngineerPipeNetwork: surface-model pipes (no extrusion solid)', () => {
  it('derives a vertical cut-face pipe from its two IfcDistributionPorts, diameter from the face', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc({ withCutFaceStack: true }).text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV 3'] })
      expect(networkResult.segments).toHaveLength(1)
      const [stack] = networkResult.segments
      expect(stack.endpointSource).toBe('distribution-ports')
      // Ports at local z -100 / +250 relative to the placement at (300, 400, 200) cm.
      expect(stack.start!.x).toBeCloseTo(305.5, 6)
      expect(stack.start!.y).toBeCloseTo(405.5, 6)
      expect(stack.start!.z).toBeCloseTo(100, 6)
      expect(stack.end!.x).toBeCloseTo(305.5, 6)
      expect(stack.end!.y).toBeCloseTo(405.5, 6)
      expect(stack.end!.z).toBeCloseTo(450, 6)
      // Ø110 from the 16-gon cut face (exact: opposite vertices span the diameter).
      expect(stack.outerDiameterMm).toBe(110)
      expect(stack.lengthM).toBeCloseTo(3.5, 9)
      expect(stack.invertElevationM).toBeCloseTo(1, 9)
      expect(networkResult.geometrySummary.endpointSourceCounts).toEqual({
        'extrusion-axis': 0,
        'distribution-ports': 1,
        'mesh-bounds': 0,
        unresolved: 0,
      })

      // The 3.5 m vertical Ø110 run is a sanitary stack (storey pitch 3 m).
      const classification = classifyEngineerRiserStacks(networkResult, {
        sanitarySystemPrefixes: ['XX-GRV'],
        ventSystemPrefixes: ['XX-VNT'],
      })
      expect(classification.sanitaryStacks).toHaveLength(1)
      expect(classification.sanitaryStacks[0].xM).toBeCloseTo(3.055, 6)
      expect(classification.sanitaryStacks[0].yM).toBeCloseTo(4.055, 6)
      expect(classification.sanitaryStacks[0].zMinM).toBeCloseTo(1, 6)
      expect(classification.sanitaryStacks[0].zMaxM).toBeCloseTo(4.5, 6)
      expect(classification.sanitaryStacks[0].diameterMm).toBe(110)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('returns mesh-bounds centrelines in SOURCE coordinates (cm, Z-up), not the viewer frame', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc({ withSurfaceBar: true }).text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV 3'] })
      expect(networkResult.segments).toHaveLength(1)
      const [bar] = networkResult.segments
      expect(bar.endpointSource).toBe('mesh-bounds')
      expect(bar.outerDiameterMm).toBeNull()
      // 300 × 11 cm face at (1000, 1000, 50): centreline along X through the face centre.
      // Tolerance 0.01 cm: web-ifc vertices are float32 in metres.
      expect(bar.start!.x).toBeCloseTo(1000, 2)
      expect(bar.start!.y).toBeCloseTo(1005.5, 2)
      expect(bar.start!.z).toBeCloseTo(50, 2)
      expect(bar.end!.x).toBeCloseTo(1300, 2)
      expect(bar.end!.y).toBeCloseTo(1005.5, 2)
      expect(bar.end!.z).toBeCloseTo(50, 2)
      expect(networkResult.geometrySummary.endpointSourceCounts['mesh-bounds']).toBe(1)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('leaves a port-less cut face unresolved with a reason instead of a zero-length segment', async () => {
    const { api, modelId } = await openModel(buildSyntheticPlumbingIfc({ withOrphanCutFace: true }).text)
    try {
      const networkResult = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['XX-GRV 3'] })
      expect(networkResult.segments).toHaveLength(1)
      const [orphan] = networkResult.segments
      expect(orphan.start).toBeNull()
      expect(orphan.end).toBeNull()
      expect(orphan.endpointSource).toBeNull()
      expect(orphan.outerDiameterMm).toBeNull()
      expect(networkResult.geometrySummary.endpointSourceCounts.unresolved).toBe(1)
      expect(networkResult.geometrySummary.unresolvedSegments).toEqual([
        {
          expressId: orphan.expressId,
          reason: expect.stringMatching(/no extrusion solid; no ports; degenerate mesh/),
        },
      ])
      // Still counted as a segment; never a riser candidate.
      const classification = classifyEngineerRiserStacks(networkResult, {
        sanitarySystemPrefixes: ['XX-GRV'],
        ventSystemPrefixes: ['XX-VNT'],
      })
      expect(classification.sanitaryStacks).toHaveLength(0)
      expect(classification.stubs).toHaveLength(0)
    } finally {
      api.CloseModel(modelId)
    }
  })
})

describe('filterOriginArtifacts', () => {
  it('drops stray world-origin points when geometry sits far from the origin', () => {
    const farPoints = [
      { x: 18144051, y: 66462427, z: 3015 },
      { x: 18144151, y: 66462427, z: 3015 },
    ]
    const filtered = filterOriginArtifacts([...farPoints, { x: 0, y: 0, z: 0 }])
    expect(filtered).toEqual(farPoints)
  })

  it('keeps near-origin points that are above the relative threshold', () => {
    const nearOrigin = { x: 0.001, y: 0, z: 0 }
    // Threshold is 1e-6 x maxNorm = 1e-4 here, so 1e-3 survives.
    const filtered = filterOriginArtifacts([nearOrigin, { x: 100, y: 0, z: 0 }])
    expect(filtered).toContainEqual(nearOrigin)
    expect(filtered).toHaveLength(2)
  })

  it('returns the input unchanged when every point is at the origin', () => {
    const points = [{ x: 0, y: 0, z: 0 }]
    expect(filterOriginArtifacts(points)).toEqual(points)
  })
})
