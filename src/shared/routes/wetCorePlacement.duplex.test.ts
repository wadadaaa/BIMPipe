import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea } from '@/domain/types'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import { detectFixtures } from '@/shared/ifc/detectFixtures'
import { detectKitchens } from '@/shared/ifc/detectKitchens'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { chooseInitialStoreyByFixtures } from '@/shared/ifc/scanStoreyFixtures'
import { buildSuggestedRisersWithSnap, buildWetCoreSuggestedRisers } from './buildSuggestedRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'

// Real-engine test against the bundled Duplex sample (no gating). Plain mode
// now suggests through the wet-core path; this pins the BEFORE (toilet-anchored
// path, one stack per WC + one per kitchen) → AFTER (one stack per wet core +
// one per kitchen) stack counts on the auto-opened storey, and proves that with
// no continuity map every core stack uses the wall-side-edge rule and every
// fixture on the storey still reaches a stack within the branch length.
const DUPLEX_PATH = path.resolve(process.cwd(), 'public/samples/Duplex_MEP_20110907.ifc')
const TEST_TIMEOUT_MS = 120_000

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

describe('wet-core placement on the bundled Duplex sample', () => {
  it(
    'places one stack per wet core on the auto-opened storey (before → after counts pinned) with the wall-side-edge rule',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(DUPLEX_PATH))

      try {
        const storeys = await parseStoreys(api, modelId, 'duplex-wet-core')
        const chosen = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        const source = storeys.find((storey) => storey.id === chosen.storeyId)!
        expect(source.name).toMatch(/level 1/i)

        const [fixtures, kitchens, floorMeshes] = await Promise.all([
          detectFixtures(api, modelId, source.id),
          detectKitchens(api, modelId, source.id),
          extractFloorMeshes(api, modelId, source.id),
        ])
        const kindCounts: Record<string, number> = {}
        for (const fixture of fixtures) kindCounts[fixture.kind] = (kindCounts[fixture.kind] ?? 0) + 1

        // BEFORE: toilet-anchored path (still the demo-mode path).
        const before = buildSuggestedRisersWithSnap(
          storeys, source.id, fixtures, kitchens, floorMeshes, labeler(), { enabled: false },
        )
        const beforeStacks = new Set(before.risers.map((riser) => riser.stackId)).size

        // AFTER: wet-core path with the V4 extent from the whole-building aggregation.
        const aggregated = await aggregateStoreyDetections(api, modelId, storeys, DEFAULT_RISER_PLACEMENT_RULE_PROFILE)
        const buildingFixtures: Fixture[] = Object.values(aggregated.fixturesByStoreyId).flat()
        const buildingKitchens: KitchenArea[] = Object.values(aggregated.kitchensByStoreyId).flat()
        const run = () =>
          buildWetCoreSuggestedRisers({
            storeys,
            sourceStoreyId: source.id,
            fixtures,
            kitchens,
            floorMeshes,
            nextLabel: labeler(),
            wetCore: { planUnits: 'm', continuityMap: null },
            stackExtent: { buildingFixtures: toStackExtentFixtures(buildingFixtures, buildingKitchens), planUnits: 'm' },
          })
        const after = run()
        const coreStacks = after.stacks.filter((stack) => stack.anchor === 'wet-core')
        const kitchenStacks = after.stacks.filter((stack) => stack.anchor === 'kitchen')

        console.info(
          `[duplex wet-core] ${source.name}: fixtures ${JSON.stringify(kindCounts)}, kitchens ${kitchens.length}; ` +
            `stacks before=${beforeStacks} → after=${after.stacks.length} (${coreStacks.length} core + ${kitchenStacks.length} kitchen); ` +
            `cores: ${after.cores.map((core) => core.kindsFingerprint).join(' | ')}; ` +
            `rules: ${coreStacks.map((stack) => (stack.anchor === 'wet-core' ? stack.placement.rule : '')).join(', ')}; ` +
            `risers before=${before.risers.length} → after=${after.risers.length}`,
        )

        // Measured on the sample: Level 1 has 2 WC + 2 basins (the two mirrored
        // bathrooms share the party wall, so all four fixtures fall within the
        // 2.6 m link distance) and 4 kitchen areas → 6 stacks before (2 WC + 4
        // kitchens) and 5 after (1 core + 4 kitchens).
        expect(beforeStacks).toBe(6)
        expect(coreStacks).toHaveLength(1)
        expect(kitchenStacks).toHaveLength(4)
        expect(after.cores).toHaveLength(1)
        expect(after.cores.reduce((sum, core) => sum + core.members.length, 0)).toBe(
          fixtures.filter((fixture) => fixture.position !== null).length,
        )
        for (const stack of coreStacks) {
          if (stack.anchor !== 'wet-core') continue
          expect(stack.placement.rule).toBe('wall-side-edge')
          expect(stack.placement.flagged).toBe(false)
        }
        // R1: no obstruction grid on the storey → the core-collector rule never
        // engages; the suggestion is the pre-R1 one (byte-identity proven by the
        // R1 commit's before/after dump, see its message).
        expect(after.coreCollectors).toEqual([])
        // The extent is wired: one entry per stack.
        expect(after.stackExtents).toHaveLength(after.stacks.length)

        // Every positioned fixture on the storey reaches a stack within the branch length.
        const sourceRisers = after.risers.filter((riser) => riser.storeyId === source.id)
        const assignments = assignFixturesToRisers(
          fixtures.map((fixture) => ({ expressId: fixture.expressId, kind: fixture.kind, storeyId: fixture.storeyId, position: fixture.position })),
          sourceRisers.map((riser) => ({ id: riser.id, stackId: riser.stackId, storeyId: riser.storeyId, position: riser.position })),
          { units: 'm' },
        )
        expect(assignments.filter((assignment) => assignment.unassigned && assignment.reason !== 'no-plan-position')).toHaveLength(0)

        // Determinism.
        const second = run()
        expect(second.cores.map((core) => core.id)).toEqual(after.cores.map((core) => core.id))
        expect(second.stacks.map((stack) => [stack.stackLabel, stack.position])).toEqual(
          after.stacks.map((stack) => [stack.stackLabel, stack.position]),
        )
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
