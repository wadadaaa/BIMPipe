import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { extractFloorMeshes } from './extractFloorMeshes'
import { parseStoreys } from './parseStoreys'
import { readPlacementOriginProbe, resolveModelOriginDecision } from './resolveModelOrigin'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import { readRepresentationContextFrame } from './readRepresentationContextFrame'
import { exportFullIfcWithRisersWithDebug } from './exportFullIfcWithRisers'
import { readBimPipeFramePset } from './exportFullIfcWithRisers.frame.testutil'
import type { Riser } from '@/domain/types'

// Gated regression against real client data (gitignored). Skips cleanly when
// the files are absent. Project "shbj" is a Revit "Project Base Point" export:
// site/building placements sit at the origin while the survey offset and the
// TrueNorth rotation live in the 3D 'Model' representation context. The 096
// project, by contrast, carries its offset in the IfcSite placement and must
// keep its previous decision byte-for-byte.
const SHBJ_DIR = path.resolve(process.cwd(), 'external/projects/shbj')
const SHBJ_SA_PATH = path.join(SHBJ_DIR, 'shbj-SA.ifc')
const SHBJ_ST_PATH = path.join(SHBJ_DIR, 'shbj-ST.ifc')
const IFC_096_P_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')

const TEST_TIMEOUT_MS = 180_000

// Reference facts (cm model): WCS location and TrueNorth read from the file.
const EXPECTED_OFFSET_M = { x: 196_714.72, y: 743_288.87, z: 12.5 }
const EXPECTED_TRUE_NORTH_DEG = 6.53

async function openModel(filePath: string): Promise<{ api: IfcAPI; modelId: number }> {
  const ifc = await import('web-ifc')
  const api = new ifc.IfcAPI()
  await api.Init()
  const modelId = api.OpenModel(new Uint8Array(readFileSync(filePath)))
  return { api, modelId }
}

async function findFirstStoreyWithGeometry(api: IfcAPI, modelId: number) {
  const storeys = await parseStoreys(api, modelId, 'shbj-gated')
  for (const storey of storeys) {
    const meshes = await extractFloorMeshes(api, modelId, storey.id)
    if (!meshes.sourceBoundingBox.isEmpty()) return { storey, meshes }
  }
  throw new Error('No storey with geometry found.')
}

async function assertContextDecision(filePath: string) {
  const { api, modelId } = await openModel(filePath)
  try {
    const unit = await resolveModelLengthUnit(api, modelId)
    expect(unit).toBe('cm')

    // Placement probes see the origin: neither site nor building is far.
    const probe = await readPlacementOriginProbe(api, modelId, unit)
    expect(probe).not.toBeNull()
    expect(probe!.farFromOrigin).toBe(false)

    // web-ifc does not apply the context WCS: geometry lands near the origin.
    const { storey, meshes } = await findFirstStoreyWithGeometry(api, modelId)
    const box = meshes.sourceBoundingBox
    const planCentre = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 }
    expect(Math.hypot(planCentre.x, planCentre.z)).toBeLessThan(1_000)

    const context = await readRepresentationContextFrame(api, modelId, unit)
    expect(context).not.toBeNull()
    expect(context!.wcsLocationM!.x).toBeCloseTo(EXPECTED_OFFSET_M.x, 2)
    expect(context!.wcsLocationM!.y).toBeCloseTo(EXPECTED_OFFSET_M.y, 2)
    expect(context!.wcsLocationM!.z).toBeCloseTo(EXPECTED_OFFSET_M.z, 2)
    expect(context!.trueNorthDeg).toBeCloseTo(EXPECTED_TRUE_NORTH_DEG, 2)

    const decision = await resolveModelOriginDecision(
      api,
      modelId,
      { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
      unit,
    )
    expect(decision).not.toBeNull()
    // Render frame stays identity — the viewer must not shift the model.
    expect(decision!.origin).toEqual({ x: 0, y: 0, z: 0 })
    expect(decision!.detectedBy).toBe('context')
    const frame = decision!.sourceFrame!
    expect(frame.lengthUnit).toBe('cm')
    expect(Math.abs(frame.offsetM!.x - EXPECTED_OFFSET_M.x)).toBeLessThan(0.01)
    expect(Math.abs(frame.offsetM!.y - EXPECTED_OFFSET_M.y)).toBeLessThan(0.01)
    expect(Math.abs(frame.offsetM!.z - EXPECTED_OFFSET_M.z)).toBeLessThan(0.01)
    expect(Math.abs(frame.trueNorthDeg! - EXPECTED_TRUE_NORTH_DEG)).toBeLessThan(0.01)

    console.info(
      `[shbj gated] ${path.basename(filePath)} storey="${storey.name}" detectedBy=${decision!.detectedBy} ` +
        `offsetM=(${frame.offsetM!.x.toFixed(3)}, ${frame.offsetM!.y.toFixed(3)}, ${frame.offsetM!.z.toFixed(3)}) ` +
        `trueNorthDeg=${frame.trueNorthDeg!.toFixed(4)} wcsRotationDeg=${frame.wcsRotationDeg}`,
    )
  } finally {
    api.CloseModel(modelId)
  }
}

describe.skipIf(!existsSync(SHBJ_SA_PATH) || !existsSync(SHBJ_ST_PATH))(
  'shbj context-WCS frame (gated: requires local client files)',
  () => {
    it('SA: detectedBy context with the survey offset and 6.53 deg true north', async () => {
      await assertContextDecision(SHBJ_SA_PATH)
    }, TEST_TIMEOUT_MS)

    it('ST: detectedBy context with the same offset and true north', async () => {
      await assertContextDecision(SHBJ_ST_PATH)
    }, TEST_TIMEOUT_MS)

    it('SA export preserves the context WCS/TrueNorth and carries the frame in BIMPipe_Frame', async () => {
      const sourceBytes = new Uint8Array(readFileSync(SHBJ_SA_PATH))
      const { api, modelId } = await openModel(SHBJ_SA_PATH)
      let storeyIds: number[]
      try {
        const storeys = await parseStoreys(api, modelId, 'shbj-gated-export')
        const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation)
        expect(sorted.length).toBeGreaterThanOrEqual(2)
        storeyIds = [sorted[0].id, sorted[1].id]
      } finally {
        api.CloseModel(modelId)
      }

      const risers: Riser[] = storeyIds.map((storeyId, index) => ({
        id: `r-${index}`,
        stackId: 'stack-1',
        stackLabel: 'R1',
        storeyId,
        position: { x: 2.5, y: 0, z: -3.5 },
      }))

      const ifc = await import('web-ifc')
      const exportApi = new ifc.IfcAPI()
      await exportApi.Init()
      const { ifcBytes, debugMapping } = await exportFullIfcWithRisersWithDebug(
        exportApi,
        sourceBytes,
        storeyIds[0],
        risers,
        null,
        { exportRunId: 'shbj-gated', timestamp: '2026-01-01T00:00:00.000Z' },
      )
      expect(debugMapping.sourceFrame?.detectedBy).toBe('context')
      expect(Math.abs(debugMapping.sourceFrame!.trueNorthDeg! - EXPECTED_TRUE_NORTH_DEG)).toBeLessThan(0.01)

      const reopenApi = new ifc.IfcAPI()
      await reopenApi.Init()
      const reopenedId = reopenApi.OpenModel(ifcBytes)
      try {
        const context = await readRepresentationContextFrame(reopenApi, reopenedId, 'cm')
        expect(context!.wcsLocationM!.x).toBeCloseTo(EXPECTED_OFFSET_M.x, 2)
        expect(context!.wcsLocationM!.y).toBeCloseTo(EXPECTED_OFFSET_M.y, 2)
        expect(context!.trueNorthDeg).toBeCloseTo(EXPECTED_TRUE_NORTH_DEG, 2)

        const pset = readBimPipeFramePset(reopenApi, reopenedId)
        expect(pset).not.toBeNull()
        expect(pset!.relatedObjectTypes).toEqual(['IfcProject'])
        expect(pset!.properties.DetectedBy).toBe('context')
        expect(Math.abs((pset!.properties.TrueNorthDeg as number) - EXPECTED_TRUE_NORTH_DEG)).toBeLessThan(0.01)
      } finally {
        reopenApi.CloseModel(reopenedId)
      }
    }, TEST_TIMEOUT_MS)
  },
)

describe.skipIf(!existsSync(IFC_096_P_PATH))('096-P origin decision is unchanged by the context source (gated)', () => {
  it('still reports site-placement with the same quantized origin on storey 01', async () => {
    const { api, modelId } = await openModel(IFC_096_P_PATH)
    try {
      const unit = await resolveModelLengthUnit(api, modelId)
      const storeys = await parseStoreys(api, modelId, '096-gated')
      const storey01 = storeys.find((storey) => storey.name === '01')
      expect(storey01).toBeDefined()
      const box = (await extractFloorMeshes(api, modelId, storey01!.id)).sourceBoundingBox
      const decision = await resolveModelOriginDecision(
        api,
        modelId,
        { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z },
        unit,
      )
      // Recorded before the context source existed (project096.localframe.gated.test.ts).
      expect(decision).toEqual({
        origin: { x: 181_416, y: 0, z: -664_632 },
        detectedBy: 'site-placement',
      })
      expect('sourceFrame' in decision!).toBe(false)

      // Identity context WCS: the reader sees it, the frame resolver ignores it.
      const context = await readRepresentationContextFrame(api, modelId, unit)
      expect(Math.hypot(context!.wcsLocationSource.x, context!.wcsLocationSource.y)).toBeLessThan(1)
    } finally {
      api.CloseModel(modelId)
    }
  }, TEST_TIMEOUT_MS)
})
