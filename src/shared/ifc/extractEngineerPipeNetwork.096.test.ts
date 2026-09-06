import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { extractEngineerPipeNetwork, type ExtractedEngineerPipeNetwork } from './extractEngineerPipeNetwork'
import {
  classifyEngineerRiserStacks,
  isVerticalEngineerSegment,
  stacksIntersectingBand,
  storeySlabBandM,
  type EngineerRiserClassification,
  type EngineerRiserStack,
} from '@/domain/engineerPipes'

/**
 * Gated integration test against the real engineer plumbing model
 * external/projects/096/096-P.ifc (gitignored client data — never committed).
 * Skips cleanly when the file is absent. The model is 17 MB and parses in
 * tens of seconds, hence the long hook timeout.
 */

const IFC_096_P_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../external/projects/096/096-P.ifc',
)
const has096 = fs.existsSync(IFC_096_P_PATH)

const PARSE_TIMEOUT_MS = 300_000
const EXPECTED_STOREY_01_SW_GRV_SEGMENTS = 129
const EXPECTED_DIAMETERS_MM = new Set([50, 63, 110, 160])

// Honest engineer-riser definition (V1) on this model. Before V1 the mixed
// SW-GRV+VNT XY grouping reported 50 "engineer risers" model-wide (and the
// storey-01 comparison used all 50). With sanitary/vent split, Z-chaining, the
// storey-pitch extent threshold (median pitch 3.2 m here) and slab-band
// intersection, storey 01 sees the numbers below.
const EXPECTED_MODEL_WIDE = { sanitaryStacks: 25, ventStacks: 17, stubs: 13 }
const EXPECTED_STOREY_01 = { sanitaryStacks: 15, ventStacks: 1 }
const EXPECTED_SANITARY_STACK_DIAMETERS_MM = new Set([110, 160, 200])

describe.skipIf(!has096)('extractEngineerPipeNetwork on 096-P.ifc (gated)', () => {
  let api: IfcAPI
  let modelId: number
  let network: ExtractedEngineerPipeNetwork
  let classification: EngineerRiserClassification
  let stacks: EngineerRiserStack[]

  beforeAll(async () => {
    const { IfcAPI } = await import('web-ifc')
    api = new IfcAPI()
    await api.Init()
    modelId = api.OpenModel(fs.readFileSync(IFC_096_P_PATH))
    // One extraction serves both the SW-GRV assertions and riser grouping.
    network = await extractEngineerPipeNetwork(api, modelId, {
      systemPrefixes: ['SW-GRV', 'VNT'],
    })
    classification = classifyEngineerRiserStacks(network)
    stacks = classification.sanitaryStacks
  }, PARSE_TIMEOUT_MS)

  afterAll(() => {
    if (api !== undefined && modelId !== undefined) api.CloseModel(modelId)
  })

  it('resolves the centimetre length unit and the 44 storeys', () => {
    expect(network.metersPerSourceUnit).toBe(0.01)
    expect(network.storeys).toHaveLength(44)
    expect(network.storeys.some((storey) => storey.name === '01')).toBe(true)
  })

  it(
    `finds exactly ${EXPECTED_STOREY_01_SW_GRV_SEGMENTS} SW-GRV segments on storey "01"`,
    { timeout: 60_000 },
    () => {
      const storey01SwGrv = network.segments.filter(
        (segment) =>
          segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
      )
      expect(storey01SwGrv).toHaveLength(EXPECTED_STOREY_01_SW_GRV_SEGMENTS)
    },
  )

  it('extracts only diameters from {50, 63, 110, 160} mm on storey "01" SW-GRV', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const roundedDiameters = new Set(
      storey01SwGrv.map((segment) =>
        segment.outerDiameterMm === null ? null : Math.round(segment.outerDiameterMm * 100) / 100,
      ),
    )
    // Log the observed set for the task report.
    console.info('[096 gated] storey-01 SW-GRV diameters (mm):', [...roundedDiameters].sort())
    for (const diameter of roundedDiameters) {
      expect(diameter).not.toBeNull()
      expect(EXPECTED_DIAMETERS_MM.has(diameter!)).toBe(true)
    }
  })

  it('extracts a non-null InvertElevation for every storey "01" SW-GRV segment', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const nullInverts = storey01SwGrv.filter((segment) => segment.invertElevationM === null)
    expect(nullInverts).toHaveLength(0)
  })

  it('derives the 3.2 m storey pitch as the stack extent threshold', () => {
    expect(classification.minStackExtentSource).toBe('storey-pitch-median')
    expect(classification.storeyPitchM).toBeCloseTo(3.2, 6)
    expect(classification.minStackExtentM).toBeCloseTo(3.2, 6)
  })

  it('classifies the vertical runs into sanitary stacks, vent stacks, and stubs (model-wide)', () => {
    const vertical = network.segments.filter((segment) => isVerticalEngineerSegment(segment))
    const verticalByClass = { sanitary: 0, vent: 0 }
    const verticalByStorey = new Map<string | null, number>()
    for (const segment of vertical) {
      if ((segment.systemName ?? '').startsWith('VNT')) verticalByClass.vent += 1
      else verticalByClass.sanitary += 1
      verticalByStorey.set(segment.storeyName, (verticalByStorey.get(segment.storeyName) ?? 0) + 1)
    }
    console.info(
      `[096 gated] vertical segments: ${vertical.length} (${JSON.stringify(verticalByClass)}), by containment storey: ${JSON.stringify(Object.fromEntries(verticalByStorey))}`,
    )
    console.info(
      `[096 gated] model-wide: sanitary stacks ${classification.sanitaryStacks.length}, vent stacks ${classification.ventStacks.length}, stubs ${classification.stubs.length} (${classification.stubs.filter((stub) => stub.systemClass === 'sanitary').length} sanitary / ${classification.stubs.filter((stub) => stub.systemClass === 'vent').length} vent)`,
    )

    expect(classification.sanitaryStacks).toHaveLength(EXPECTED_MODEL_WIDE.sanitaryStacks)
    expect(classification.ventStacks).toHaveLength(EXPECTED_MODEL_WIDE.ventStacks)
    expect(classification.stubs).toHaveLength(EXPECTED_MODEL_WIDE.stubs)

    // Every stack meets the threshold; every stub falls short of it.
    for (const stack of [...classification.sanitaryStacks, ...classification.ventStacks]) {
      expect(stack.extentM).toBeGreaterThanOrEqual(classification.minStackExtentM - 0.01)
    }
    for (const stub of classification.stubs) {
      expect(stub.extentM).toBeLessThan(classification.minStackExtentM - 0.01)
    }

    // The tower's full-height runs are drawn on one storey but span dozens geometrically.
    const maxSpan = Math.max(...stacks.map((stack) => stack.spannedStoreyIds.length))
    const maxContainment = Math.max(...stacks.map((stack) => stack.storeys.length))
    console.info(`[096 gated] max storey span: geometric ${maxSpan}, by containment ${maxContainment}`)
    expect(maxSpan).toBeGreaterThanOrEqual(30)
  })

  it('surviving sanitary stacks are Ø110 / Ø160 / Ø200', () => {
    const diameters = new Set(stacks.map((stack) => Math.round(stack.diameterMm)))
    console.info('[096 gated] sanitary stack diameters (mm):', [...diameters].sort((a, b) => a - b))
    for (const diameter of diameters) {
      expect(EXPECTED_SANITARY_STACK_DIAMETERS_MM.has(diameter)).toBe(true)
    }
  })

  it(`storey "01" intersects ${EXPECTED_STOREY_01.sanitaryStacks} sanitary stacks (far below the former 50) and ${EXPECTED_STOREY_01.ventStacks} vent stack`, () => {
    const storey01 = network.storeys.find((storey) => storey.name === '01')!
    const band = storeySlabBandM(network, storey01.id)!
    expect(band.bottomM).toBeCloseTo(30.15, 6)
    expect(band.topM).toBeCloseTo(33.35, 6)

    const intersecting = stacksIntersectingBand(stacks, band)
    const ventIntersecting = stacksIntersectingBand(classification.ventStacks, band)
    console.info(
      `[096 gated] storey 01 band [${band.bottomM.toFixed(2)}, ${band.topM.toFixed(2)}) m: sanitary stacks intersecting ${intersecting.length} of ${stacks.length}, vent stacks intersecting ${ventIntersecting.length} of ${classification.ventStacks.length}`,
    )
    for (const stack of intersecting) {
      console.info(
        `[096 gated]   ${stack.id} xy=(${stack.xM.toFixed(2)}, ${stack.yM.toFixed(2)}) m z=[${stack.zMinM.toFixed(2)}, ${stack.zMaxM.toFixed(2)}] extent ${stack.extentM.toFixed(2)} m Ø${Math.round(stack.diameterMm)} spans ${stack.spannedStoreyIds.length} storeys`,
      )
    }

    expect(intersecting.length).toBeLessThan(30)
    expect(intersecting).toHaveLength(EXPECTED_STOREY_01.sanitaryStacks)
    expect(ventIntersecting).toHaveLength(EXPECTED_STOREY_01.ventStacks)
    // Ordering is deterministic: by xM, then yM, then zMinM.
    for (let i = 1; i < intersecting.length; i++) {
      const previous = intersecting[i - 1]
      const current = intersecting[i]
      expect(
        previous.xM < current.xM ||
          (previous.xM === current.xM &&
            (previous.yM < current.yM || (previous.yM === current.yM && previous.zMinM <= current.zMinM))),
      ).toBe(true)
    }
  })

  it('derives every storey "01" SW-GRV centreline from the extrusion axis', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const bySource = new Map<string | null, number>()
    for (const segment of storey01SwGrv) {
      bySource.set(segment.endpointSource, (bySource.get(segment.endpointSource) ?? 0) + 1)
    }
    console.info('[096 gated] storey-01 SW-GRV endpoint sources:', Object.fromEntries(bySource))
    expect(storey01SwGrv.every((segment) => segment.start !== null && segment.end !== null)).toBe(
      true,
    )
    expect(bySource.get('extrusion-axis')).toBe(EXPECTED_STOREY_01_SW_GRV_SEGMENTS)
  })

  it('reports a geometry summary consistent with the segments (V1b)', () => {
    const { endpointSourceCounts, unresolvedSegments } = network.geometrySummary
    console.info(
      `[096 gated] model-wide endpoint sources: ${JSON.stringify(endpointSourceCounts)}, unresolved: ${JSON.stringify(unresolvedSegments)}`,
    )
    const total = Object.values(endpointSourceCounts).reduce((sum, count) => sum + count, 0)
    expect(total).toBe(network.segments.length)
    // Every SW-GRV / VNT pipe of this model is a swept solid.
    expect(endpointSourceCounts).toEqual({
      'extrusion-axis': network.segments.length,
      'distribution-ports': 0,
      'mesh-bounds': 0,
      unresolved: 0,
    })
    expect(endpointSourceCounts.unresolved).toBe(unresolvedSegments.length)
    expect(unresolvedSegments.map((entry) => entry.expressId)).toEqual(
      network.segments.filter((segment) => segment.start === null).map((segment) => segment.expressId),
    )
    // No segment of this model degenerates to a zero-length centreline.
    for (const segment of network.segments) {
      if (segment.start === null || segment.end === null) continue
      expect(
        segment.start.x === segment.end.x && segment.start.y === segment.end.y && segment.start.z === segment.end.z,
        `segment #${segment.expressId} zero length`,
      ).toBe(false)
    }
  })
})
