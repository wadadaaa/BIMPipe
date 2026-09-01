import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { mergeStoreyDetections } from '@/domain/mergeFixturesAcrossFiles'
import { parseStoreys } from './parseStoreys'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import { readBuildingPlacementSourcePoint } from './readBuildingPlacement'
import { detectFixtures } from './detectFixtures'
import {
  detectMergedStoreyFixtures,
  LINKED_MODEL_EXPRESS_ID_STRIDE,
} from './detectMergedStoreyFixtures'

// Gated multi-IFC regression against the real 096 project (client data,
// gitignored; skips cleanly when absent). The plumbing file (host) and the
// architecture podium file measure storey elevations against different
// anchors: A's IfcBuilding sits 2365 cm above P's zero, so raw elevations
// disagree while absolute elevations line up. Alignment must recover the
// physical-level mapping purely from elevation + building placement.
const IFC_096_P_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')
const IFC_096_A_PATH = path.resolve(process.cwd(), 'external/projects/096/096-A.ifc')

const TEST_TIMEOUT_MS = 180_000

const gated = describe.skipIf(!existsSync(IFC_096_P_PATH) || !existsSync(IFC_096_A_PATH))

gated('096 multi-IFC storey alignment + cross-file merge (gated: requires local client files)', () => {
  it(
    'aligns A storeys to P by absolute elevation and merges the podium storey without double counting',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const hostModelId = api.OpenModel(readFileSync(IFC_096_P_PATH))
      const linkedModelId = api.OpenModel(readFileSync(IFC_096_A_PATH))

      try {
        const hostStoreys = await parseStoreys(api, hostModelId, '096-p')
        const linkedStoreys = await parseStoreys(api, linkedModelId, '096-a')
        expect(hostStoreys).toHaveLength(44)
        expect(linkedStoreys).toHaveLength(13)

        const hostInput: AlignmentModelInput = {
          fileName: '096-P.ifc',
          lengthUnit: await resolveModelLengthUnit(api, hostModelId),
          storeys: hostStoreys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
          buildingPlacement: await readBuildingPlacementSourcePoint(api, hostModelId),
        }
        const linkedInput: AlignmentModelInput = {
          fileName: '096-A.ifc',
          lengthUnit: await resolveModelLengthUnit(api, linkedModelId),
          storeys: linkedStoreys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
          buildingPlacement: await readBuildingPlacementSourcePoint(api, linkedModelId),
        }

        // Both files declare centimetres and resolvable building placements.
        expect(hostInput.lengthUnit).toBe('cm')
        expect(linkedInput.lengthUnit).toBe('cm')
        expect(hostInput.buildingPlacement).not.toBeNull()
        expect(linkedInput.buildingPlacement).not.toBeNull()

        const alignment = alignStoreysByElevation(hostInput, linkedInput)
        expect(alignment.status).toBe('aligned')
        expect(alignment.blockedReason).toBeNull()

        // Both buildings are placed at the same shared plan coordinates.
        expect(alignment.originAgreement.status).toBe('shared')
        expect(alignment.originAgreement.warning).toBeNull()
        expect(alignment.originAgreement.distanceMm).not.toBeNull()
        expect(Math.abs(alignment.originAgreement.distanceMm!)).toBeLessThanOrEqual(10)

        // The physical mapping: A's building placement z (2365 cm) shifts its
        // raw storey elevations onto P's absolute frame. Only five levels of
        // the 13-storey podium coincide with P storeys within 150 mm.
        const mappedNames = new Map(
          alignment.pairs.map((pair) => [pair.host.storeyName, pair.linked.storeyName]),
        )
        expect(mappedNames.get('GF')).toBe('00')
        expect(mappedNames.get('Sea Level')).toBe('SL')
        expect(mappedNames.get('B1')).toBe('B1')
        expect(mappedNames.get('R2')).toBe('B1M')
        expect(mappedNames.get('01')).toBe('01')
        expect(alignment.pairs).toHaveLength(5)

        // Every matched pair coincides almost exactly (sub-millimetre): the
        // 150 mm tolerance is headroom, not something this project consumes.
        for (const pair of alignment.pairs) {
          expect(Math.abs(pair.deltaMm)).toBeLessThanOrEqual(1)
        }

        // Unmapped storeys are reported explicitly on both sides.
        expect(alignment.unmappedHost).toHaveLength(44 - 5)
        expect(alignment.unmappedLinked).toHaveLength(13 - 5)
        const unmappedLinkedNames = alignment.unmappedLinked.map((entry) => entry.storeyName)
        expect(unmappedLinkedNames).toContain('B6')
        expect(unmappedLinkedNames).toContain('00M RES')

        // --- merged detection on the podium storey (P "GF" ↔ A "00") ---
        const hostGf = hostStoreys.find((s) => s.name === 'GF')!
        const gfPair = alignment.pairs.find((pair) => pair.host.storeyName === 'GF')!
        const merged = await detectMergedStoreyFixtures(
          api,
          { webIfcModelId: hostModelId, storeyId: hostGf.id, fileName: '096-P.ifc' },
          [
            {
              webIfcModelId: linkedModelId,
              storeyId: gfPair.linked.storeyId,
              fileName: '096-A.ifc',
            },
          ],
        )

        // P models no fixtures on GF; A's "00" carries 11 (5 WCs + 6 basins).
        // No physical overlap between the files here, so the merge is pure
        // concatenation with zero duplicates — and no double counting: the
        // merged total equals the sum of per-file merged counts exactly.
        const perFile = new Map(merged.perFile.map((entry) => [entry.fileName, entry]))
        expect(perFile.get('096-P.ifc')).toMatchObject({
          detectedFixtureCount: 0,
          mergedFixtureCount: 0,
          duplicateFixtureCount: 0,
        })
        expect(perFile.get('096-A.ifc')).toMatchObject({
          detectedFixtureCount: 11,
          mergedFixtureCount: 11,
          duplicateFixtureCount: 0,
        })
        expect(merged.duplicates).toHaveLength(0)
        expect(merged.fixtures).toHaveLength(11)
        expect(merged.fixtures.filter((f) => f.kind === 'TOILETPAN')).toHaveLength(5)
        expect(merged.fixtures.filter((f) => f.kind === 'WASHHANDBASIN')).toHaveLength(6)

        // Linked-file fixtures are retagged to the HOST storey and shifted
        // into the per-file express-ID range (no collisions with host IDs).
        for (const fixture of merged.fixtures) {
          expect(fixture.storeyId).toBe(hostGf.id)
          expect(fixture.expressId).toBeGreaterThanOrEqual(LINKED_MODEL_EXPRESS_ID_STRIDE)
        }

        // --- dedupe with real coordinates ---
        // The real files have no cross-file duplicated fixtures, so exercise
        // the 120 mm dedupe on real geometry by feeding A "00" against itself
        // under a second file name: every fixture must dedupe at ~0 mm and the
        // host instance must be the one kept.
        const a00Fixtures = await detectFixtures(api, linkedModelId, gfPair.linked.storeyId)
        expect(a00Fixtures).toHaveLength(11)
        const selfMerge = mergeStoreyDetections(
          { fileName: '096-A.ifc', fixtures: a00Fixtures, kitchens: [] },
          [{ fileName: '096-A-copy.ifc', fixtures: a00Fixtures, kitchens: [] }],
        )
        expect(selfMerge.fixtures).toHaveLength(11)
        expect(selfMerge.duplicates).toHaveLength(11)
        for (const duplicate of selfMerge.duplicates) {
          expect(duplicate.keptFileName).toBe('096-A.ifc')
          expect(duplicate.droppedFileName).toBe('096-A-copy.ifc')
          expect(duplicate.distanceMm).toBe(0)
        }
      } finally {
        api.CloseModel(hostModelId)
        api.CloseModel(linkedModelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
