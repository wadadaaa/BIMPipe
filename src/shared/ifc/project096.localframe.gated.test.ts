import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { detectFixtures } from './detectFixtures'
import { extractFloorMeshes } from './extractFloorMeshes'
import { resolveModelOriginDecision } from './resolveModelOrigin'
import { toLocalPoint, type ModelFrame } from '@/shared/frame/modelFrame'

// Gated regression against the real 096 project (client data, gitignored).
// Skips cleanly when the file is absent so CI and other machines stay green;
// on machines with the client data it exercises the full W1 path end to end:
// open -> locate storey "01" -> resolve model origin -> detect fixtures ->
// convert to the local frame -> assert count, footprint and origin distance.
const IFC_096_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')

const TEST_TIMEOUT_MS = 120_000

function findStoreyByName(api: IfcAPI, modelId: number, ifc: typeof import('web-ifc'), name: string) {
  const ids = api.GetLineIDsWithType(modelId, ifc.IFCBUILDINGSTOREY)
  for (let i = 0; i < ids.size(); i += 1) {
    const expressId = ids.get(i)
    const line = api.GetLine(modelId, expressId, false) as {
      Name?: { value?: string } | null
      Elevation?: { value?: number } | null
    }
    if (line.Name?.value === name) {
      return { expressId, elevation: line.Elevation?.value ?? null }
    }
  }
  return null
}

describe.skipIf(!existsSync(IFC_096_PATH))('096-P local frame (gated: requires local client file)', () => {
  it(
    'detects 11 WCs on storey 01 inside a ~26x23 m local-frame footprint with a >1 km model origin',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(IFC_096_PATH))

      try {
        // Storey "01" sits at elevation 3015 in source units (centimetres).
        const storey = findStoreyByName(api, modelId, ifc, '01')
        expect(storey).not.toBeNull()
        expect(storey!.elevation).toBeCloseTo(3015, 6)

        // Resolve the model origin exactly the way WorkspacePage does: from the
        // first extraction's source-frame bounds, then re-extract in the frame.
        const probeMeshes = await extractFloorMeshes(api, modelId, storey!.expressId)
        const sourceBox = probeMeshes.sourceBoundingBox
        expect(sourceBox.isEmpty()).toBe(false)

        const decision = await resolveModelOriginDecision(api, modelId, {
          minX: sourceBox.min.x,
          maxX: sourceBox.max.x,
          minZ: sourceBox.min.z,
          maxZ: sourceBox.max.z,
        })
        expect(decision).not.toBeNull()

        // The computed origin must be >1 km from zero and placement-derived.
        const originPlanDistanceM = Math.hypot(decision!.origin.x, decision!.origin.z)
        expect(originPlanDistanceM).toBeGreaterThan(1_000)
        expect(decision!.detectedBy).not.toBe('none')

        const frame: ModelFrame = { origin: decision!.origin }

        // Local-frame geometry: the storey footprint must be building-sized and
        // centred near the local origin (this is what fixes FIT and precision).
        const localMeshes = await extractFloorMeshes(api, modelId, storey!.expressId, frame)
        const localBox = localMeshes.boundingBox
        const footprintXM = localBox.max.x - localBox.min.x
        const footprintZM = localBox.max.z - localBox.min.z
        const centreX = (localBox.min.x + localBox.max.x) / 2
        const centreZ = (localBox.min.z + localBox.max.z) / 2

        // ~26 x 23 m footprint (reference fact), tolerance +/-3 m.
        expect(footprintXM).toBeGreaterThan(23)
        expect(footprintXM).toBeLessThan(29)
        expect(footprintZM).toBeGreaterThan(20)
        expect(footprintZM).toBeLessThan(26)
        expect(Math.hypot(centreX, centreZ)).toBeLessThan(50)

        // Outlier-robust viewer bounds: storey 01 carries two full-height
        // IfcFlowTerminal stacks (~125 m tall), six IfcCovering meshes
        // reaching ~34 m up and one IfcFlowController (3 meshes) floating
        // ~30 m above the slice. Their vertical extent must not inflate the
        // FIT box — the vertical span must stay a storey slice, strictly
        // smaller than both plan spans, or the viewer's smallest-axis-is-up
        // camera flips into a section view (the "sliver").
        const verticalSpanM = localBox.max.y - localBox.min.y
        expect(verticalSpanM).toBeGreaterThan(0)
        expect(verticalSpanM).toBeLessThan(10)
        expect(verticalSpanM).toBeLessThan(footprintXM)
        expect(verticalSpanM).toBeLessThan(footprintZM)
        expect(localMeshes.boundsDiagnostics?.verticalOutlierMeshCount).toBe(11)
        expect(localMeshes.boundsDiagnostics?.planOutlierMeshCount).toBe(0)

        // The domain-facing source box is NOT outlier-filtered: it still spans
        // the full ~125 m vertical reach of the stacks.
        const sourceSpanYM = localMeshes.sourceBoundingBox.max.y - localMeshes.sourceBoundingBox.min.y
        expect(sourceSpanYM).toBeGreaterThan(100)

        // Fixture detection position path: 11 WCs on this storey.
        const fixtures = await detectFixtures(api, modelId, storey!.expressId)
        const toilets = fixtures.filter((fixture) => fixture.kind === 'TOILETPAN')
        expect(toilets).toHaveLength(11)
        expect(toilets.every((toilet) => toilet.position !== null)).toBe(true)

        // After local-frame conversion every WC lands in small, precision-safe
        // coordinates inside the storey footprint.
        const localToilets = toilets.map((toilet) => toLocalPoint(frame, toilet.position!))
        const xs = localToilets.map((position) => position.x)
        const zs = localToilets.map((position) => position.z)
        for (const position of localToilets) {
          expect(Math.abs(position.x)).toBeLessThan(1_000)
          expect(Math.abs(position.z)).toBeLessThan(1_000)
          expect(position.x).toBeGreaterThanOrEqual(localBox.min.x - 1)
          expect(position.x).toBeLessThanOrEqual(localBox.max.x + 1)
          expect(position.z).toBeGreaterThanOrEqual(localBox.min.z - 1)
          expect(position.z).toBeLessThanOrEqual(localBox.max.z + 1)
        }

        const wcSpreadXM = Math.max(...xs) - Math.min(...xs)
        const wcSpreadZM = Math.max(...zs) - Math.min(...zs)

        // Diagnostic for the task report; assertions on the WC spread itself
        // are pinned after measuring (see expect below).
        console.info(
          `[096 gated] origin=(${decision!.origin.x}, ${decision!.origin.z}) m ` +
            `detectedBy=${decision!.detectedBy} distance=${originPlanDistanceM.toFixed(0)} m; ` +
            `storey footprint=${footprintXM.toFixed(2)}x${footprintZM.toFixed(2)} m ` +
            `verticalSpan=${verticalSpanM.toFixed(2)} m (source ${sourceSpanYM.toFixed(2)} m) ` +
            `centre=(${centreX.toFixed(2)}, ${centreZ.toFixed(2)}); ` +
            `WC spread=${wcSpreadXM.toFixed(2)}x${wcSpreadZM.toFixed(2)} m; ` +
            `diagnostics=${JSON.stringify(localMeshes.boundsDiagnostics)}`,
        )

        // The WCs span most of the footprint in both axes.
        expect(wcSpreadXM).toBeGreaterThan(15)
        expect(wcSpreadZM).toBeGreaterThan(15)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
