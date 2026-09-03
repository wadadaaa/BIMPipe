import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'
import { probeContinuityCell } from '@/domain/continuityMap'
import {
  classifyEngineerRiserStacks,
  stacksIntersectingBand,
  storeySlabBandM,
} from '@/domain/engineerPipes'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea, Storey } from '@/domain/types'
import { buildContinuityMapForModels, type ContinuityMapSource } from '@/shared/ifc/buildContinuityMapForModel'
import { detectMergedStoreyFixtures } from '@/shared/ifc/detectMergedStoreyFixtures'
import { extractContinuityStoreyInputs } from '@/shared/ifc/extractContinuityInputs'
import { extractEngineerPipeNetwork } from '@/shared/ifc/extractEngineerPipeNetwork'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { readBuildingPlacementSourcePoint } from '@/shared/ifc/readBuildingPlacement'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import { buildWetCoreSuggestedRisers } from './buildSuggestedRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'

// Gated V3 regression against the first real project (client data, gitignored;
// skips cleanly when absent): the engineer's plumbing model (host) plus the
// architecture podium model (linked), which covers storeys SL..01 only — so
// the continuity map exists exactly on the storey suggested from. Storey "01"
// carries 11 WCs and no other fixture kind; the engineer's own SW-GRV stacks
// intersecting that storey (V1's honest definition) bound how many stacks the
// wet-core path may propose there.
const IFC_096_P_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')
const IFC_096_A_PATH = path.resolve(process.cwd(), 'external/projects/096/096-A.ifc')
const SOURCE_STOREY_NAME = '01'
const TEST_TIMEOUT_MS = 600_000

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

async function alignmentInput(
  api: import('web-ifc').IfcAPI,
  modelId: number,
  fileName: string,
  storeys: Storey[],
): Promise<AlignmentModelInput> {
  return {
    fileName,
    lengthUnit: await resolveModelLengthUnit(api, modelId),
    storeys: storeys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
    buildingPlacement: await readBuildingPlacementSourcePoint(api, modelId),
  }
}

const gated = describe.skipIf(!existsSync(IFC_096_P_PATH) || !existsSync(IFC_096_A_PATH))

gated('096-P + 096-A wet-core placement on storey 01 (gated: requires local client files)', () => {
  it(
    'proposes at most 1.5x the engineer stacks intersecting the storey, never in an obstructed cell, and every toilet reaches a stack',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const hostId = api.OpenModel(readFileSync(IFC_096_P_PATH))
      const linkedId = api.OpenModel(readFileSync(IFC_096_A_PATH))

      try {
        const hostStoreys = await parseStoreys(api, hostId, '096-p')
        const linkedStoreys = await parseStoreys(api, linkedId, '096-a')
        const source = hostStoreys.find((s) => s.name === SOURCE_STOREY_NAME)
        expect(source).toBeDefined()

        const hostInput = await alignmentInput(api, hostId, '096-P.ifc', hostStoreys)
        const alignment = alignStoreysByElevation(hostInput, await alignmentInput(api, linkedId, '096-A.ifc', linkedStoreys))
        expect(alignment.status).toBe('aligned')
        const sourcePair = alignment.pairs.find((pair) => pair.host.storeyId === source!.id)
        expect(sourcePair, 'storey 01 must align to the architecture podium').toBeDefined()
        const sourceToHost = new Map(alignment.pairs.map((pair) => [pair.linked.storeyId, pair.host.storeyId]))

        // --- engineer baseline (V1): SW-GRV stacks intersecting storey 01 ---
        const network = await extractEngineerPipeNetwork(api, hostId, { systemPrefixes: ['SW-GRV', 'VNT'] })
        const classification = classifyEngineerRiserStacks(network)
        const band = storeySlabBandM(network, source!.id)
        expect(band).not.toBeNull()
        const engineerStacks = stacksIntersectingBand(classification.sanitaryStacks, band!)
        expect(engineerStacks.length).toBeGreaterThan(0)

        // --- whole-building fixtures for the V4 stack extent (host + linked, all kinds) ---
        const linkedTargetsFor = (storeyId: number) => {
          const pair = alignment.pairs.find((entry) => entry.host.storeyId === storeyId)
          return pair === undefined ? [] : [{ webIfcModelId: linkedId, storeyId: pair.linked.storeyId, fileName: '096-A.ifc' }]
        }
        const scanStart = performance.now()
        const aggregated = await aggregateStoreyDetections(
          api,
          hostId,
          hostStoreys,
          DEFAULT_RISER_PLACEMENT_RULE_PROFILE,
          undefined,
          { linkedTargetsFor, hostFileName: '096-P.ifc' },
        )
        const scanMs = Math.round(performance.now() - scanStart)
        const buildingFixtures: Fixture[] = Object.values(aggregated.fixturesByStoreyId).flat()
        const buildingKitchens: KitchenArea[] = Object.values(aggregated.kitchensByStoreyId).flat()
        const kinds = new Set(buildingFixtures.map((fixture) => fixture.kind))
        console.info(
          `[096 wet-core] whole-building aggregation (host + linked podium) in ${scanMs} ms: ${buildingFixtures.length} fixtures of kinds ${[...kinds].sort().join(', ')}, ${buildingKitchens.length} kitchens`,
        )
        // All kinds are kept (not only toilets) — the podium's basins prove it.
        expect(kinds.size).toBeGreaterThan(1)

        // --- storey 01 merged fixtures ---
        const merged = await detectMergedStoreyFixtures(
          api,
          { webIfcModelId: hostId, storeyId: source!.id, fileName: '096-P.ifc' },
          linkedTargetsFor(source!.id),
        )
        const toilets = merged.fixtures.filter((fixture) => fixture.kind === 'TOILETPAN')
        console.info(
          `[096 wet-core] storey 01 merged fixtures: ${merged.fixtures.length} (${toilets.length} WC), kitchens ${merged.kitchens.length}, duplicates ${merged.duplicates.length}`,
        )
        expect(toilets.length).toBeGreaterThanOrEqual(11)

        // --- continuity map from both files, scoped to storey 01 ---
        const sources: ContinuityMapSource[] = [
          { fileName: '096-P.ifc', webIfcModelId: hostId, lengthUnit: hostInput.lengthUnit, sourceToHostStoreyId: null, storeyIds: new Set([source!.id]) },
          {
            fileName: '096-A.ifc',
            webIfcModelId: linkedId,
            lengthUnit: hostInput.lengthUnit,
            sourceToHostStoreyId: sourceToHost,
            storeyIds: new Set([sourcePair!.linked.storeyId]),
          },
        ]
        const continuity = await buildContinuityMapForModels({ api, sources })
        const grid = continuity.map.grids.find((candidate) => candidate.storeyId === source!.id)
        const candidates = continuity.map.shaftCandidates.filter((candidate) => candidate.storeyIds.includes(source!.id))
        const blockedCells = grid === undefined ? 0 : grid.blocked.reduce<number>((sum, cell) => sum + cell, 0)
        console.info(
          `[096 wet-core] continuity (${continuity.sourceFileNames.join(' + ')}, ${Math.round(continuity.extractMs)} ms): ` +
            continuity.contributions.map((c) => `${c.fileName}: ${c.obstructionCount} obstructions, ${c.voidCount} voids, ${c.spaceCount} spaces`).join('; ') +
            `; storey grid ${grid?.columns ?? 0}x${grid?.rows ?? 0}, blocked ${blockedCells}/${grid?.blocked.length ?? 0}, shaft candidates ${candidates.length} ` +
            JSON.stringify(candidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {})),
        )
        expect(continuity.sourceFileNames).toContain('096-A.ifc')
        expect(grid).toBeDefined()
        expect(blockedCells).toBeGreaterThan(0)
        // What the podium file yields on this storey, by element kind (measured:
        // 4 slabs + 2 walls; no columns, openings or spaces are assigned to it).
        const podium = await extractContinuityStoreyInputs(api, linkedId, { storeyIds: new Set([sourcePair!.linked.storeyId]) })
        const podiumKinds: Record<string, number> = {}
        for (const storey of podium.storeys) {
          for (const obstruction of storey.obstructions) podiumKinds[obstruction.kind] = (podiumKinds[obstruction.kind] ?? 0) + 1
        }
        console.info(`[096 wet-core] podium storey 01 obstruction kinds ${JSON.stringify(podiumKinds)}; voids ${podium.storeys.reduce((sum, s) => sum + s.voids.length, 0)}`)

        // --- wet-core suggestion with the V4 extent ---
        const floorMeshes = await extractFloorMeshes(api, hostId, source!.id)
        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys: hostStoreys,
            sourceStoreyId: source!.id,
            fixtures: merged.fixtures,
            kitchens: merged.kitchens,
            floorMeshes,
            nextLabel: labeler(),
            wetCore: { planUnits: 'm', continuityMap: continuity.map },
            stackExtent: {
              buildingFixtures: toStackExtentFixtures(buildingFixtures, buildingKitchens),
              planUnits: 'm',
              continuityMap: continuity.map,
            },
          })
        const result = run()
        const coreStacks = result.stacks.filter((stack) => stack.anchor === 'wet-core')
        const rules: Record<string, number> = {}
        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          rules[stack.placement.rule] = (rules[stack.placement.rule] ?? 0) + 1
          const members = Object.entries(stack.core.kindCounts).map(([kind, count]) => `${count} ${kind}`).join(' + ')
          const extent = result.stackExtents.find((entry) => entry.stackLabel === stack.stackLabel)
          console.info(
            `[096 wet-core] ${stack.stackLabel}: core ${members} → ${stack.placement.rule}${stack.placement.flagged ? ' (FLAGGED)' : ''}; ${stack.placement.reason}` +
              (extent === undefined ? '' : `; extent ${extent.extent.storeyIds.length} storeys`),
          )
        }
        const ratio = coreStacks.length / engineerStacks.length
        console.info(
          `[096 wet-core] cores=${result.cores.length} stacks=${coreStacks.length} (${JSON.stringify(rules)}); ` +
            `engineer sanitary stacks intersecting storey 01: ${engineerStacks.length}; ratio ${ratio.toFixed(2)}`,
        )

        // Measured: 11 WC + 2 basins form 10 cores; the engineer runs 15 sanitary
        // stacks through this storey (ratio 0.67).
        expect(coreStacks).toHaveLength(result.cores.length)
        expect(result.cores).toHaveLength(10)
        expect(coreStacks.length).toBeLessThanOrEqual(1.5 * engineerStacks.length)
        expect(result.stackExtents).toHaveLength(result.stacks.length)

        // The podium file models storey 01 as slabs without a single opening, so a
        // stack can only sit in a free cell where the slab footprints leave a gap
        // (five cores) or — when every cell within reach is solid slab — stay at
        // the centroid FLAGGED with an explicit reason (five cores). No stack is
        // ever placed in an obstructed cell silently: obstructed ⇔ flagged.
        let flagged = 0
        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          const probe = probeContinuityCell(continuity.map, source!.id, stack.position)
          if (stack.placement.flagged) {
            flagged++
            expect(stack.placement.rule).toBe('centroid')
            expect(stack.placement.reason).toMatch(/obstructed/)
          } else {
            expect(probe.status, `${stack.stackLabel} ${JSON.stringify(probe)}`).not.toBe('blocked')
          }
        }
        console.info(`[096 wet-core] flagged (obstructed-centroid) stacks: ${flagged} of ${coreStacks.length}`)
        expect(flagged).toBeLessThanOrEqual(5)

        // Every toilet on the storey is assigned to a stack within MAX_BRANCH_LENGTH.
        const sourceRisers = result.risers.filter((riser) => riser.storeyId === source!.id)
        const assignments = assignFixturesToRisers(
          toilets.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          sourceRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm' },
        )
        const unassigned = assignments.filter((assignment) => assignment.unassigned)
        console.info(
          `[096 wet-core] toilets assigned ${assignments.length - unassigned.length}/${assignments.length}` +
            (unassigned.length > 0 ? `; unassigned: ${JSON.stringify(unassigned.map((entry) => entry.reason))}` : ''),
        )
        expect(unassigned).toHaveLength(0)

        // Determinism.
        const second = run()
        expect(second.cores.map((core) => core.id)).toEqual(result.cores.map((core) => core.id))
        expect(second.stackExtents).toEqual(result.stackExtents)
      } finally {
        api.CloseModel(hostId)
        api.CloseModel(linkedId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
