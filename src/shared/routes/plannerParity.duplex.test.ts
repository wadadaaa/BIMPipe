import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { assignFixturesToRisers } from '@/domain/assignFixturesToRisers'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea } from '@/domain/types'
import { aggregateStoreyDetections } from '@/shared/ifc/aggregateStoreyDetections'
import { detectFixtures } from '@/shared/ifc/detectFixtures'
import { detectKitchens } from '@/shared/ifc/detectKitchens'
import { extractFloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { chooseInitialStoreyByFixtures } from '@/shared/ifc/scanStoreyFixtures'
import { buildBranchRoutesFromAssignments } from './buildBranchRoutes'
import { buildSanitaryRoutingPlan } from './buildSanitaryRoutes'
import { buildSuggestedRisersWithSnap, buildWetCoreSuggestedRisers } from './buildSuggestedRisers'
import { DEFAULT_RISER_PLACEMENT_RULE_PROFILE } from './riserPlacementProfile'

// Byte-identity pin for the two planner paths the Goal 4 objective protects
// ("any change must keep Duplex/ADAM byte-identical"), on the bundled Duplex
// sample's auto-opened storey (Level 1), real web-ifc engine, no gating:
//
//  1. plain path — `buildWetCoreSuggestedRisers` (wet-core stacks, V4 extent
//     from the whole-building scan, no continuity map) → `assignFixturesToRisers`
//     with the wet-core membership → `buildBranchRoutesFromAssignments`;
//  2. demo / ADAM path — `buildSuggestedRisersWithSnap({ enabled: false })`
//     (toilet-anchored, snap off) → `buildSanitaryRoutingPlan(…, 'ADAM_10.ifc')`.
//     The real `ADAM_10.ifc` demo asset is not on this machine
//     (`external/demo-assets/` absent, see PROGRESS); the demo planner run on
//     the Duplex sample under the ADAM_10 file name is the established stand-in
//     (it is what the live demo-parity byte-diff used as well).
//
// Riser / stack ids come from `crypto.randomUUID`; the test replaces it with a
// deterministic UUID-shaped sequence for the run, and the dumps additionally
// mask every UUID to an ordinal token in order of first appearance, so only
// deterministic content remains: positions, labels, storey ids, fixture express
// ids, assignment and route geometry. Each dump is snapshotted (readable diff)
// and its sha256 pinned inline (one-line signal).
//
// Why the ids must be fixed: `selectTargetRiserForGroup` (demo planner) breaks
// an exact distance tie by `riser.id.localeCompare`, and on Duplex Level 1 the
// two WC-anchored risers are mirror-symmetric about the service zone's toilet
// centroid — with random ids the demo plan's target riser, lead fixture and
// route order flip between two outputs run to run (measured 6/6 of 12 runs on
// this branch; same code on `main`). The plain path has no such tie. Fixing
// the ids pins the planner's function of its inputs, which is what "byte-
// identical to main" means; the tie itself is reported as a follow-up.
// The snapshot content was verified identical to `main` (`a334168`) by running
// this file unchanged in a temporary worktree of that commit: same two sha256
// values, snapshot file byte-identical (`cmp`), worktree removed afterwards.
// Measured: plain 6 risers (1 core stack over 2 storeys + 4 kitchen stacks),
// 4 assignments, 8 branch-run segments; demo 6 risers (2 WC + 4 kitchen
// stacks), 3 routes, 1 limitation.
const DUPLEX_PATH = path.resolve(process.cwd(), 'public/samples/Duplex_MEP_20110907.ifc')
const TEST_TIMEOUT_MS = 120_000
const ADAM_DEMO_FILE_NAME = 'ADAM_10.ifc'

const PIN_PLAIN_SHA256 = 'f0ffbdf7d6412c8c53d018e962ff1b38a785bacbfffd98eff368babfa5339ee5'
const PIN_DEMO_SHA256 = 'ab2c86347bb99e9c51e7e21855962a4e3e610d5c47fe07a039c806e9268bf087'

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

/** Deterministic UUID-shaped ids, so id-based tie-breaks are reproducible. */
function sequentialUuid(): () => `${string}-${string}-${string}-${string}-${string}` {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

/** JSON dump with every UUID replaced by `<uuid-N>` in order of first appearance. */
function maskedDump(value: unknown): string {
  const ordinals = new Map<string, string>()
  return JSON.stringify(value, null, 1).replace(UUID_PATTERN, (uuid) => {
    const key = uuid.toLowerCase()
    let token = ordinals.get(key)
    if (token === undefined) {
      token = `<uuid-${ordinals.size + 1}>`
      ordinals.set(key, token)
    }
    return token
  })
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

describe('planner parity on the bundled Duplex sample (plain + demo/ADAM path, UUIDs masked)', () => {
  it(
    'produces byte-identical plain and demo-path planner dumps',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(DUPLEX_PATH))
      const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(sequentialUuid())

      try {
        const storeys = await parseStoreys(api, modelId, 'duplex-parity')
        const chosen = await chooseInitialStoreyByFixtures(api, modelId, storeys)
        const source = storeys.find((storey) => storey.id === chosen.storeyId)!
        expect(source.name).toMatch(/level 1/i)

        const [fixtures, kitchens, floorMeshes] = await Promise.all([
          detectFixtures(api, modelId, source.id),
          detectKitchens(api, modelId, source.id),
          extractFloorMeshes(api, modelId, source.id),
        ])

        // --- 1. plain path -------------------------------------------------
        const aggregated = await aggregateStoreyDetections(api, modelId, storeys, DEFAULT_RISER_PLACEMENT_RULE_PROFILE)
        const buildingFixtures: Fixture[] = Object.values(aggregated.fixturesByStoreyId).flat()
        const buildingKitchens: KitchenArea[] = Object.values(aggregated.kitchensByStoreyId).flat()
        const plain = buildWetCoreSuggestedRisers({
          storeys,
          sourceStoreyId: source.id,
          fixtures,
          kitchens,
          floorMeshes,
          nextLabel: labeler(),
          wetCore: { planUnits: 'm', continuityMap: null },
          stackExtent: { buildingFixtures: toStackExtentFixtures(buildingFixtures, buildingKitchens), planUnits: 'm' },
        })
        // Membership exactly as the page derives it: fixture → core from the
        // suggestion's cores, stack → core from the wet-core stacks.
        const fixtureCoreIds = new Map<number, string>()
        for (const core of plain.cores) for (const expressId of core.memberExpressIds) fixtureCoreIds.set(expressId, core.id)
        const stackCoreIds = new Map<string, string>()
        for (const stack of plain.stacks) if (stack.anchor === 'wet-core') stackCoreIds.set(stack.stackId, stack.core.id)
        const plainAssignments = assignFixturesToRisers(fixtures, plain.risers, {
          units: 'm',
          coreMembership: { fixtureCoreIds, stackCoreIds },
        })
        const plainRoutes = buildBranchRoutesFromAssignments(plainAssignments)
        const plainDump = maskedDump({
          storey: { id: source.id, name: source.name },
          risers: plain.risers,
          stacks: plain.stacks.map((stack) => ({
            stackId: stack.stackId,
            stackLabel: stack.stackLabel,
            anchor: stack.anchor,
            position: stack.position,
            // Kitchen stacks carry no placement rule; `undefined` is dropped by JSON.
            placement: stack.anchor === 'wet-core' ? stack.placement : undefined,
          })),
          cores: plain.cores,
          stackExtents: plain.stackExtents,
          assignments: plainAssignments,
          routes: plainRoutes,
        })

        // --- 2. demo / ADAM path -------------------------------------------
        const demo = buildSuggestedRisersWithSnap(storeys, source.id, fixtures, kitchens, floorMeshes, labeler(), { enabled: false })
        const demoPlan = buildSanitaryRoutingPlan(fixtures, demo.risers, ADAM_DEMO_FILE_NAME)
        const demoDump = maskedDump({
          storey: { id: source.id, name: source.name },
          risers: demo.risers,
          snapOutcomes: demo.snapOutcomes,
          plan: demoPlan,
        })

        // Sanity on the shape before pinning bytes (mirrors the wet-core test's counts).
        expect(new Set(plain.risers.map((riser) => riser.stackId)).size).toBe(5)
        expect(new Set(demo.risers.map((riser) => riser.stackId)).size).toBe(6)
        expect(plainDump).not.toMatch(UUID_PATTERN)
        expect(demoDump).not.toMatch(UUID_PATTERN)

        console.info(
          `[duplex parity] ${source.name}: plain ${plain.risers.length} risers / ${plainAssignments.length} assignments / ` +
            `${plainRoutes.reduce((sum, floor) => sum + floor.segments.length, 0)} route segments, sha256 ${sha256(plainDump)}; ` +
            `demo ${demo.risers.length} risers / ${demoPlan.routes.length} routes / ${demoPlan.limitations.length} limitations, sha256 ${sha256(demoDump)}`,
        )

        expect(plainDump).toMatchSnapshot('plain path (wet-core stacks + branch runs)')
        expect(demoDump).toMatchSnapshot('demo/ADAM path (toilet-anchored stacks + sanitary routing plan)')
        expect(sha256(plainDump)).toBe(PIN_PLAIN_SHA256)
        expect(sha256(demoDump)).toBe(PIN_DEMO_SHA256)
        expect(randomUUID).toHaveBeenCalled()
      } finally {
        randomUUID.mockRestore()
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
