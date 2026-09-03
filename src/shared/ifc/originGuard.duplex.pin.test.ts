import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectFixtures } from './detectFixtures'
import { extractContinuityStoreyInputs } from './extractContinuityInputs'
import { extractEngineerPipeNetwork } from './extractEngineerPipeNetwork'
import { extractFloorMeshes } from './extractFloorMeshes'
import { parseStoreys } from './parseStoreys'

/**
 * Regression pin for the bundled Duplex sample (near-origin geometry, no
 * gating). Every code path that filters world-origin artifacts — floor-mesh
 * bounds, fixture centroids, continuity footprints and the engineer pipe
 * mesh-bounds fallback — is exercised here and its numeric output is pinned
 * (rounded to 1 µm). The snapshot was recorded BEFORE the shared origin guard
 * (`src/shared/frame/originArtifacts.ts`) replaced the per-file rules, so a
 * change in any of these numbers means the guard altered near-origin models,
 * which it must never do.
 */
const DUPLEX_PATH = path.resolve(process.cwd(), 'public/samples/Duplex_MEP_20110907.ifc')

const TEST_TIMEOUT_MS = 120_000

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function roundBox(box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) {
  return {
    min: [round6(box.min.x), round6(box.min.y), round6(box.min.z)],
    max: [round6(box.max.x), round6(box.max.y), round6(box.max.z)],
  }
}

describe('Duplex origin-guard regression pin', () => {
  it(
    'floor bounds, fixture positions, continuity footprints and pipe bounds stay byte-identical',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(DUPLEX_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, 'duplex-pin')

        const floors = []
        const fixtures = []
        for (const storey of storeys) {
          const meshes = await extractFloorMeshes(api, modelId, storey.id)
          floors.push({
            storey: storey.name,
            source: roundBox(meshes.sourceBoundingBox),
            viewer: roundBox(meshes.boundingBox),
            diagnostics: meshes.boundsDiagnostics,
          })
          for (const fixture of await detectFixtures(api, modelId, storey.id)) {
            fixtures.push({
              storey: storey.name,
              kind: fixture.kind,
              position:
                fixture.position === null
                  ? null
                  : [round6(fixture.position.x), round6(fixture.position.y), round6(fixture.position.z)],
            })
          }
        }

        expect(floors).toMatchInlineSnapshot(`
          [
            {
              "diagnostics": {
                "nonFiniteVertexCount": 0,
                "planOutlierMeshCount": 0,
                "verticalOutlierMeshCount": 0,
              },
              "source": {
                "max": [
                  8.434893,
                  3.211901,
                  17.469854,
                ],
                "min": [
                  -0.389512,
                  -0.761366,
                  0.323732,
                ],
              },
              "storey": "Level 1",
              "viewer": {
                "max": [
                  8.434893,
                  3.211901,
                  17.469854,
                ],
                "min": [
                  -0.389512,
                  -0.761366,
                  0.323732,
                ],
              },
            },
            {
              "diagnostics": {
                "nonFiniteVertexCount": 0,
                "planOutlierMeshCount": 0,
                "verticalOutlierMeshCount": 0,
              },
              "source": {
                "max": [
                  8.437306,
                  6.55869,
                  17.431803,
                ],
                "min": [
                  -0.072464,
                  -0.690901,
                  0.362337,
                ],
              },
              "storey": "Level 2",
              "viewer": {
                "max": [
                  8.437306,
                  6.55869,
                  17.431803,
                ],
                "min": [
                  -0.072464,
                  -0.690901,
                  0.362337,
                ],
              },
            },
            {
              "diagnostics": {
                "nonFiniteVertexCount": 0,
                "planOutlierMeshCount": 0,
                "verticalOutlierMeshCount": 0,
              },
              "source": {
                "max": [
                  5.212464,
                  6.458,
                  7.318482,
                ],
                "min": [
                  4.962464,
                  4.313,
                  7.068482,
                ],
              },
              "storey": "Roof",
              "viewer": {
                "max": [
                  5.212464,
                  6.458,
                  7.318482,
                ],
                "min": [
                  4.962464,
                  4.313,
                  7.068482,
                ],
              },
            },
          ]
        `)
        expect(fixtures).toMatchInlineSnapshot(`
          [
            {
              "kind": "TOILETPAN",
              "position": [
                5.141475,
                0.384175,
                9.796311,
              ],
              "storey": "Level 1",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                5.0125,
                0.8271,
                9.1575,
              ],
              "storey": "Level 1",
            },
            {
              "kind": "TOILETPAN",
              "position": [
                3.658525,
                0.384175,
                8.003928,
              ],
              "storey": "Level 1",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                3.7875,
                0.8271,
                8.6425,
              ],
              "storey": "Level 1",
            },
            {
              "kind": "TOILETPAN",
              "position": [
                5.139975,
                3.484175,
                9.666072,
              ],
              "storey": "Level 2",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                5.0125,
                3.9271,
                8.820384,
              ],
              "storey": "Level 2",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                5.0125,
                3.9271,
                8.170384,
              ],
              "storey": "Level 2",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                3.7875,
                3.9271,
                9.645051,
              ],
              "storey": "Level 2",
            },
            {
              "kind": "WASHHANDBASIN",
              "position": [
                3.7875,
                3.9271,
                8.995051,
              ],
              "storey": "Level 2",
            },
            {
              "kind": "TOILETPAN",
              "position": [
                3.658525,
                3.484175,
                8.149928,
              ],
              "storey": "Level 2",
            },
          ]
        `)

        const continuity = await extractContinuityStoreyInputs(api, modelId)
        const continuitySummary = continuity.storeys.map((storey) => ({
          storey: storey.storeyName,
          obstructions: storey.obstructions.length,
          voids: storey.voids.length,
          spaces: storey.spaces.length,
          footprintDigest: digest(
            [...storey.obstructions, ...storey.voids, ...storey.spaces].map((entry) =>
              entry.footprint === null || entry.footprint.shape !== 'bbox'
                ? null
                : [
                    round6(entry.footprint.bounds.minX),
                    round6(entry.footprint.bounds.maxX),
                    round6(entry.footprint.bounds.minZ),
                    round6(entry.footprint.bounds.maxZ),
                  ],
            ),
          ),
        }))
        expect(continuitySummary).toMatchInlineSnapshot(`
          [
            {
              "footprintDigest": "eb3affdfeccdab77",
              "obstructions": 0,
              "spaces": 20,
              "storey": "Level 1",
              "voids": 0,
            },
            {
              "footprintDigest": "2ed53b54e41f79d4",
              "obstructions": 0,
              "spaces": 20,
              "storey": "Level 2",
              "voids": 0,
            },
            {
              "footprintDigest": "472eae2f342417f3",
              "obstructions": 0,
              "spaces": 2,
              "storey": "Roof",
              "voids": 0,
            },
          ]
        `)
        expect(continuity.diagnostics).toMatchInlineSnapshot(`[]`)

        // Engineer pipe extraction: the empty prefix matches every IfcSystem.
        // Only the mesh-bounds fallback is origin-guarded, but the whole
        // endpoint set is pinned so any drift is caught.
        let pipeSummary: unknown
        try {
          const network = await extractEngineerPipeNetwork(api, modelId, { systemPrefixes: [''] })
          pipeSummary = {
            metersPerSourceUnit: network.metersPerSourceUnit,
            segments: network.segments.length,
            endpointSources: network.segments.reduce<Record<string, number>>((acc, segment) => {
              const key = String(segment.endpointSource)
              acc[key] = (acc[key] ?? 0) + 1
              return acc
            }, {}),
            endpointDigest: digest(
              network.segments.map((segment) => [
                segment.expressId,
                segment.start === null ? null : [round6(segment.start.x), round6(segment.start.y), round6(segment.start.z)],
                segment.end === null ? null : [round6(segment.end.x), round6(segment.end.y), round6(segment.end.z)],
              ]),
            ),
          }
        } catch (error) {
          pipeSummary = { error: String(error) }
        }
        expect(pipeSummary).toMatchInlineSnapshot(`
          {
            "endpointDigest": "4f53cda18c2baa0c",
            "endpointSources": {},
            "metersPerSourceUnit": 1,
            "segments": 0,
          }
        `)
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
