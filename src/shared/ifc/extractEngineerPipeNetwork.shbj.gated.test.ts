import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractEngineerPipeNetwork, resolveMetersPerSourceUnit } from './extractEngineerPipeNetwork'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'
import { extractFloorMeshes } from './extractFloorMeshes'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import { ifcSourceToViewerPoint } from '@/shared/frame/ifcSourceFrame'
import {
  classifyEngineerRiserStacks,
  isVerticalEngineerSegment,
  stacksIntersectingBand,
  storeySlabBandM,
  type EngineerPipeSegment,
} from '@/domain/engineerPipes'

/**
 * Gated engineer-network extraction + riser classification against the
 * sanitary model of the second real project (client data, gitignored; skips
 * cleanly when absent). IFC2X3, centimetre, Revit, MEP modelled on storey L04.
 *
 * Facts pinned here (measured 2026-09-03):
 * - The project unit assignment declares ONE length unit (centimetre); two
 *   further IfcSIUnit LENGTHUNIT lines (decimetre, metre) exist only as
 *   elements of derived units and must not make the unit ambiguous.
 * - 124 IfcFlowSegments live in the L04 storey tree; 87 belong to SW-GRV/VNT.
 * - 49 of the 87 are swept solids (extrusion axis, IfcCircleProfileDef
 *   diameters); 38 are Revit "vertical" pipes exported as a single cut face
 *   (IfcFaceBasedSurfaceModel) with full-length IfcDistributionPorts — 32
 *   have two ports (centreline from ports, diameter from the face), 5 have a
 *   single exported port and 1 has coincident ports (left unresolved with a
 *   reason, never a zero-length segment at the origin).
 */
const SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')
const STOREY_NAME = 'L04'
const STOREY_ELEVATION_CM = 1800
const TEST_TIMEOUT_MS = 180_000

const EXPECTED_STOREY_TREE_FLOW_SEGMENTS = 124
const EXPECTED_SEGMENTS = { total: 87, swGrv: 82, vnt: 5 }
const EXPECTED_ENDPOINT_SOURCES = { 'extrusion-axis': 49, 'distribution-ports': 32, 'mesh-bounds': 0, unresolved: 6 }
const EXPECTED_EXTRUSION_DIAMETERS_MM = { 50: 17, 110: 25, 160: 7 }
const EXPECTED_PORT_DIAMETERS_MM = { 50: 3, 110: 23, 160: 6 }
const EXPECTED_UNRESOLVED_REASONS = { 'single port': 5, 'coincident ports': 1 }
// Storey footprint measured by V2 (≈ 66 × 53 m), pinned with headroom.
const FOOTPRINT_WIDTH_M: [number, number] = [55, 80]
const FOOTPRINT_DEPTH_M: [number, number] = [45, 65]
const FOOTPRINT_MARGIN_M = 2
// Honest riser classification on the vertical (port-derived) runs: the
// "one-floor slice" carries the building's vertical stacks as full-height
// Revit vertical pipes, so stacks DO exist here (storey pitch median 4 m).
const EXPECTED_CLASSIFICATION = { sanitaryStacks: 9, ventStacks: 2, stubs: 15 }

describe.skipIf(!existsSync(SA_PATH))('engineer network extraction on shbj-SA (gated: requires local client file)', () => {
  it(
    `storey ${STOREY_NAME}: unit from the project assignment, 87 SW-GRV/VNT segments with resolved geometry inside the footprint`,
    async () => {
      const { IfcAPI, IFCFLOWSEGMENT, IFCPIPESEGMENT } = await import('web-ifc')
      const api = new IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(SA_PATH))
      try {
        // --- Problem 1: unit resolution follows the project assignment ---
        expect(await resolveModelLengthUnit(api, modelId)).toBe('cm')
        expect(await resolveMetersPerSourceUnit(api, modelId)).toBe(0.01)

        const network = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: ['SW-GRV', 'VNT'] })
        expect(network.metersPerSourceUnit).toBe(0.01)

        const storey = network.storeys.find((candidate) => candidate.name === STOREY_NAME)
        expect(storey, `storey ${STOREY_NAME}`).toBeDefined()
        expect(storey!.elevationSource).toBeCloseTo(STOREY_ELEVATION_CM, 6)

        // --- population: every SW-GRV / VNT segment lives on the MEP storey ---
        const { elementIds } = await collectSpatialTreeElements(api, modelId, storey!.id)
        let storeyTreeFlowSegments = 0
        for (const typeConstant of [IFCFLOWSEGMENT, IFCPIPESEGMENT]) {
          const ids = api.GetLineIDsWithType(modelId, typeConstant)
          for (let i = 0; i < ids.size(); i++) if (elementIds.has(ids.get(i))) storeyTreeFlowSegments += 1
        }
        expect(storeyTreeFlowSegments).toBe(EXPECTED_STOREY_TREE_FLOW_SEGMENTS)

        expect(network.segments).toHaveLength(EXPECTED_SEGMENTS.total)
        expect(network.segments.filter((segment) => segment.storeyId === storey!.id)).toHaveLength(EXPECTED_SEGMENTS.total)
        expect(network.segments.filter((segment) => isSwGrv(segment))).toHaveLength(EXPECTED_SEGMENTS.swGrv)
        expect(network.segments.filter((segment) => isVnt(segment))).toHaveLength(EXPECTED_SEGMENTS.vnt)

        // --- Problem 2: endpoint sources and the geometry summary ---
        expect(network.geometrySummary.endpointSourceCounts).toEqual(EXPECTED_ENDPOINT_SOURCES)
        expect(countBy(network.segments.map((segment) => segment.endpointSource ?? 'unresolved'))).toEqual({
          'extrusion-axis': EXPECTED_ENDPOINT_SOURCES['extrusion-axis'],
          'distribution-ports': EXPECTED_ENDPOINT_SOURCES['distribution-ports'],
          unresolved: EXPECTED_ENDPOINT_SOURCES.unresolved,
        })
        expect(network.geometrySummary.unresolvedSegments).toHaveLength(EXPECTED_ENDPOINT_SOURCES.unresolved)
        expect(network.geometrySummary.unresolvedSegments.length).toBeLessThanOrEqual(38)
        expect(
          countBy(
            network.geometrySummary.unresolvedSegments.map((entry) =>
              entry.reason.includes('single port') ? 'single port' : entry.reason.includes('coincident ports') ? 'coincident ports' : entry.reason,
            ),
          ),
        ).toEqual(EXPECTED_UNRESOLVED_REASONS)
        for (const entry of network.geometrySummary.unresolvedSegments) {
          const segment = network.segments.find((candidate) => candidate.expressId === entry.expressId)!
          expect(segment.start).toBeNull()
          expect(segment.end).toBeNull()
          expect(segment.endpointSource).toBeNull()
          expect(entry.reason).toMatch(/degenerate mesh/)
        }

        const extrusion = network.segments.filter((segment) => segment.endpointSource === 'extrusion-axis')
        const fromPorts = network.segments.filter((segment) => segment.endpointSource === 'distribution-ports')
        expect(countBy(extrusion.map((segment) => roundedDiameterKey(segment)))).toEqual(EXPECTED_EXTRUSION_DIAMETERS_MM)
        expect(countBy(fromPorts.map((segment) => roundedDiameterKey(segment)))).toEqual(EXPECTED_PORT_DIAMETERS_MM)
        // Vents are exclusively vertical (port-derived) pipes here.
        expect(fromPorts.filter((segment) => isVnt(segment))).toHaveLength(EXPECTED_SEGMENTS.vnt)

        // Pset_FlowSegmentPipeSegment.InvertElevation is present on every swept solid.
        const extrusionInvertNulls = extrusion.filter((segment) => segment.invertElevationM === null).length
        const portInvertNulls = fromPorts.filter((segment) => segment.invertElevationM === null).length
        expect(extrusionInvertNulls).toBe(0)
        expect(portInvertNulls).toBe(0)

        // Port centrelines agree with the pset Length (ports are the real pipe ends)
        // and the lower port sits at the pset InvertElevation.
        let maxLengthDeviationM = 0
        let maxInvertDeviationM = 0
        for (const segment of fromPorts) {
          const dx = segment.end!.x - segment.start!.x
          const dy = segment.end!.y - segment.start!.y
          const dz = segment.end!.z - segment.start!.z
          const lengthM = Math.sqrt(dx * dx + dy * dy + dz * dz) * network.metersPerSourceUnit
          expect(lengthM).toBeGreaterThan(0)
          maxLengthDeviationM = Math.max(maxLengthDeviationM, Math.abs(lengthM - segment.lengthM!))
          const bottomM = Math.min(segment.start!.z, segment.end!.z) * network.metersPerSourceUnit
          maxInvertDeviationM = Math.max(maxInvertDeviationM, Math.abs(bottomM - segment.invertElevationM!))
          expect(isVerticalEngineerSegment(segment)).toBe(true)
        }
        expect(maxLengthDeviationM).toBeLessThan(0.001)
        expect(maxInvertDeviationM).toBeLessThan(0.001)

        // --- footprint containment (plan, viewer frame) and no origin artifacts ---
        const meshes = await extractFloorMeshes(api, modelId, storey!.id)
        const box = meshes.sourceBoundingBox
        const width = box.max.x - box.min.x
        const depth = box.max.z - box.min.z
        expect(width).toBeGreaterThan(FOOTPRINT_WIDTH_M[0])
        expect(width).toBeLessThan(FOOTPRINT_WIDTH_M[1])
        expect(depth).toBeGreaterThan(FOOTPRINT_DEPTH_M[0])
        expect(depth).toBeLessThan(FOOTPRINT_DEPTH_M[1])

        const resolved = network.segments.filter((segment) => segment.start !== null && segment.end !== null)
        expect(resolved).toHaveLength(EXPECTED_SEGMENTS.total - EXPECTED_ENDPOINT_SOURCES.unresolved)
        for (const segment of resolved) {
          for (const point of [segment.start!, segment.end!]) {
            const viewer = ifcSourceToViewerPoint(point, network.metersPerSourceUnit)
            expect(viewer.x, `segment #${segment.expressId} x`).toBeGreaterThanOrEqual(box.min.x - FOOTPRINT_MARGIN_M)
            expect(viewer.x, `segment #${segment.expressId} x`).toBeLessThanOrEqual(box.max.x + FOOTPRINT_MARGIN_M)
            expect(viewer.z, `segment #${segment.expressId} z`).toBeGreaterThanOrEqual(box.min.z - FOOTPRINT_MARGIN_M)
            expect(viewer.z, `segment #${segment.expressId} z`).toBeLessThanOrEqual(box.max.z + FOOTPRINT_MARGIN_M)
            expect(point.x === 0 && point.y === 0 && point.z === 0, `segment #${segment.expressId} at origin`).toBe(false)
          }
          expect(
            segment.start!.x === segment.end!.x && segment.start!.y === segment.end!.y && segment.start!.z === segment.end!.z,
            `segment #${segment.expressId} zero length`,
          ).toBe(false)
        }

        // --- riser classification ---
        const classification = classifyEngineerRiserStacks(network)
        const band = storeySlabBandM(network, storey!.id)!
        const summary = {
          segments: network.segments.length,
          bySystem: { swGrv: EXPECTED_SEGMENTS.swGrv, vnt: EXPECTED_SEGMENTS.vnt },
          vertical: network.segments.filter((segment) => isVerticalEngineerSegment(segment)).length,
          endpointSources: network.geometrySummary.endpointSourceCounts,
          unresolvedReasons: network.geometrySummary.unresolvedSegments.map((entry) => entry.reason),
          diametersMm: countBy(network.segments.map((segment) => roundedDiameterKey(segment))),
          invertElevationNulls: { extrusion: extrusionInvertNulls, ports: portInvertNulls },
          maxPortLengthDeviationM: maxLengthDeviationM,
          footprintM: { width, depth },
          storeyPitchM: classification.storeyPitchM,
          minStackExtentM: classification.minStackExtentM,
          sanitaryStacks: classification.sanitaryStacks.length,
          ventStacks: classification.ventStacks.length,
          stubs: classification.stubs.length,
          sanitaryIntersectingStorey: stacksIntersectingBand(classification.sanitaryStacks, band).length,
          ventIntersectingStorey: stacksIntersectingBand(classification.ventStacks, band).length,
          stackDiametersMm: countBy(classification.sanitaryStacks.map((stack) => String(Math.round(stack.diameterMm)))),
          stackExtentsM: classification.sanitaryStacks.map((stack) => Number(stack.extentM.toFixed(2))),
        }
        console.info(`[shbj-SA ${STOREY_NAME}]`, JSON.stringify(summary))

        expect(classification.minStackExtentSource).toBe('storey-pitch-median')
        expect(classification.sanitaryStacks).toHaveLength(EXPECTED_CLASSIFICATION.sanitaryStacks)
        expect(classification.ventStacks).toHaveLength(EXPECTED_CLASSIFICATION.ventStacks)
        expect(classification.stubs).toHaveLength(EXPECTED_CLASSIFICATION.stubs)
        expect(JSON.stringify(classification)).not.toContain('NaN')
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})

function isSwGrv(segment: EngineerPipeSegment): boolean {
  return (segment.systemName ?? '').toUpperCase().startsWith('SW-GRV')
}

function isVnt(segment: EngineerPipeSegment): boolean {
  return (segment.systemName ?? '').toUpperCase().startsWith('VNT')
}

function roundedDiameterKey(segment: EngineerPipeSegment): string {
  return segment.outerDiameterMm === null ? 'null' : String(Math.round(segment.outerDiameterMm))
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}
