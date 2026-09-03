import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { probeContinuityCell } from '@/domain/continuityMap'
import type { Storey, StoreyId } from '@/domain/types'
import { WET_CORE_LINK_DISTANCE_M } from '@/domain/wetCores'
import { buildContinuityMapForModels, type ContinuityMapSource } from '@/shared/ifc/buildContinuityMapForModel'
import { detectMergedStoreyFixtures } from '@/shared/ifc/detectMergedStoreyFixtures'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { readBuildingPlacementSourcePoint } from '@/shared/ifc/readBuildingPlacement'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import { buildWetCoreSuggestedRisers } from './buildSuggestedRisers'
import { MAX_SNAP_M } from './suggestRisers'

// Gated V3 regression against the second real project (client data,
// gitignored; skips cleanly when absent): sanitary host (SA) + architecture
// (AR) + structure (ST), all IFC2X3 in centimetres, aligned by elevation. On
// the shared storey the merged fixture set (V0b + V2) is 18 toilets, 10
// basins, 3 sinks and 2 urinals; the structural file models the slabs and
// their openings, so the merged continuity map has real shaft candidates.
// The wet-core path must place ONE stack per core, every stack on a shaft
// candidate or a free cell, never inside a wall / column / slab cell.
const SA_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-SA.ifc')
const AR_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-AR.ifc')
const ST_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-ST.ifc')
const HOST_STOREY_ELEVATION_CM = 1800
const TEST_TIMEOUT_MS = 600_000

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

async function alignmentInput(api: IfcAPI, modelId: number, fileName: string, storeys: Storey[]): Promise<AlignmentModelInput> {
  return {
    fileName,
    lengthUnit: await resolveModelLengthUnit(api, modelId),
    storeys: storeys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation })),
    buildingPlacement: await readBuildingPlacementSourcePoint(api, modelId),
  }
}

const gated = describe.skipIf(!existsSync(SA_PATH) || !existsSync(AR_PATH) || !existsSync(ST_PATH))

gated('shbj SA + AR + ST wet-core placement (gated: requires local client files)', () => {
  it(
    'places one stack per wet core on the shared storey, each on a shaft candidate or free cell and never in an obstructed cell',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const saId = api.OpenModel(readFileSync(SA_PATH))
      const arId = api.OpenModel(readFileSync(AR_PATH))
      const stId = api.OpenModel(readFileSync(ST_PATH))

      try {
        const saStoreys = await parseStoreys(api, saId, 'shbj-sa')
        const arStoreys = await parseStoreys(api, arId, 'shbj-ar')
        const stStoreys = await parseStoreys(api, stId, 'shbj-st')
        const hostStorey = saStoreys.find((s) => Math.abs(s.elevation - HOST_STOREY_ELEVATION_CM) < 1)
        expect(hostStorey).toBeDefined()

        const hostInput = await alignmentInput(api, saId, 'SA.ifc', saStoreys)
        const linked = [
          { fileName: 'AR.ifc', modelId: arId, storeys: arStoreys },
          { fileName: 'ST.ifc', modelId: stId, storeys: stStoreys },
        ]
        const linkedStoreyForHost = new Map<string, StoreyId>()
        const sourceToHost = new Map<string, Map<StoreyId, StoreyId>>()
        for (const file of linked) {
          const alignment = alignStoreysByElevation(hostInput, await alignmentInput(api, file.modelId, file.fileName, file.storeys))
          expect(alignment.status, `${file.fileName} alignment`).toBe('aligned')
          const pair = alignment.pairs.find((entry) => entry.host.storeyId === hostStorey!.id)
          expect(pair, `${file.fileName} must align to the host storey`).toBeDefined()
          linkedStoreyForHost.set(file.fileName, pair!.linked.storeyId)
          sourceToHost.set(file.fileName, new Map(alignment.pairs.map((entry) => [entry.linked.storeyId, entry.host.storeyId])))
        }

        // Merged fixtures (host + both linked files) on the shared storey.
        const merged = await detectMergedStoreyFixtures(
          api,
          { webIfcModelId: saId, storeyId: hostStorey!.id, fileName: 'SA.ifc' },
          linked.map((file) => ({ webIfcModelId: file.modelId, storeyId: linkedStoreyForHost.get(file.fileName)!, fileName: file.fileName })),
        )
        const kindCounts: Record<string, number> = {}
        for (const fixture of merged.fixtures) kindCounts[fixture.kind] = (kindCounts[fixture.kind] ?? 0) + 1
        console.info('[shbj wet-core] merged fixtures', JSON.stringify(kindCounts), 'kitchens', merged.kitchens.length)
        expect(kindCounts.TOILETPAN).toBe(18)
        expect(merged.kitchens).toHaveLength(0)

        // ONE continuity map from all three files, scoped to the shared storey.
        const sources: ContinuityMapSource[] = [
          { fileName: 'SA.ifc', webIfcModelId: saId, lengthUnit: hostInput.lengthUnit, sourceToHostStoreyId: null, storeyIds: new Set([hostStorey!.id]) },
          ...linked.map((file) => ({
            fileName: file.fileName,
            webIfcModelId: file.modelId,
            lengthUnit: hostInput.lengthUnit,
            sourceToHostStoreyId: sourceToHost.get(file.fileName)!,
            storeyIds: new Set([linkedStoreyForHost.get(file.fileName)!]),
          })),
        ]
        const continuity = await buildContinuityMapForModels({ api, sources })
        const grid = continuity.map.grids.find((candidate) => candidate.storeyId === hostStorey!.id)
        const storeyCandidates = continuity.map.shaftCandidates.filter((candidate) => candidate.storeyIds.includes(hostStorey!.id))
        console.info(
          `[shbj wet-core] continuity: ${continuity.sourceFileNames.join(' + ')} in ${Math.round(continuity.extractMs)} ms extract / ${Math.round(continuity.buildMs)} ms build; ` +
            continuity.contributions
              .map((c) => `${c.fileName}: ${c.obstructionCount} obstructions, ${c.voidCount} voids, ${c.spaceCount} spaces${c.skippedReason ? ` (skipped: ${c.skippedReason})` : ''}`)
              .join('; ') +
            `; storey grid ${grid?.columns ?? 0}x${grid?.rows ?? 0} @ ${grid?.cellSize ?? 0} m, ${storeyCandidates.length} shaft candidates (${JSON.stringify(
              storeyCandidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.source]: (acc[c.source] ?? 0) + 1 }), {}),
            )})`,
        )
        expect(continuity.sourceFileNames).toEqual(['SA.ifc', 'AR.ifc', 'ST.ifc'])
        expect(grid).toBeDefined()
        // The structural file's slab openings reach the merged map as shaft candidates.
        expect(storeyCandidates.filter((candidate) => candidate.source === 'slab-opening').length).toBeGreaterThanOrEqual(20)

        const floorMeshes = await extractFloorMeshes(api, saId, hostStorey!.id)
        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys: saStoreys,
            sourceStoreyId: hostStorey!.id,
            fixtures: merged.fixtures,
            kitchens: merged.kitchens,
            floorMeshes,
            nextLabel: labeler(),
            wetCore: { planUnits: 'm', continuityMap: continuity.map },
          })
        const result = run()
        const coreStacks = result.stacks.filter((stack) => stack.anchor === 'wet-core')

        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          const members = Object.entries(stack.core.kindCounts)
            .map(([kind, count]) => `${count} ${kind}`)
            .join(' + ')
          console.info(
            `[shbj wet-core] ${stack.stackLabel}: core ${members} (bbox ${(stack.core.bbox.maxX - stack.core.bbox.minX).toFixed(1)} x ${(stack.core.bbox.maxZ - stack.core.bbox.minZ).toFixed(1)} m) → ${stack.placement.rule}` +
              ('distance' in stack.placement ? ` ${stack.placement.distance.toFixed(2)} m from centroid` : '') +
              `; ${stack.placement.reason}`,
          )
        }
        console.info(`[shbj wet-core] cores=${result.cores.length} stacks=${coreStacks.length} diagnostics=${JSON.stringify(result.diagnostics)}`)

        // ONE stack per core; every fixture belongs to exactly one core. The 33
        // merged fixtures form SEVEN wet cores at the 2.6 m link distance (the
        // brief estimated 2–4; measured, the floor has seven separate wet rooms /
        // fixture groups, and the smallest inter-core gap is printed below).
        expect(coreStacks).toHaveLength(result.cores.length)
        expect(result.cores.reduce((sum, core) => sum + core.members.length, 0)).toBe(merged.fixtures.length)
        expect(result.cores).toHaveLength(7)
        let smallestGap = Infinity
        for (let i = 0; i < result.cores.length; i++) {
          for (let j = i + 1; j < result.cores.length; j++) {
            const a = result.cores[i]
            const b = result.cores[j]
            const gap = Math.min(
              ...a.members.flatMap((fa) => b.members.map((fb) => Math.hypot(fa.position!.x - fb.position!.x, fa.position!.z - fb.position!.z))),
            )
            smallestGap = Math.min(smallestGap, gap)
            // Link distance is the documented 2.6 m: no two cores are closer than that.
            expect(gap).toBeGreaterThan(WET_CORE_LINK_DISTANCE_M)
          }
        }
        console.info(`[shbj wet-core] smallest fixture gap between two different cores: ${smallestGap.toFixed(2)} m`)

        // Placement: shaft candidate or free cell within MAX_SNAP of the core
        // footprint, never an obstructed cell. On this floor the slabs cover
        // ~93% of the grid, so a free cell is a slab opening (or an unslabbed
        // area) by construction — the log states which for every free-cell stack.
        let shaftSnaps = 0
        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          expect(['shaft', 'free-cell'], `${stack.stackLabel} placement rule`).toContain(stack.placement.rule)
          expect(stack.placement.flagged).toBe(false)
          if ('distance' in stack.placement) expect(stack.placement.distance).toBeLessThanOrEqual(MAX_SNAP_M + 1e-9)
          const probe = probeContinuityCell(continuity.map, hostStorey!.id, stack.position)
          expect(probe.status, `${stack.stackLabel} cell ${JSON.stringify(probe)}`).not.toBe('blocked')
          if (stack.placement.rule === 'shaft') shaftSnaps++
          else {
            const inside = storeyCandidates.filter(
              (candidate) =>
                stack.position.x >= candidate.bounds.minX &&
                stack.position.x <= candidate.bounds.maxX &&
                stack.position.z >= candidate.bounds.minZ &&
                stack.position.z <= candidate.bounds.maxZ,
            )
            console.info(
              `[shbj wet-core] ${stack.stackLabel} free cell lies inside ${inside.length} slab-opening footprint(s)` +
                (inside.length > 0 ? ` (${inside.map((c) => `${(c.bounds.maxX - c.bounds.minX).toFixed(2)}x${(c.bounds.maxZ - c.bounds.minZ).toFixed(2)} m`).join(', ')})` : ' — unslabbed area'),
            )
          }
        }
        // Measured: four cores snap onto structural slab openings, three onto free cells.
        expect(shaftSnaps).toBeGreaterThanOrEqual(4)

        // Determinism: same input → same cores, ids, positions and ordering.
        const second = run()
        expect(second.cores.map((core) => core.id)).toEqual(result.cores.map((core) => core.id))
        expect(second.stacks.map((stack) => [stack.stackLabel, stack.position])).toEqual(
          result.stacks.map((stack) => [stack.stackLabel, stack.position]),
        )
      } finally {
        api.CloseModel(saId)
        api.CloseModel(arId)
        api.CloseModel(stId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
