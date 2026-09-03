import { describe, expect, it } from 'vitest'
import {
  extractEngineerPipeNetwork,
  filterOriginArtifacts,
  resolveMetersPerSourceUnit,
} from './extractEngineerPipeNetwork'
import { classifyEngineerRiserStacks } from '@/domain/engineerPipes'
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

function buildSyntheticPlumbingIfc(options: { includeLengthUnit?: boolean } = {}): SyntheticModel {
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
