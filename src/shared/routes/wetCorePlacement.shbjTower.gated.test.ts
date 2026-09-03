import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assignFixturesToRisers, MAX_BRANCH_LENGTH_M } from '@/domain/assignFixturesToRisers'
import { BRANCH_DIAMETER_MM_BY_FIXTURE_KIND } from '@/domain/branchDefaults'
import { probeContinuityCell } from '@/domain/continuityMap'
import { buildCoreFingerprint, SAME_CORE_RADIUS_M, toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea, Storey } from '@/domain/types'
import { buildContinuityMapForModels, type ContinuityMapSource } from '@/shared/ifc/buildContinuityMapForModel'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { resolveModelLengthUnit } from '@/shared/ifc/resolveModelLengthUnit'
import { buildBranchRoutesFromAssignments } from './buildBranchRoutes'
import { buildWetCoreSuggestedRisers } from './buildSuggestedRisers'
import { summarizeBranchRunsForDebug } from './branchRouteSummary'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'
import { MAX_SNAP_M } from './suggestRisers'

// Gated V7 acceptance against the recovered tower band of the second real
// project (client data, gitignored; skips cleanly when absent): ONE
// architecture file with three typical storeys (L10–L12) and no sanitary
// model, so there is no engineer baseline. The acceptance is that BIMPipe
// alone produces physically meaningful placement and routing from the
// architect-placed fixtures on the middle storey, with the neighbours
// providing V4's continuity / fingerprint signal.
const TOWER_PATH = path.resolve(process.cwd(), 'external/projects/shbj/shbj-AR-tower-L10-12.ifc')
const FILE_NAME = 'tower-band.ifc'
const SOURCE_STOREY_NAME = 'L11'
const TEST_TIMEOUT_MS = 600_000
/** Slowest single step the UI may run without progress (CLAUDE.md). */
const PROGRESS_THRESHOLD_MS = 10_000
/** A wet core larger than this across is not one bathroom / kitchen cluster. */
const PLAUSIBLE_CORE_DIAGONAL_M = 6

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

const gated = describe.skipIf(!existsSync(TOWER_PATH))

gated('tower band (single AR file, L10–L12) wet-core placement + routing (gated: requires local client file)', () => {
  it(
    `storey ${SOURCE_STOREY_NAME}: one stack per core, obstructed ⇔ flagged, every fixture routed, cores repeat on both neighbours`,
    async () => {
      const timings: Array<[string, number]> = []
      const timed = async <T>(label: string, run: () => Promise<T> | T): Promise<T> => {
        const start = performance.now()
        const value = await run()
        timings.push([label, performance.now() - start])
        return value
      }

      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = await timed('open model', () => api.OpenModel(readFileSync(TOWER_PATH)))

      try {
        const storeys = await parseStoreys(api, modelId, 'tower')
        expect(storeys.map((s) => s.name)).toEqual(['L10', 'L11', 'L12'])
        const source = storeys.find((s) => s.name === SOURCE_STOREY_NAME)!
        const [below, above] = [storeys[0], storeys[2]]
        const lengthUnit = await resolveModelLengthUnit(api, modelId)
        expect(lengthUnit).not.toBeNull()

        // --- 1. detection on every storey of the band (single file: no merge) ---
        const aggregated = await timed('detect fixtures (3 storeys)', () =>
          aggregateStoreyDetections(api, modelId, storeys, DEFAULT_RISER_PLACEMENT_RULE_PROFILE),
        )
        const fixturesOf = (storey: Storey): Fixture[] => aggregated.fixturesByStoreyId[storey.id] ?? []
        const kitchensOf = (storey: Storey): KitchenArea[] => aggregated.kitchensByStoreyId[storey.id] ?? []
        const sourceFixtures = fixturesOf(source)
        const sourceKitchens = kitchensOf(source)
        const kindCounts = countBy(sourceFixtures, (fixture) => fixture.kind)
        for (const storey of storeys) {
          console.info(
            `[tower ${storey.name}] fixtures ${JSON.stringify(countBy(fixturesOf(storey), (fixture) => fixture.kind))}, kitchens ${kitchensOf(storey).length}`,
          )
        }
        // Measured (V2 pin): 11 WC + 2 multi-bowl sinks + 2 urinals per storey, no
        // fire-protection terminal reaches the fixture list (classifier excludes
        // them), no CISTERN/OTHER, every fixture positioned and off the origin.
        expect(kindCounts).toEqual({ SINK: 2, TOILETPAN: 11, URINAL: 2 })
        expect(kindCounts.OTHER).toBeUndefined()
        expect(kindCounts.CISTERN).toBeUndefined()
        expect(sourceFixtures.every((fixture) => fixture.position !== null)).toBe(true)
        expect(sourceFixtures.every((fixture) => Math.hypot(fixture.position!.x, fixture.position!.z) > 1)).toBe(true)
        expect(sourceFixtures.some((fixture) => /sprinkler|hydrant|fire/i.test(fixture.name))).toBe(false)
        // The band carries no IfcSpace above L07 (V0a census), so there is no
        // per-apartment / kitchen breakdown to print; asserted so a future
        // extraction that adds spaces is noticed here.
        expect(sourceKitchens).toHaveLength(0)

        // --- continuity map from the single AR file, all three storeys ---
        const sources: ContinuityMapSource[] = [
          {
            fileName: FILE_NAME,
            webIfcModelId: modelId,
            lengthUnit,
            sourceToHostStoreyId: null,
            storeyIds: new Set(storeys.map((storey) => storey.id)),
          },
        ]
        const continuity = await timed('continuity map (3 storeys)', () => buildContinuityMapForModels({ api, sources }))
        const contribution = continuity.contributions[0]
        const grid = continuity.map.grids.find((candidate) => candidate.storeyId === source.id)
        const sourceCandidates = continuity.map.shaftCandidates.filter((candidate) => candidate.storeyIds.includes(source.id))
        const blockedCells = grid === undefined ? 0 : grid.blocked.reduce<number>((sum, cell) => sum + cell, 0)
        console.info(
          `[tower continuity] ${contribution.fileName}: ${contribution.storeyCount} storeys, ${contribution.obstructionCount} obstructions, ` +
            `${contribution.voidCount} voids, ${contribution.spaceCount} spaces (${Math.round(continuity.extractMs)} ms extract / ${Math.round(continuity.buildMs)} ms build); ` +
            `${SOURCE_STOREY_NAME} grid ${grid?.columns ?? 0}x${grid?.rows ?? 0} @ ${grid?.cellSize ?? 0} m, blocked ${blockedCells}/${grid?.blocked.length ?? 0}, ` +
            `shaft candidates ${sourceCandidates.length} ${JSON.stringify(countBy(sourceCandidates, (candidate) => candidate.source))}`,
        )
        expect(contribution.skippedReason).toBeNull()
        expect(contribution.storeyCount).toBe(3)
        expect(grid).toBeDefined()
        expect(contribution.spaceCount).toBe(0)
        // The tower plate is solid except its six real openings: measured 92 %
        // of the storey grid blocked (79 % before V7's host-scoped carve, when
        // the outer plate's cut-out made the whole tower plate "free").
        expect(blockedCells / grid!.blocked.length).toBeGreaterThan(0.85)

        // --- 2 + 3. wet cores and one stack per core, with the V4 extent ---
        const floorMeshes = await timed('floor meshes', () => extractFloorMeshes(api, modelId, source.id))
        const buildingFixtures = toStackExtentFixtures(
          Object.values(aggregated.fixturesByStoreyId).flat(),
          Object.values(aggregated.kitchensByStoreyId).flat(),
        )
        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys,
            sourceStoreyId: source.id,
            fixtures: sourceFixtures,
            kitchens: sourceKitchens,
            floorMeshes,
            nextLabel: labeler(),
            wetCore: { planUnits: 'm', continuityMap: continuity.map },
            stackExtent: { buildingFixtures, planUnits: 'm', continuityMap: continuity.map },
          })
        const result = await timed('suggest (cores + placement + extent)', run)
        const coreStacks = result.stacks.flatMap((stack) => (stack.anchor === 'wet-core' ? [stack] : []))

        const oversizedCores: string[] = []
        for (const core of result.cores) {
          const width = core.bbox.maxX - core.bbox.minX
          const depth = core.bbox.maxZ - core.bbox.minZ
          const diagonal = Math.hypot(width, depth)
          if (diagonal > PLAUSIBLE_CORE_DIAGONAL_M) oversizedCores.push(`${core.kindsFingerprint} ${diagonal.toFixed(1)} m`)
          console.info(
            `[tower core] ${core.kindsFingerprint} ×${core.members.length} ${JSON.stringify(core.kindCounts)} bbox ${width.toFixed(1)} x ${depth.toFixed(1)} m (diagonal ${diagonal.toFixed(1)} m)`,
          )
        }
        const rules = countBy(coreStacks, (stack) => stack.placement.rule)
        let onSlabOpening = 0
        const flagged: string[] = []
        for (const stack of coreStacks) {
          const extent = result.stackExtents.find((entry) => entry.stackLabel === stack.stackLabel)!
          const spanned = extent.extent.storeyIds.map((id) => storeys.find((storey) => storey.id === id)?.name ?? String(id))
          const containing = sourceCandidates.filter(
            (candidate) =>
              stack.position.x >= candidate.bounds.minX &&
              stack.position.x <= candidate.bounds.maxX &&
              stack.position.z >= candidate.bounds.minZ &&
              stack.position.z <= candidate.bounds.maxZ,
          )
          const inOpening = containing.some((candidate) => candidate.source === 'slab-opening')
          if (inOpening) onSlabOpening++
          if (stack.placement.flagged) flagged.push(`${stack.stackLabel}: ${stack.placement.reason}`)
          const nearestCandidate = sourceCandidates
            .map((candidate) => ({
              candidate,
              distance: Math.hypot(
                Math.max(stack.core.bbox.minX - candidate.center.x, 0, candidate.center.x - stack.core.bbox.maxX),
                Math.max(stack.core.bbox.minZ - candidate.center.z, 0, candidate.center.z - stack.core.bbox.maxZ),
              ),
            }))
            .sort((a, b) => a.distance - b.distance)[0]
          console.info(
            `[tower stack] ${stack.stackLabel}: core ${stack.core.kindsFingerprint} ×${stack.core.members.length} → ${stack.placement.rule}` +
              ('distance' in stack.placement ? ` ${stack.placement.distance.toFixed(2)} m from the core footprint` : '') +
              (stack.placement.flagged ? ' (FLAGGED)' : '') +
              `; inside ${containing.length} candidate footprint(s) ${JSON.stringify(
                containing.map((c) => `${c.source} ${(c.bounds.maxX - c.bounds.minX).toFixed(2)}x${(c.bounds.maxZ - c.bounds.minZ).toFixed(2)} m`),
              )}; nearest candidate centre ${nearestCandidate === undefined ? 'n/a' : `${nearestCandidate.distance.toFixed(2)} m (${nearestCandidate.candidate.source})`}` +
              `; extent ${spanned.join(' → ')}; ${stack.placement.reason}`,
          )
          for (const reason of extent.extent.reasons) console.info(`[tower stack]   ${stack.stackLabel} extent: ${reason}`)
        }
        console.info(
          `[tower placement] cores=${result.cores.length} stacks=${coreStacks.length} rules=${JSON.stringify(rules)} on slab openings=${onSlabOpening} flagged=${flagged.length} ` +
            `oversized cores=${JSON.stringify(oversizedCores)} diagnostics=${JSON.stringify(result.diagnostics)}`,
        )

        // Measured: 15 fixtures form FIVE cores — the 6-WC row, the 4-WC + 2-urinal
        // block, the single accessible WC and the two multi-bowl sink units (each
        // sink unit sits > 2.6 m from its WC block, so it is its own core). No
        // core is wider than one wet room (largest diagonal 4.5 m).
        expect(coreStacks).toHaveLength(result.cores.length)
        expect(result.cores).toHaveLength(5)
        expect(result.cores.reduce((sum, core) => sum + core.members.length, 0)).toBe(sourceFixtures.length)
        expect(result.stackExtents).toHaveLength(result.stacks.length)
        expect(oversizedCores).toEqual([])

        // The architect's slab models six real openings per storey (four 8.7 × 2.8 m
        // and two stair voids with landing slabs) and NO shaft opening near the
        // two WC rows: every cell within 1.5 m of those cores is solid slab or
        // wall, so their stacks stay at the core centroid FLAGGED with the
        // obstruction reason (never silently placed in the slab). The three
        // other cores snap to free cells inside the nearest real opening
        // (0.76–0.85 m from the core footprint). obstructed ⇔ flagged, as on the
        // 096 podium.
        for (const stack of coreStacks) {
          if ('distance' in stack.placement) expect(stack.placement.distance).toBeLessThanOrEqual(MAX_SNAP_M + 1e-9)
          const probe = probeContinuityCell(continuity.map, source.id, stack.position)
          if (stack.placement.flagged) {
            expect(stack.placement.rule).toBe('centroid')
            expect(stack.placement.reason).toMatch(/obstructed/)
            expect(stack.core.kindCounts.TOILETPAN, `${stack.stackLabel} flagged core must be a WC row`).toBeGreaterThanOrEqual(4)
          } else {
            expect(probe.status, `${stack.stackLabel} ${JSON.stringify(probe)}`).not.toBe('blocked')
          }
        }
        expect(flagged).toHaveLength(2)
        expect(rules).toEqual({ centroid: 2, 'free-cell': 3 })
        expect(onSlabOpening).toBe(3)
        // The 29.3 × 18.6 m cut-out of the outer plate is filled by the tower
        // plate and must not surface as a shaft candidate (it did before V7:
        // every stack then landed on "free" cells that were solid slab).
        expect(sourceCandidates.every((candidate) => candidate.bounds.maxX - candidate.bounds.minX < 10)).toBe(true)
        expect(continuity.map.diagnostics.some((line) => /filled by/.test(line))).toBe(true)

        // --- 4. stack extent through the neighbours + fingerprint match rate ---
        let both = 0
        let one = 0
        let none = 0
        let matchesBelow = 0
        let matchesAbove = 0
        for (const stack of coreStacks) {
          const extent = result.stackExtents.find((entry) => entry.stackLabel === stack.stackLabel)!.extent
          const spansBelow = extent.storeyIds.includes(below.id)
          const spansAbove = extent.storeyIds.includes(above.id)
          if (spansBelow && spansAbove) both++
          else if (spansBelow || spansAbove) one++
          else none++
          const xy = { x: stack.position.x, z: stack.position.z }
          if (buildCoreFingerprint(buildingFixtures, below.id, xy, SAME_CORE_RADIUS_M) === stack.core.kindsFingerprint) matchesBelow++
          if (buildCoreFingerprint(buildingFixtures, above.id, xy, SAME_CORE_RADIUS_M) === stack.core.kindsFingerprint) matchesAbove++
        }
        const total = coreStacks.length
        console.info(
          `[tower extent] of ${total} ${SOURCE_STOREY_NAME} stacks: ${both} span both neighbours, ${one} span one, ${none} stay on ${SOURCE_STOREY_NAME}; ` +
            `fingerprint match at the stack XY (${SAME_CORE_RADIUS_M} m radius): ${below.name} ${matchesBelow}/${total}, ${above.name} ${matchesAbove}/${total}`,
        )
        // Typical-storey signal: the same core fingerprint exists at every stack
        // XY on both neighbours (5/5 and 5/5). The three placed stacks run
        // L10 → L12; the two flagged stacks stop at L11 because V4's obstruction
        // bound sees solid slab at their XY on both neighbours (correct: no
        // shaft exists there in the architect's model). Floors, not tuned.
        expect(matchesBelow).toBe(total)
        expect(matchesAbove).toBe(total)
        expect(both).toBeGreaterThanOrEqual(3)
        expect(both + none).toBe(total)
        expect(none).toBe(flagged.length)

        // --- 5. branch runs: every fixture routes to its core's stack ---
        const sourceRisers = result.risers.filter((riser) => riser.storeyId === source.id)
        const fixtureCoreIds = new Map<number, string>()
        for (const core of result.cores) for (const expressId of core.memberExpressIds) fixtureCoreIds.set(expressId, core.id)
        const stackCoreIds = new Map(coreStacks.map((stack) => [stack.stackId, stack.core.id]))
        const routing = await timed('assign + branch routes', () => {
          const assignments = assignFixturesToRisers(
            sourceFixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
            sourceRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
            { units: 'm', coreMembership: { fixtureCoreIds, stackCoreIds } },
          )
          return { assignments, floors: buildBranchRoutesFromAssignments(assignments) }
        })
        const stackLabelByRiserId = new Map(sourceRisers.map((riser) => [riser.id, riser.stackLabel]))
        const summary = summarizeBranchRunsForDebug(routing.floors, routing.assignments, stackLabelByRiserId)
        const floor = summary.floors[0]
        const diameters = countBy(routing.floors.flatMap((entry) => entry.segments), (segment) => `Ø${segment.diameterMm}`)
        const longest = routing.assignments.reduce((max, entry) => (entry.unassigned ? max : Math.max(max, entry.planDistance)), 0)
        console.info(
          `[tower branch runs] ${floor?.segmentCount ?? 0} segments / ${(floor?.totalLengthM ?? 0).toFixed(2)} m to ${floor?.groups.length ?? 0} stacks; ` +
            `routed ${routing.assignments.length - summary.unrouted.length}/${routing.assignments.length} (${summary.assignedBy.wetCore} by wet core, ${summary.assignedBy.nearest} nearest); ` +
            `longest fixture→stack ${longest.toFixed(2)} m; over ${MAX_BRANCH_LENGTH_M} m: ${summary.overlength.length}; unrouted: ${summary.unrouted.length}; ` +
            `segment diameters ${JSON.stringify(diameters)}; per-kind defaults WC Ø${BRANCH_DIAMETER_MM_BY_FIXTURE_KIND.TOILETPAN} / sink Ø${BRANCH_DIAMETER_MM_BY_FIXTURE_KIND.SINK} / urinal Ø${BRANCH_DIAMETER_MM_BY_FIXTURE_KIND.URINAL}`,
        )
        for (const group of floor?.groups ?? []) {
          console.info(
            `[tower branch runs]   ${group.stackLabel}: ${group.segmentCount} segments, ${group.totalLengthM.toFixed(2)} m, Ø ${group.diametersMm.join('/')}, ${group.fixtureExpressIds.length} fixtures` +
              (group.fixturesAtStackExpressIds.length > 0 ? ` (${group.fixturesAtStackExpressIds.length} at the stack)` : ''),
          )
        }
        // Measured: 15/15 fixtures routed to their core's stack, 30 segments /
        // 19.3 m in total, longest fixture→stack 2.35 m (no run over the 4 m
        // limit); the two WC rows produce Ø110 runs, the sink units Ø50, and
        // the men's block's two urinals share one Ø63 collector segment.
        expect(summary.unrouted).toEqual([])
        expect(summary.overlength).toEqual([])
        expect(summary.assignedBy.wetCore).toBe(sourceFixtures.length)
        expect(summary.assignedBy.nearest).toBe(0)
        expect(routing.floors).toHaveLength(1)
        expect(floor!.groups).toHaveLength(coreStacks.length)
        expect(floor!.segmentCount).toBe(30)
        expect(floor!.totalLengthM).toBeCloseTo(19.28, 1)
        expect(diameters).toEqual({ 'Ø110': 22, 'Ø50': 7, 'Ø63': 1 })
        expect(longest).toBeLessThanOrEqual(MAX_BRANCH_LENGTH_M)

        // --- 6. determinism ---
        // Core ids, labels, positions, order, extents and branch geometry are
        // identical across runs. Riser / stack ids are `crypto.randomUUID()` by
        // design (`buildRiserStack`), so they are normalised to the stack label
        // before comparing — the label IS the stable cross-run identity here.
        const second = run()
        expect(second.cores.map((core) => core.id)).toEqual(result.cores.map((core) => core.id))
        expect(second.stacks.map((stack) => [stack.stackLabel, stack.position, stack.anchor === 'wet-core' ? stack.core.id : null])).toEqual(
          coreStacks.map((stack) => [stack.stackLabel, stack.position, stack.core.id]),
        )
        expect(second.stackExtents).toEqual(result.stackExtents)
        const secondRisers = second.risers.filter((riser) => riser.storeyId === source.id)
        const secondStackCoreIds = new Map(second.stacks.flatMap((stack) => (stack.anchor === 'wet-core' ? [[stack.stackId, stack.core.id] as const] : [])))
        const secondAssignments = assignFixturesToRisers(
          sourceFixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          secondRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm', coreMembership: { fixtureCoreIds, stackCoreIds: secondStackCoreIds } },
        )
        // `computeBranchRoutes` emits riser groups in riser-id order (uuid), so
        // group order is session-dependent; within a group the segments are
        // deterministic. Compare label-keyed, label-ordered.
        const normaliseRuns = (floors: typeof routing.floors, labels: ReadonlyMap<string, string>) =>
          floors.map((entry) => ({
            storeyId: entry.storeyId,
            planUnits: entry.planUnits,
            segments: entry.segments
              .map((segment, index) => ({
                stackLabel: labels.get(segment.riserId) ?? segment.riserId,
                index,
                start: segment.start,
                end: segment.end,
                axis: segment.axis,
                kind: segment.kind,
                servedFixtureExpressIds: segment.servedFixtureExpressIds,
                diameterMm: segment.diameterMm,
              }))
              .sort((a, b) => a.stackLabel.localeCompare(b.stackLabel) || a.index - b.index)
              .map(({ stackLabel, start, end, axis, kind, servedFixtureExpressIds, diameterMm }) => ({
                stackLabel,
                start,
                end,
                axis,
                kind,
                servedFixtureExpressIds,
                diameterMm,
              })),
          }))
        expect(
          normaliseRuns(buildBranchRoutesFromAssignments(secondAssignments), new Map(secondRisers.map((riser) => [riser.id, riser.stackLabel]))),
        ).toEqual(normaliseRuns(routing.floors, stackLabelByRiserId))

        // --- 7. performance ---
        const totalMs = timings.reduce((sum, [, ms]) => sum + ms, 0)
        console.info(
          `[tower timing] ${timings.map(([label, ms]) => `${label} ${Math.round(ms)} ms`).join('; ')}; total ${Math.round(totalMs)} ms; ` +
            `steps over ${PROGRESS_THRESHOLD_MS} ms (need UI progress): ${JSON.stringify(timings.filter(([, ms]) => ms > PROGRESS_THRESHOLD_MS).map(([label]) => label))}`,
        )
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
