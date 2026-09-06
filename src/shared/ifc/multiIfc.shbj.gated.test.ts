import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { mergeStoreyDetections } from '@/domain/mergeFixturesAcrossFiles'
import type { Fixture, FixtureKind } from '@/domain/types'
import { ifcSourceToViewerPoint } from '@/shared/frame/ifcSourceFrame'
import { dropIsolatedOriginVertices } from '@/shared/frame/originArtifacts'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'
import { detectFixtures } from './detectFixtures'
import { detectMergedStoreyFixtures } from './detectMergedStoreyFixtures'
import { extractEngineerPipeNetwork } from './extractEngineerPipeNetwork'
import { extractFloorMeshes, extractStoreyUnderlayMeshes } from './extractFloorMeshes'
import { parseStoreys } from './parseStoreys'
import { readBuildingPlacementSourcePoint } from './readBuildingPlacement'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'

// Gated multi-IFC regression against the second real project (client data,
// gitignored; skips cleanly when absent). Sanitary (SA, host) and architecture
// (AR, linked) models, IFC2X3 in centimetres, both buildings at the origin.
// The architect and the engineer each modelled the ten standard WCs of storey
// L04, offset from one another by 265-340 mm (different family origins), so
// the old single 120 mm radius kept both copies. The architect additionally
// models seven toilets the engineer does not (a disabled WC and several
// chemical / commercial WCs in other rooms), which must survive the merge.
const SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')
const AR_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-AR.ifc')
const HOST_STOREY_NAME = 'L04'
const HOST_STOREY_ELEVATION_CM = 1800

const TEST_TIMEOUT_MS = 300_000

const ACCESSORY_NAME_PATTERN = /flush|tank|cistern|trap|siphon|drain|sprinkler|hydrant/i

function countByKind(fixtures: readonly Fixture[]): Partial<Record<FixtureKind, number>> {
  const counts: Partial<Record<FixtureKind, number>> = {}
  for (const fixture of fixtures) counts[fixture.kind] = (counts[fixture.kind] ?? 0) + 1
  return counts
}

interface PlanBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function planBoxOf(box: { min: { x: number; z: number }; max: { x: number; z: number } }): PlanBox {
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }
}

function expand(box: PlanBox, marginM: number): PlanBox {
  return {
    minX: box.minX - marginM,
    maxX: box.maxX + marginM,
    minZ: box.minZ - marginM,
    maxZ: box.maxZ + marginM,
  }
}

function containsPlan(box: PlanBox, point: { x: number; z: number }): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ
}

/** World vertices of one element (same transform math as `getIfcElementPosition`). */
function readWorldVertices(api: IfcAPI, modelId: number, expressId: number) {
  const vertices: Array<{ x: number; y: number; z: number }> = []
  const flatMesh = api.GetFlatMesh(modelId, expressId)
  for (let gi = 0; gi < flatMesh.geometries.size(); gi++) {
    const placed = flatMesh.geometries.get(gi)
    const t = placed.flatTransformation
    const geomData = api.GetGeometry(modelId, placed.geometryExpressID)
    const rawVerts = api.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize())
    geomData.delete()
    for (let j = 0; j < rawVerts.length / 6; j++) {
      const lx = rawVerts[j * 6]
      const ly = rawVerts[j * 6 + 1]
      const lz = rawVerts[j * 6 + 2]
      vertices.push({
        x: t[0] * lx + t[4] * ly + t[8] * lz + t[12],
        y: t[1] * lx + t[5] * ly + t[9] * lz + t[13],
        z: t[2] * lx + t[6] * ly + t[10] * lz + t[14],
      })
    }
  }
  return vertices
}

const gated = describe.skipIf(!existsSync(SA_PATH) || !existsSync(AR_PATH))

gated('shbj SA + AR storey alignment, cross-file merge and pipe footprint (gated: requires local client files)', () => {
  it(
    'merges L04 to 18 toilets (10 architect duplicates dropped), 10 basins, 3 sinks, 2 urinals; no accessory becomes a fixture',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const hostModelId = api.OpenModel(readFileSync(SA_PATH))
      const linkedModelId = api.OpenModel(readFileSync(AR_PATH))

      try {
        const hostStoreys = await parseStoreys(api, hostModelId, 'shbj-sa')
        const linkedStoreys = await parseStoreys(api, linkedModelId, 'shbj-ar')

        const hostInput: AlignmentModelInput = {
          fileName: 'SA.ifc',
          lengthUnit: await resolveModelLengthUnit(api, hostModelId),
          storeys: hostStoreys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
          buildingPlacement: await readBuildingPlacementSourcePoint(api, hostModelId),
        }
        const linkedInput: AlignmentModelInput = {
          fileName: 'AR.ifc',
          lengthUnit: await resolveModelLengthUnit(api, linkedModelId),
          storeys: linkedStoreys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
          buildingPlacement: await readBuildingPlacementSourcePoint(api, linkedModelId),
        }
        expect(hostInput.lengthUnit).toBe('cm')
        expect(linkedInput.lengthUnit).toBe('cm')

        const alignment = alignStoreysByElevation(hostInput, linkedInput)
        expect(alignment.status).toBe('aligned')
        expect(alignment.blockedReason).toBeNull()

        // --- storey pairing by absolute elevation ---
        const hostL04 = hostStoreys.find((s) => s.name === HOST_STOREY_NAME)
        expect(hostL04).toBeDefined()
        expect(hostL04!.elevation).toBeCloseTo(HOST_STOREY_ELEVATION_CM, 6)
        const pair = alignment.pairs.find((entry) => entry.host.storeyId === hostL04!.id)
        expect(pair, 'L04 must align to a linked storey').toBeDefined()
        expect(Math.abs(pair!.deltaMm)).toBeLessThanOrEqual(1)
        const linkedL04 = linkedStoreys.find((s) => s.id === pair!.linked.storeyId)!
        expect(linkedL04.elevation).toBeCloseTo(HOST_STOREY_ELEVATION_CM, 6)

        // --- per-file detection (reference facts from the classifier test) ---
        const saFixtures = await detectFixtures(api, hostModelId, hostL04!.id)
        const arFixtures = await detectFixtures(api, linkedModelId, linkedL04.id)
        const saCounts = countByKind(saFixtures)
        const arCounts = countByKind(arFixtures)
        console.info('[shbj merge] SA-only', JSON.stringify(saCounts), 'AR-only', JSON.stringify(arCounts))
        expect(saCounts).toEqual({ TOILETPAN: 11, WASHHANDBASIN: 10, SINK: 1 })
        expect(arCounts).toEqual({ TOILETPAN: 17, SINK: 2, URINAL: 2 })

        // --- merged detection on the aligned storey ---
        const merged = await detectMergedStoreyFixtures(
          api,
          { webIfcModelId: hostModelId, storeyId: hostL04!.id, fileName: 'SA.ifc' },
          [{ webIfcModelId: linkedModelId, storeyId: linkedL04.id, fileName: 'AR.ifc' }],
        )
        const mergedCounts = countByKind(merged.fixtures)
        console.info(
          '[shbj merge] merged',
          JSON.stringify(mergedCounts),
          'duplicates(mm)',
          JSON.stringify(merged.duplicates.map((d) => d.distanceMm).sort((a, b) => a - b)),
        )

        // 11 engineer WCs + 7 architect-only toilets; the 10 shared WCs are
        // counted once (from SA). Basins and the multi-bowl sink units are
        // different kinds and are never collapsed into each other.
        expect(mergedCounts).toEqual({ TOILETPAN: 18, WASHHANDBASIN: 10, SINK: 3, URINAL: 2 })
        expect(merged.fixtures).toHaveLength(33)
        expect(merged.perFile).toEqual([
          expect.objectContaining({ fileName: 'SA.ifc', detectedFixtureCount: 22, mergedFixtureCount: 22, duplicateFixtureCount: 0 }),
          expect.objectContaining({ fileName: 'AR.ifc', detectedFixtureCount: 21, mergedFixtureCount: 11, duplicateFixtureCount: 10 }),
        ])

        // Every duplicate is an architect WC collapsed onto the engineer WC.
        expect(merged.duplicates).toHaveLength(10)
        for (const duplicate of merged.duplicates) {
          expect(duplicate.kind).toBe('TOILETPAN')
          expect(duplicate.keptFileName).toBe('SA.ifc')
          expect(duplicate.droppedFileName).toBe('AR.ifc')
          expect(duplicate.toleranceMm).toBe(400)
          expect(duplicate.distanceMm).toBeGreaterThanOrEqual(250)
          expect(duplicate.distanceMm).toBeLessThanOrEqual(350)
        }
        // Six of the ten pairs sit beyond 300 mm — the reason the WC radius is 400 mm.
        expect(merged.duplicates.filter((d) => d.distanceMm > 300)).toHaveLength(6)

        // Kept positions are the engineer's: every merged WC that has an SA
        // counterpart IS the SA fixture (host wins ties by default).
        const saToiletIds = new Set(saFixtures.filter((f) => f.kind === 'TOILETPAN').map((f) => f.expressId))
        expect(merged.fixtures.filter((f) => saToiletIds.has(f.expressId))).toHaveLength(11)

        // No accessory reaches the merge as a fixture, from either file.
        expect(mergedCounts.CISTERN).toBeUndefined()
        expect(mergedCounts.OTHER).toBeUndefined()
        for (const fixture of merged.fixtures) {
          expect(fixture.name, `fixture #${fixture.expressId}`).not.toMatch(ACCESSORY_NAME_PATTERN)
        }

        // Priority knob: with AR as host and SA marked as the engineer model,
        // the same 33 fixtures come out and the WCs are still SA's.
        const prioritised = mergeStoreyDetections(
          { fileName: 'AR.ifc', fixtures: arFixtures, kitchens: [] },
          [{ fileName: 'SA.ifc', fixtures: saFixtures, kitchens: [], mergePriority: 1 }],
        )
        expect(countByKind(prioritised.fixtures)).toEqual(mergedCounts)
        expect(prioritised.duplicates.every((d) => d.keptFileName === 'SA.ifc')).toBe(true)
        // Without the knob the architect copies would win instead.
        const architectFirst = mergeStoreyDetections(
          { fileName: 'AR.ifc', fixtures: arFixtures, kitchens: [] },
          [{ fileName: 'SA.ifc', fixtures: saFixtures, kitchens: [] }],
        )
        expect(countByKind(architectFirst.fixtures)).toEqual(mergedCounts)
        expect(architectFirst.duplicates.every((d) => d.keptFileName === 'AR.ifc')).toBe(true)
      } finally {
        api.CloseModel(hostModelId)
        api.CloseModel(linkedModelId)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'keeps every L04 pipe segment inside the storey footprint — no vertex is pulled toward the origin',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const hostModelId = api.OpenModel(readFileSync(SA_PATH))
      const linkedModelId = api.OpenModel(readFileSync(AR_PATH))

      try {
        const hostStoreys = await parseStoreys(api, hostModelId, 'shbj-sa')
        const linkedStoreys = await parseStoreys(api, linkedModelId, 'shbj-ar')
        const hostL04 = hostStoreys.find((s) => s.name === HOST_STOREY_NAME)!
        const linkedL04 = linkedStoreys.find(
          (s) => Math.abs(s.elevation - HOST_STOREY_ELEVATION_CM) < 1,
        )!
        expect(linkedL04).toBeDefined()

        // Footprints: engineer storey geometry and architect walls/columns.
        const saMeshes = await extractFloorMeshes(api, hostModelId, hostL04.id)
        const arWalls = await extractStoreyUnderlayMeshes(api, linkedModelId, linkedL04.id)
        const saBox = planBoxOf(saMeshes.sourceBoundingBox)
        const wallBox = planBoxOf(arWalls.sourceBoundingBox)
        const saWidth = saBox.maxX - saBox.minX
        const saDepth = saBox.maxZ - saBox.minZ
        const wallWidth = wallBox.maxX - wallBox.minX
        const wallDepth = wallBox.maxZ - wallBox.minZ
        console.info(
          `[shbj pipes] SA L04 footprint ${saWidth.toFixed(1)} x ${saDepth.toFixed(1)} m; ` +
            `AR L04 walls ${wallWidth.toFixed(1)} x ${wallDepth.toFixed(1)} m; ` +
            `diagnostics SA=${JSON.stringify(saMeshes.boundsDiagnostics)} AR=${JSON.stringify(arWalls.boundsDiagnostics)}`,
        )
        // Measured: ~66 x 53 m (SA) and ~74 x 56 m (AR walls). Pinned with headroom.
        expect(saWidth).toBeGreaterThan(55)
        expect(saWidth).toBeLessThan(80)
        expect(saDepth).toBeGreaterThan(45)
        expect(saDepth).toBeLessThan(65)
        expect(wallWidth).toBeGreaterThan(60)
        expect(wallWidth).toBeLessThan(90)
        expect(wallDepth).toBeGreaterThan(45)
        expect(wallDepth).toBeLessThan(70)
        expect(saMeshes.boundsDiagnostics?.planOutlierMeshCount).toBe(0)
        expect(arWalls.boundsDiagnostics?.planOutlierMeshCount).toBe(0)

        // The building straddles the origin, so "pulled toward the origin" is
        // only detectable as "outside the storey footprint" — assert containment.
        const allowed = expand(wallBox, 2)

        const { elementIds } = await collectSpatialTreeElements(api, hostModelId, hostL04.id)
        const pipeIds: number[] = []
        for (const typeConstant of [ifc.IFCFLOWSEGMENT, ifc.IFCPIPESEGMENT]) {
          const ids = api.GetLineIDsWithType(hostModelId, typeConstant)
          for (let i = 0; i < ids.size(); i++) if (elementIds.has(ids.get(i))) pipeIds.push(ids.get(i))
        }
        console.info(`[shbj pipes] L04 pipe segments: ${pipeIds.length}`)
        expect(pipeIds.length).toBeGreaterThanOrEqual(120)

        let droppedVertices = 0
        for (const expressId of pipeIds) {
          const vertices = readWorldVertices(api, hostModelId, expressId)
          expect(vertices.length, `pipe #${expressId} has geometry`).toBeGreaterThan(0)
          const guarded = dropIsolatedOriginVertices(vertices)
          droppedVertices += vertices.length - guarded.length
          for (const vertex of guarded) {
            expect(containsPlan(allowed, vertex), `pipe #${expressId} vertex inside footprint`).toBe(true)
          }
        }
        // The profiled fact: these meshes carry no world-origin artifacts.
        expect(droppedVertices).toBe(0)

        // Centreline extraction (V1b). The engineer model declares three SI
        // length units (project centimetres plus decimetre / metre units used
        // only inside derived units); the extractor follows the project unit
        // assignment, so the extraction runs and every resolved centreline
        // endpoint must lie inside the architect wall footprint. Endpoints are
        // in the IFC source frame (cm, Z-up) and are mapped to the viewer plan
        // frame before containment. Six vertical cut-face pipes have no usable
        // port pair and stay unresolved (reported, never placed at the origin).
        const network = await extractEngineerPipeNetwork(api, hostModelId, { systemPrefixes: ['SW-GRV', 'VNT'] })
        expect(network.metersPerSourceUnit).toBe(0.01)
        const l04Segments = network.segments.filter((segment) => segment.storeyId === hostL04.id)
        expect(l04Segments).toHaveLength(87)
        console.info(
          `[shbj pipes] extractor endpoint sources: ${JSON.stringify(network.geometrySummary.endpointSourceCounts)}`,
        )
        expect(network.geometrySummary.endpointSourceCounts.unresolved).toBeLessThanOrEqual(6)
        const resolvedSegments = l04Segments.filter((segment) => segment.start !== null && segment.end !== null)
        expect(resolvedSegments).toHaveLength(l04Segments.length - network.geometrySummary.endpointSourceCounts.unresolved)
        for (const segment of resolvedSegments) {
          const start = ifcSourceToViewerPoint(segment.start!, network.metersPerSourceUnit)
          const end = ifcSourceToViewerPoint(segment.end!, network.metersPerSourceUnit)
          expect(containsPlan(allowed, start), `segment #${segment.expressId} start`).toBe(true)
          expect(containsPlan(allowed, end), `segment #${segment.expressId} end`).toBe(true)
          expect(start.x === end.x && start.y === end.y && start.z === end.z, `segment #${segment.expressId} zero length`).toBe(false)
        }
      } finally {
        api.CloseModel(hostModelId)
        api.CloseModel(linkedModelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
