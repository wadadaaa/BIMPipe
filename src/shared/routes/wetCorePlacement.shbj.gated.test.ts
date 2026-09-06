import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'
import type { RouteSegment } from '@/domain/branchRouting'
import { probeContinuityCell, selectOfficeCoreShafts, type ShaftCandidate } from '@/domain/continuityMap'
import { TYPOLOGY_PLACEMENT_RULES } from '@/domain/typology'
import type { Storey, StoreyId } from '@/domain/types'
import { WET_CORE_LINK_DISTANCE_M } from '@/domain/wetCores'
import { buildContinuityMapForModels, type ContinuityMapSource } from '@/shared/ifc/buildContinuityMapForModel'
import { detectMergedStoreyFixtures } from '@/shared/ifc/detectMergedStoreyFixtures'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { readBuildingPlacementSourcePoint } from '@/shared/ifc/readBuildingPlacement'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import { buildBranchRoutesFromAssignments } from './buildBranchRoutes'
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

interface ShbjFloor {
  api: IfcAPI
  close: () => void
  saStoreys: Storey[]
  hostStorey: Storey
  merged: Awaited<ReturnType<typeof detectMergedStoreyFixtures>>
  continuity: Awaited<ReturnType<typeof buildContinuityMapForModels>>
  storeyCandidates: ShaftCandidate[]
  floorMeshes: Awaited<ReturnType<typeof extractFloorMeshes>>
}

/** Opens SA + AR + ST, aligns them, merges the shared storey's fixtures and builds ONE continuity map. */
async function loadShbjFloor(): Promise<ShbjFloor> {
  const ifc = await import('web-ifc')
  const api = new ifc.IfcAPI()
  await api.Init()
  const saId = api.OpenModel(readFileSync(SA_PATH))
  const arId = api.OpenModel(readFileSync(AR_PATH))
  const stId = api.OpenModel(readFileSync(ST_PATH))
  const close = () => {
    api.CloseModel(saId)
    api.CloseModel(arId)
    api.CloseModel(stId)
  }

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
  const storeyCandidates = continuity.map.shaftCandidates.filter((candidate) => candidate.storeyIds.includes(hostStorey!.id))
  const floorMeshes = await extractFloorMeshes(api, saId, hostStorey!.id)
  return { api, close, saStoreys, hostStorey: hostStorey!, merged, continuity, storeyCandidates, floorMeshes }
}

gated('shbj SA + AR + ST wet-core placement (gated: requires local client files)', () => {
  it(
    'places one stack per wet core on the shared storey, each on a shaft candidate or free cell and never in an obstructed cell',
    async () => {
      const floor = await loadShbjFloor()
      const { saStoreys, hostStorey, merged, continuity, storeyCandidates, floorMeshes } = floor

      try {
        const kindCounts: Record<string, number> = {}
        for (const fixture of merged.fixtures) kindCounts[fixture.kind] = (kindCounts[fixture.kind] ?? 0) + 1
        console.info('[shbj wet-core] merged fixtures', JSON.stringify(kindCounts), 'kitchens', merged.kitchens.length)
        expect(kindCounts.TOILETPAN).toBe(18)
        expect(merged.kitchens).toHaveLength(0)

        const grid = continuity.map.grids.find((candidate) => candidate.storeyId === hostStorey.id)
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

        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys: saStoreys,
            sourceStoreyId: hostStorey.id,
            fixtures: merged.fixtures,
            kitchens: merged.kitchens,
            floorMeshes,
            nextLabel: labeler(),
            wetCore: { planUnits: 'm', continuityMap: continuity.map },
          })
        const result = run()
        // Residential is the default: an explicit typology is byte-identical (G3 pin).
        const explicitResidential = buildWetCoreSuggestedRisers({
          storeys: saStoreys,
          sourceStoreyId: hostStorey.id,
          fixtures: merged.fixtures,
          kitchens: merged.kitchens,
          floorMeshes,
          nextLabel: labeler(),
          wetCore: { planUnits: 'm', continuityMap: continuity.map, typology: 'residential' },
        })
        // (riser / stack ids are fresh UUIDs per run, so compare everything else)
        const withoutIds = (value: typeof result) =>
          JSON.parse(
            JSON.stringify(value, (key, entry: unknown) =>
              (key === 'id' || key === 'stackId') && typeof entry === 'string' && /^[0-9a-f-]{36}$/.test(entry) ? undefined : entry,
            ),
          ) as unknown
        expect(withoutIds(explicitResidential)).toEqual(withoutIds(result))
        expect(result.typology).toBe('residential')
        expect(result.fixtureRows).toEqual([])
        expect(result.officeCoreShafts).toEqual([])
        const coreStacks = result.stacks.filter((stack) => stack.anchor === 'wet-core')

        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          const members = Object.entries(stack.core.kindCounts)
            .map(([kind, count]) => `${count} ${kind}`)
            .join(' + ')
          console.info(
            `[shbj wet-core] ${stack.stackLabel}: core ${members} (bbox ${(stack.core.bbox.maxX - stack.core.bbox.minX).toFixed(1)} x ${(stack.core.bbox.maxZ - stack.core.bbox.minZ).toFixed(1)} m) → ${stack.placement.rule}` +
              ('distance' in stack.placement ? ` ${stack.placement.distance.toFixed(2)} m from the core footprint` : '') +
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
          const probe = probeContinuityCell(continuity.map, hostStorey.id, stack.position)
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
        floor.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'office typology: stacks only on core shafts (or flagged), toilet rows drain through collectors, every fixture routed',
    async () => {
      const floor = await loadShbjFloor()
      const { saStoreys, hostStorey, merged, continuity, storeyCandidates, floorMeshes } = floor
      const log = (line: string) => console.info(`[shbj office] ${line}`)

      try {
        const rules = TYPOLOGY_PLACEMENT_RULES.office
        const shaftRules = rules.coreShafts!

        // --- core-shaft selection, reported per candidate -----------------------
        const selection = selectOfficeCoreShafts(continuity.map, hostStorey.id, shaftRules)
        expect(selection.candidates).toHaveLength(storeyCandidates.length)
        log(
          `core shafts: ${selection.selected.length}/${selection.candidates.length} selected; ` +
            `${selection.denseClusters.length} dense-structure cluster(s) (window ${shaftRules.denseWindowM} m, density ≥ ${shaftRules.denseStructureMinDensity}), ` +
            `${selection.largeVoids.length} stair/lift void anchor(s) (≥ ${shaftRules.largeVoidMinAreaM2} m²); ${selection.diagnostics.join('; ')}`,
        )
        for (const cluster of selection.denseClusters) {
          log(
            `dense cluster ${cluster.id}: ${(cluster.bounds.maxX - cluster.bounds.minX).toFixed(1)} x ${(cluster.bounds.maxZ - cluster.bounds.minZ).toFixed(1)} m, ` +
              `${cluster.windowCount} window(s), peak density ${cluster.peakDensity.toFixed(2)}`,
          )
        }
        for (const anchor of selection.largeVoids) {
          log(`void anchor ${anchor.areaM2.toFixed(1)} m² (${anchor.repeating ? 'repeats on ≥ 3 storeys' : 'single-storey opening'})`)
        }
        const rejectionCounts: Record<string, number> = {}
        for (const candidate of selection.candidates) {
          if (candidate.selected) {
            log(
              `selected ${candidate.areaM2.toFixed(2)} m² (aspect ${candidate.aspectRatio.toFixed(1)}) — dense-structure ${candidate.distanceToDenseStructureM?.toFixed(2) ?? '—'} m, ` +
                `stair/lift void ${candidate.distanceToLargeVoidM?.toFixed(2) ?? '—'} m → ${candidate.coreAnchor}`,
            )
          } else {
            rejectionCounts[candidate.rejection ?? 'unknown'] = (rejectionCounts[candidate.rejection ?? 'unknown'] ?? 0) + 1
          }
        }
        log(`rejected by reason: ${JSON.stringify(rejectionCounts)}`)
        expect(selection.selected.length).toBeGreaterThan(0)
        for (const candidate of selection.candidates.filter((entry) => entry.selected)) {
          expect(candidate.areaM2).toBeGreaterThanOrEqual(shaftRules.shaftMinAreaM2)
          expect(candidate.areaM2).toBeLessThanOrEqual(shaftRules.shaftMaxAreaM2)
          expect(candidate.aspectRatio).toBeLessThanOrEqual(shaftRules.shaftMaxAspectRatio)
          const nearest = Math.min(candidate.distanceToDenseStructureM ?? Infinity, candidate.distanceToLargeVoidM ?? Infinity)
          expect(nearest).toBeLessThanOrEqual(shaftRules.coreRadiusM + 1e-9)
        }

        // --- office suggestion --------------------------------------------------
        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys: saStoreys,
            sourceStoreyId: hostStorey.id,
            fixtures: merged.fixtures,
            kitchens: merged.kitchens,
            floorMeshes,
            nextLabel: labeler(),
            // The option G2 passes from the CLI spec: `wetCore.typology`.
            wetCore: { planUnits: 'm', continuityMap: continuity.map, typology: 'office' },
          })
        const result = run()
        expect(result.typology).toBe('office')
        expect(result.officeCoreShafts).toHaveLength(1)
        expect(result.officeCoreShafts[0].selected.map((c) => c.id)).toEqual(selection.selected.map((c) => c.id))
        const coreStacks = result.stacks.filter((stack) => stack.anchor === 'wet-core')
        // Clustering is typology-independent: the same seven cores as residential.
        expect(result.cores).toHaveLength(7)
        expect(coreStacks).toHaveLength(7)

        const selectedIds = new Set(selection.selected.map((candidate) => candidate.id))
        let onCoreShaft = 0
        let flagged = 0
        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          const members = Object.entries(stack.core.kindCounts)
            .map(([kind, count]) => `${count} ${kind}`)
            .join(' + ')
          log(
            `${stack.stackLabel}: core ${members} → ${stack.placement.rule}${stack.placement.flagged ? ' (FLAGGED)' : ''}` +
              ('distance' in stack.placement ? ` ${stack.placement.distance.toFixed(2)} m from the core footprint` : '') +
              `; ${stack.placement.reason}`,
          )
          // Office rule: a stack is either on a SELECTED core shaft within the
          // office snap radius, or explicitly flagged at the centroid — never a
          // free cell / wall-side guess, never inside an obstruction.
          if (stack.placement.rule === 'shaft') {
            expect(selectedIds.has(stack.placement.shaftId), `${stack.stackLabel} shaft ${stack.placement.shaftId} must be a core shaft`).toBe(true)
            expect(stack.placement.distance).toBeLessThanOrEqual(rules.maxSnapM + 1e-9)
            expect(stack.placement.flagged).toBe(false)
            onCoreShaft++
          } else {
            expect(stack.placement.rule).toBe('centroid')
            expect(stack.placement.flagged).toBe(true)
            flagged++
          }
          const probe = probeContinuityCell(continuity.map, hostStorey.id, stack.position)
          if (stack.placement.rule === 'shaft') expect(probe.status, `${stack.stackLabel} cell ${JSON.stringify(probe)}`).not.toBe('blocked')
          else log(`${stack.stackLabel} flagged centroid cell: ${probe.status}`)
        }
        const distinctShafts = new Set(
          coreStacks.flatMap((stack) => (stack.anchor === 'wet-core' && stack.placement.rule === 'shaft' ? [stack.placement.shaftId] : [])),
        )
        log(`stacks=${coreStacks.length} onCoreShaft=${onCoreShaft} flagged=${flagged} distinctCoreShafts=${distinctShafts.size} (residential run: 7 stacks, 4 shaft + 3 free cell)`)
        log(`diagnostics=${JSON.stringify(result.diagnostics)}`)
        expect(coreStacks.length).toBeLessThanOrEqual(7)

        // --- rows and collectors -------------------------------------------------
        for (const row of result.fixtureRows) {
          log(
            `row ${row.memberExpressIds.length}× ${row.kind} along ${row.axis}: ${(row.alongMax - row.alongMin).toFixed(2)} m long, max spacing ${row.maxSpacing.toFixed(2)} m, ` +
              `collector ${row.side > 0 ? '+' : '−'}${row.axis === 'x' ? 'z' : 'x'} (${row.sideReason}); ${row.reason}`,
          )
        }
        const wcRows = result.fixtureRows.filter((row) => row.kind === 'TOILETPAN').map((row) => row.memberExpressIds.length).sort((a, b) => b - a)
        // The 6-WC and the 4-WC rows (residential R3 / R1 cores) gather into collectors.
        expect(wcRows).toContain(6)
        expect(wcRows).toContain(4)

        // Assignment by wet-core membership with the office branch limit, then routing with row collectors.
        const fixtureCoreIds = new Map<number, string>()
        for (const core of result.cores) for (const expressId of core.memberExpressIds) fixtureCoreIds.set(expressId, core.id)
        const stackCoreIds = new Map<string, string>()
        for (const stack of result.stacks) if (stack.anchor === 'wet-core') stackCoreIds.set(stack.stackId, stack.core.id)
        const storeyRisers = result.risers.filter((riser) => riser.storeyId === hostStorey.id)
        const assignments = assignFixturesToRisers(
          merged.fixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          storeyRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm', coreMembership: { fixtureCoreIds, stackCoreIds }, typology: 'office' },
        )
        const routed = assignments.filter((assignment) => !assignment.unassigned)
        const overlength = routed.filter((assignment) => assignment.exceedsMaxBranchLength)
        const longest = Math.max(...routed.map((assignment) => assignment.planDistance))
        log(
          `routed ${routed.length}/${merged.fixtures.length}; over the ${rules.branchLengthLimitM} m office placeholder: ${overlength.length}; longest fixture→stack plan distance ${longest.toFixed(2)} m`,
        )
        expect(routed).toHaveLength(merged.fixtures.length)
        expect(overlength.length).toBeLessThan(merged.fixtures.length)

        const routes = buildBranchRoutesFromAssignments(assignments, { rowCollectors: result.fixtureRows })
        expect(routes).toHaveLength(1)
        const segments = routes[0].segments
        const segLength = (segment: RouteSegment) => Math.abs(segment.start.x - segment.end.x) + Math.abs(segment.start.z - segment.end.z)
        for (const row of result.fixtureRows) {
          const stubs = segments.filter((segment) => segment.role === 'row-stub' && segment.rowId === row.id)
          const collectors = segments.filter((segment) => segment.role === 'row-collector' && segment.rowId === row.id)
          const collectorLength = collectors.reduce((sum, segment) => sum + segLength(segment), 0)
          const diameters = [...new Set(collectors.map((segment) => segment.diameterMm))].sort((a, b) => a - b)
          log(
            `row ${row.memberExpressIds.length}× ${row.kind}: ${stubs.length} stub(s), ${collectors.length} collector segment(s) totalling ${collectorLength.toFixed(2)} m, Ø${diameters.join('/')}`,
          )
          expect(stubs).toHaveLength(row.memberExpressIds.length)
          expect(collectors).toHaveLength(row.memberExpressIds.length - 1)
          expect(collectorLength).toBeCloseTo(row.alongMax - row.alongMin, 2)
          if (row.kind === 'TOILETPAN') expect(diameters).toEqual([110])
        }
        const runs = segments.filter((segment) => segment.role === 'collector-run')
        log(
          `segments=${segments.length} (stubs ${segments.filter((s) => s.role === 'row-stub').length}, collectors ${segments.filter((s) => s.role === 'row-collector').length}, ` +
            `collector runs ${runs.length}, plain ${segments.filter((s) => s.role === undefined).length}); total ${segments.reduce((sum, s) => sum + segLength(s), 0).toFixed(2)} m`,
        )
        expect(runs.length).toBeGreaterThan(0)
        expect(segments.every((segment) => segLength(segment) > 0)).toBe(true)

        // Determinism.
        const second = run()
        expect(second.stacks.map((stack) => [stack.stackLabel, stack.position])).toEqual(result.stacks.map((stack) => [stack.stackLabel, stack.position]))
        expect(second.fixtureRows).toEqual(result.fixtureRows)
      } finally {
        floor.close()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
