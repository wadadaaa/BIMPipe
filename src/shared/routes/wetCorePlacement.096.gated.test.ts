import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { alignStoreysByElevation, type AlignmentModelInput } from '@/domain/alignStoreys'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'
import { probeContinuityCell } from '@/domain/continuityMap'
import { computeEngineerComparison } from '@/domain/engineerComparisonMetrics'
import { buildFixtureCoreIds } from '@/domain/coreCollectors'
import {
  classifyEngineerRiserStacks,
  selectEngineerBranchSegments,
  selectEngineerServedStacks,
  selectEngineerStoreyHorizontals,
  stacksIntersectingBand,
  storeySlabBandM,
} from '@/domain/engineerPipes'
import { RESIDENTIAL_COLLECTOR_MAX_M } from '@/domain/typology'
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
import { buildBranchRoutesFromAssignments } from './buildBranchRoutes'
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
/**
 * Measured branch-length ratios ours/engineer on storey 01 (see the V5 block
 * below). R1: ours 19.92 m over 23 run segments (V5 measured 7.82 m / 16 —
 * the two core collectors add 6.64 + 5.21 m of run plus the members' legs to
 * their junctions). Engineer: 6.16 m over 12 horizontal SW-GRV segments in
 * the literal storey band → 3.23; 71.66 m over 125 runs in the union with the
 * 1.2 m hang band → 0.28 (reported as the full-set ratio). The union ratio is
 * far below 0.5 on this storey: 58 m of the engineer's 71.7 m are Ø50/Ø63 runs
 * to basins, showers and machines that neither file models as fixtures on this
 * storey (13 detected: 11 WC + 2 basins; R2 investigation), so our side has
 * nothing to route there — a fixture-coverage gap, reported as such, not tuned
 * away. Since R2 the harness gates the shared-fixture ratio instead
 * (`computeSharedFixtureSet`, pinned in `engineerFloorDrawing.096.gated.test.ts`).
 */
const RATIO_096_STOREY_01_LITERAL_PIN = 3.23
const RATIO_096_STOREY_01_UNION_PIN = 0.28
const OURS_096_STOREY_01_BRANCH_M = 19.92

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
        // R1 served-stack rule: only stacks a storey-01 horizontal joins (within
        // 0.5 m) count as the storey's stacks; the rest pass through. Measured
        // 15 → 12 (risers 12, 14, 18 have no run of this storey).
        const servedStacks = selectEngineerServedStacks(
          engineerStacks,
          selectEngineerStoreyHorizontals(network, band!).horizontals,
          network.metersPerSourceUnit,
        )
        expect(engineerStacks).toHaveLength(15)
        expect(servedStacks.served).toHaveLength(12)
        expect(servedStacks.passThrough).toHaveLength(3)

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
        for (const collector of result.coreCollectors) {
          console.info(`[096 wet-core] collector ${collector.coreId} → ${collector.targetCoreId}: ${collector.lengthManhattan.toFixed(2)} m; ${collector.reason}`)
        }
        const ratio = coreStacks.length / servedStacks.served.length
        console.info(
          `[096 wet-core] cores=${result.cores.length} stacks=${coreStacks.length} (${JSON.stringify(rules)}) collectors=${result.coreCollectors.length}; ` +
            `engineer sanitary stacks intersecting storey 01: ${engineerStacks.length}, served ${servedStacks.served.length}; ratio ${ratio.toFixed(2)}`,
        )

        // Measured: 11 WC + 2 basins form 10 cores. R1: 8 stacks + 2 core
        // collectors (the two cores whose 1.5 m snap window is entirely solid
        // slab / wall drain to a neighbour's stack 4–7 m away instead of a
        // flagged stack on a blocked cell); the engineer runs 12 served
        // sanitary stacks through this storey (ratio 0.67, within [0.6, 1.5]).
        expect(result.cores).toHaveLength(10)
        expect(result.coreCollectors).toHaveLength(2)
        expect(coreStacks).toHaveLength(result.cores.length - result.coreCollectors.length)
        expect(ratio).toBeGreaterThanOrEqual(0.6)
        expect(ratio).toBeLessThanOrEqual(1.5)
        expect(result.stackExtents).toHaveLength(result.stacks.length)
        for (const collector of result.coreCollectors) {
          expect(collector.lengthManhattan).toBeLessThanOrEqual(RESIDENTIAL_COLLECTOR_MAX_M)
          expect(coreStacks.some((stack) => stack.core.id === collector.targetCoreId)).toBe(true)
          expect(coreStacks.some((stack) => stack.core.id === collector.coreId)).toBe(false)
        }

        // The podium file models storey 01 as slabs without a single opening, so a
        // stack can only sit in a free cell where the slab footprints leave a gap
        // (five cores), fall back to the wall-side edge where the podium grid does
        // not reach the core at all (three cores: the grid says nothing there — V3
        // flagged them as "obstructed", R1 corrects that), or be gathered (two
        // cores). No stack is ever placed in an obstructed cell silently: every
        // remaining stack probes free or unknown, none is flagged.
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
        expect(flagged).toBe(0)
        expect(rules).toEqual({ 'wall-side-edge': 3, 'free-cell': 5 })

        // Every toilet on the storey reaches a stack: through its own core's stack
        // within MAX_BRANCH_LENGTH, or — for the two gathered cores (R1) — through
        // the collector to the neighbour's stack, kept with the over-length WARNING
        // visible (5.2 / 6.6 m, within the 8 m collector limit, beyond the 4 m branch limit).
        const sourceRisers = result.risers.filter((riser) => riser.storeyId === source!.id)
        const toiletCoreIds = buildFixtureCoreIds(result.cores, result.coreCollectors)
        const toiletStackCoreIds = new Map(coreStacks.map((stack) => [stack.stackId, stack.core.id]))
        const assignments = assignFixturesToRisers(
          toilets.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          sourceRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm', coreMembership: { fixtureCoreIds: toiletCoreIds, stackCoreIds: toiletStackCoreIds } },
        )
        const unassigned = assignments.filter((assignment) => assignment.unassigned)
        const overLength = assignments.filter((assignment) => !assignment.unassigned && assignment.exceedsMaxBranchLength)
        const gatheredExpressIds = new Set(result.coreCollectors.flatMap((collector) => collector.memberExpressIds))
        console.info(
          `[096 wet-core] toilets assigned ${assignments.length - unassigned.length}/${assignments.length}; over the branch limit (gathered): ${overLength.length}` +
            (unassigned.length > 0 ? `; unassigned: ${JSON.stringify(unassigned.map((entry) => entry.reason))}` : ''),
        )
        expect(unassigned).toHaveLength(0)
        expect(overLength.map((assignment) => assignment.fixtureExpressId).sort()).toEqual([...gatheredExpressIds].sort())

        // --- V5 acceptance metric: branch-run length on storey 01 vs the engineer ---
        // Ours: every merged fixture on the storey routes to ITS core's stack
        // (wet-core membership, as the branch-runs routing model does), and the
        // plan lengths of the resulting runs are summed. Engineer: Pset lengths of
        // the horizontal SW-GRV segments whose centreline lies in the storey's
        // slab band (V1's storey scope, applied literally). Lengths are
        // frame-independent, so no plan-frame alignment is needed here.
        const fixtureCoreIds = buildFixtureCoreIds(result.cores, result.coreCollectors)
        const stackCoreIds = new Map<string, string>()
        for (const stack of coreStacks) if (stack.anchor === 'wet-core') stackCoreIds.set(stack.stackId, stack.core.id)
        const allAssignments = assignFixturesToRisers(
          merged.fixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          sourceRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm', coreMembership: { fixtureCoreIds, stackCoreIds } },
        )
        const byCore = allAssignments.filter((a) => !a.unassigned && a.assignedBy === 'wet-core').length
        const branchRoutes = buildBranchRoutesFromAssignments(allAssignments, { coreCollectors: result.coreCollectors })
        // The gathered cores' fixtures reach a stack through their collector run (R1).
        const collectorRuns = branchRoutes.flatMap((floor) => floor.segments.filter((segment) => segment.role === 'collector-run'))
        expect(new Set(collectorRuns.map((segment) => segment.coreCollectorId)).size).toBe(result.coreCollectors.length)
        expect(byCore).toBe(merged.fixtures.filter((fixture) => fixture.position !== null).length)
        const engineerBranches = selectEngineerBranchSegments(network, band!)
        const comparison = computeEngineerComparison({
          ourRisers: result.risers,
          ourRiserUnits: 'm',
          ourBranchRoutes: branchRoutes,
          ourAssignments: allAssignments,
          engineerRisers: classification,
          storeyScope: { ourStoreyId: source!.id, engineerBandM: band },
          engineerSegments: engineerBranches.segments,
        })
        const { branchLengths } = comparison
        // Diagnostic only: drainage serving a storey commonly hangs under its slab,
        // i.e. in the band of the storey below — printed so the ratio is explainable.
        const belowStorey = [...hostStoreys]
          .filter((storey) => storey.elevation < source!.elevation)
          .sort((a, b) => b.elevation - a.elevation)[0]
        const belowBand = belowStorey === undefined ? null : storeySlabBandM(network, belowStorey.id)
        const belowSelection = belowBand === null ? null : selectEngineerBranchSegments(network, belowBand)
        const belowTotalM = belowSelection === null ? null : belowSelection.segments.reduce((sum, s) => sum + (s.lengthM ?? 0), 0)
        const engineerDiametersMm: Record<string, number> = {}
        for (const s of engineerBranches.segments) {
          const key = String(s.outerDiameterMm ?? 'null')
          engineerDiametersMm[key] = (engineerDiametersMm[key] ?? 0) + 1
        }
        console.info(
          `[096 branch ratio] storey 01 (band ${band!.bottomM.toFixed(2)}..${Number.isFinite(band!.topM) ? band!.topM.toFixed(2) : 'inf'} m): ` +
            `ours ${branchLengths.oursTotalM.toFixed(2)} m over ${branchLengths.oursSegmentCount} run segments ` +
            `(${allAssignments.length - allAssignments.filter((a) => a.unassigned).length}/${allAssignments.length} fixtures routed, ${byCore} by wet core); ` +
            `engineer ${branchLengths.engineerTotalM?.toFixed(2) ?? 'n/a'} m over ${branchLengths.engineerSegmentCount} horizontal SW-GRV segments ` +
            `(${engineerBranches.byGeometryCount} by Z, ${engineerBranches.byContainmentCount} by containment, ${branchLengths.engineerSegmentsWithNullLength} without Pset length; ø ${JSON.stringify(engineerDiametersMm)}); ` +
            `ratio ${branchLengths.ratioOursToEngineer?.toFixed(3) ?? 'n/a'}` +
            (belowTotalM === null
              ? ''
              : `; diagnostic: engineer horizontal SW-GRV in the band of the storey below = ${belowTotalM.toFixed(2)} m over ${belowSelection!.segments.length} segments`),
        )
        expect(branchLengths.scope).toBe('storey')
        expect(branchLengths.ratioOursToEngineer).not.toBeNull()
        // Measured on the client files — pinned with a tolerance so a routing
        // change that moves the ratio is noticed. The [0.5, 2.0] acceptance band
        // is gated by the gauntlet harness on the UNION set (`gauntletMetrics`),
        // not here: the literal band is a 12-run / 6.2 m slice of this storey.
        expect(branchLengths.ratioOursToEngineer!).toBeCloseTo(RATIO_096_STOREY_01_LITERAL_PIN, 1)
        expect(branchLengths.oursTotalM).toBeCloseTo(OURS_096_STOREY_01_BRANCH_M, 1)
        const unionSelection = selectEngineerStoreyHorizontals(network, band!)
        const unionTotalM = unionSelection.horizontals.reduce((sum, entry) => {
          const dx = (entry.segment.end!.x - entry.segment.start!.x) * network.metersPerSourceUnit
          const dy = (entry.segment.end!.y - entry.segment.start!.y) * network.metersPerSourceUnit
          return sum + Math.hypot(dx, dy)
        }, 0)
        const unionRatio = branchLengths.oursTotalM / unionTotalM
        console.info(`[096 branch ratio] union set (band ∪ 1.2 m hang band): engineer ${unionTotalM.toFixed(2)} m over ${unionSelection.horizontals.length} runs; ratio ${unionRatio.toFixed(3)}`)
        expect(unionRatio).toBeCloseTo(RATIO_096_STOREY_01_UNION_PIN, 1)

        // Determinism.
        const second = run()
        expect(second.cores.map((core) => core.id)).toEqual(result.cores.map((core) => core.id))
        expect(second.stackExtents).toEqual(result.stackExtents)

        // --- G3 report only (NOT pinned): the same residential storey run as OFFICE ---
        // Shows what the typology switch does on the wrong typology: every stack
        // must land on a core shaft or be flagged, so a podium file without a
        // single slab opening flags every core.
        const office = buildWetCoreSuggestedRisers({
          storeys: hostStoreys,
          sourceStoreyId: source!.id,
          fixtures: merged.fixtures,
          kitchens: merged.kitchens,
          floorMeshes,
          nextLabel: labeler(),
          wetCore: { planUnits: 'm', continuityMap: continuity.map, typology: 'office' },
        })
        const officeStacks = office.stacks.filter((stack) => stack.anchor === 'wet-core')
        const officeRules: Record<string, number> = {}
        let officeFlagged = 0
        for (const stack of officeStacks) {
          if (stack.anchor !== 'wet-core') continue
          officeRules[stack.placement.rule] = (officeRules[stack.placement.rule] ?? 0) + 1
          if (stack.placement.flagged) officeFlagged++
        }
        const officeSelection = office.officeCoreShafts[0]
        const officeAssignments = assignFixturesToRisers(
          merged.fixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          office.risers
            .filter((riser) => riser.storeyId === source!.id)
            .map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm', typology: 'office' },
        )
        console.info(
          `[096 office report] cores=${office.cores.length} stacks=${officeStacks.length} (${JSON.stringify(officeRules)}, flagged ${officeFlagged}); ` +
            `core shafts ${officeSelection?.selected.length ?? 0}/${officeSelection?.candidates.length ?? 0} (${officeSelection?.denseClusters.length ?? 0} dense clusters, ${officeSelection?.largeVoids.length ?? 0} void anchors); ` +
            `fixture rows ${office.fixtureRows.length}; nearest-stack assignment under the 12 m placeholder: ${officeAssignments.filter((a) => !a.unassigned).length}/${officeAssignments.length} routed, ` +
            `${officeAssignments.filter((a) => !a.unassigned && a.exceedsMaxBranchLength).length} over-length; residential run: ${coreStacks.length} stacks (${JSON.stringify(rules)})`,
        )
        expect(office.typology).toBe('office')
        expect(office.cores).toHaveLength(result.cores.length)
      } finally {
        api.CloseModel(hostId)
        api.CloseModel(linkedId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
