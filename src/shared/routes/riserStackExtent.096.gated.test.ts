import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTechnicalStoreyName } from '@/domain/chooseInitialStorey'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea, Storey } from '@/domain/types'
import { detectFixtures } from '@/shared/ifc/detectFixtures'
import { detectKitchens } from '@/shared/ifc/detectKitchens'
import { parseStoreys } from '@/shared/ifc/parseStoreys'
import { buildSuggestedRisersWithSnap, type StackExtentOptions } from './buildSuggestedRisers'

// Gated regression against the local 096 plumbing model (client data,
// gitignored; skips cleanly when absent). Suggesting from storey "01" used to
// span every eligible storey of the 44-storey model, so each stack ran up into
// the technical roof storeys. With the V4 stack extent every auto stack must
// stop at the last storey carrying the same core at its XY and never reach
// R0/R1. No continuity map is loaded here (the plumbing file carries no
// architecture), so the obstruction bound is documented as skipped.
const IFC_096_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')

const TEST_TIMEOUT_MS = 300_000

function labeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

describe.skipIf(!existsSync(IFC_096_PATH))('096-P riser stack extent (gated: requires local client file)', () => {
  it(
    'every auto stack suggested from storey 01 tops out below R0/R1 and the total riser count drops well below 462',
    async () => {
      const ifc = await import('web-ifc')
      const api = new ifc.IfcAPI()
      await api.Init()
      const modelId = api.OpenModel(readFileSync(IFC_096_PATH))

      try {
        const storeys: Storey[] = await parseStoreys(api, modelId, '096-extent')
        expect(storeys).toHaveLength(44)
        const byName = new Map(storeys.map((storey) => [storey.name, storey]))
        const source = byName.get('01')
        const r0 = byName.get('R0')
        const r1 = byName.get('R1')
        const r2 = byName.get('R2')
        expect(source).toBeDefined()
        expect(r0).toBeDefined()
        expect(r1).toBeDefined()
        expect(r2).toBeDefined()

        // Whole-building positioned detection — the input the extent needs.
        const scanStart = performance.now()
        const buildingFixtures: Fixture[] = []
        const buildingKitchens: KitchenArea[] = []
        for (const storey of storeys) {
          const [fixtures, kitchens] = await Promise.all([
            detectFixtures(api, modelId, storey.id),
            detectKitchens(api, modelId, storey.id),
          ])
          buildingFixtures.push(...fixtures)
          buildingKitchens.push(...kitchens)
        }
        const scanMs = Math.round(performance.now() - scanStart)
        const fixtureBearing = storeys.filter((storey) =>
          buildingFixtures.some((fixture) => fixture.storeyId === storey.id && fixture.position !== null),
        )
        console.info(
          `[096 extent] whole-building detection in ${scanMs} ms: ${buildingFixtures.length} fixtures, ` +
            `${buildingKitchens.length} kitchens on ${fixtureBearing.length} storeys ` +
            `(${fixtureBearing.map((storey) => storey.name).join(', ')}); ` +
            `technical storeys: ${storeys.filter((storey) => isTechnicalStoreyName(storey.name)).map((storey) => `${storey.name}@${storey.elevation}`).join(', ')}`,
        )

        const sourceFixtures = buildingFixtures.filter((fixture) => fixture.storeyId === source!.id)
        const sourceKitchens = buildingKitchens.filter((kitchen) => kitchen.storeyId === source!.id)
        expect(sourceFixtures.filter((fixture) => fixture.kind === 'TOILETPAN')).toHaveLength(11)

        // BEFORE: eligibility-based extent (every eligible storey).
        const before = buildSuggestedRisersWithSnap(
          storeys, source!.id, sourceFixtures, sourceKitchens, null, labeler(), { enabled: false },
        )
        const beforeStacks = new Set(before.risers.map((riser) => riser.stackId)).size
        const beforeTopsOnTechnical = before.risers.filter(
          (riser) => isTechnicalStoreyName(storeys.find((storey) => storey.id === riser.storeyId)!.name),
        ).length

        // AFTER: V4 stack extent (positions from web-ifc are metres in the source frame).
        const extentOptions: StackExtentOptions = {
          buildingFixtures: toStackExtentFixtures(buildingFixtures, buildingKitchens),
          planUnits: 'm',
        }
        const run = () =>
          buildSuggestedRisersWithSnap(
            storeys, source!.id, sourceFixtures, sourceKitchens, null, labeler(), { enabled: false },
            undefined, extentOptions,
          )
        const after = run()
        const afterStacks = new Set(after.risers.map((riser) => riser.stackId)).size

        expect(afterStacks).toBe(beforeStacks)
        expect(after.stackExtents).toHaveLength(afterStacks)

        const storeyById = new Map(storeys.map((storey) => [storey.id, storey]))
        for (const { stackLabel, extent } of after.stackExtents) {
          const top = storeyById.get(extent.topStoreyId)!
          const bottom = storeyById.get(extent.collectorStoreyId)!
          console.info(
            `[096 extent] ${stackLabel}: ${bottom.name} → ${top.name} (${extent.storeyIds.length} storeys, ` +
              `core "${extent.anchorCoreFingerprint || 'none'}"); ` +
              extent.reasons.filter((reason) => !reason.startsWith('anchor core')).join(' | '),
          )
          // Never tops out on a roof/technical storey, and always below R0 and R1.
          expect(isTechnicalStoreyName(top.name)).toBe(false)
          expect(top.elevation).toBeLessThan(r0!.elevation)
          expect(top.elevation).toBeLessThan(r1!.elevation)
          // Stops at the last storey with a matching core: the storey right above the
          // top has no matching core (or is technical), which the reasons must state.
          expect(
            extent.reasons.some(
              (reason) => reason.startsWith('no matching core on') || reason.startsWith('roof excluded'),
            ),
          ).toBe(true)
          // The stack always includes the storey it was suggested from.
          expect(extent.storeyIds).toContain(source!.id)
          // Continuity bound explicitly documented as skipped (no map for the plumbing file).
          expect(extent.reasons).toContain('continuity bound skipped: no continuity map loaded')
        }

        console.info(
          `[096 extent] stacks=${afterStacks}; new risers before=${before.risers.length} ` +
            `(${beforeTopsOnTechnical} on technical storeys) → after=${after.risers.length}; ` +
            `R2 sits at elevation ${r2!.elevation} (R0 ${r0!.elevation}, R1 ${r1!.elevation}, source ${source!.elevation})`,
        )
        expect(after.risers.length).toBeLessThan(before.risers.length)
        expect(after.risers.length).toBeLessThan(462 / 3)
        expect(after.risers.every((riser) => riser.source === 'detected')).toBe(true)
        expect(
          after.risers.some((riser) => riser.storeyId === r0!.id || riser.storeyId === r1!.id),
        ).toBe(false)

        // Determinism: a second run yields identical extents and riser storey lists.
        const second = run()
        expect(second.stackExtents).toEqual(after.stackExtents)
        expect(second.risers.map((riser) => [riser.stackLabel, riser.storeyId, riser.position])).toEqual(
          after.risers.map((riser) => [riser.stackLabel, riser.storeyId, riser.position]),
        )
      } finally {
        api.CloseModel(modelId)
      }
    },
    TEST_TIMEOUT_MS,
  )
})
