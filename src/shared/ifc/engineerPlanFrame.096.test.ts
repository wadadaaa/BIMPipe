import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import type { Fixture } from '@/domain/types'
import {
  groupEngineerRiserStacks,
  type EngineerPipeNetwork,
  type EngineerRiserStack,
} from '@/domain/engineerPipes'
import {
  alignEngineerStacksToViewerPlan,
  ifcSourceToViewerPoint,
} from '@/shared/frame/ifcSourceFrame'
import { detectFixtures } from './detectFixtures'
import { extractEngineerPipeNetwork } from './extractEngineerPipeNetwork'

/**
 * Gated empirical proof of the IFC-source → viewer plan sign convention (W7).
 *
 * The overlay/metrics conversion in `src/shared/frame/ifcSourceFrame.ts`
 * assumes viewer z = −(IFC Y). This test proves it against the real client
 * model instead of trusting the assumption: engineer SW-GRV riser stacks on
 * 096-P storey "01" must land next to the 11 detected toilets (which are in
 * viewer source metres) under the z = −Y mapping, and land ~1,300 km away
 * under the flipped z = +Y mapping. Skips cleanly when the client file is
 * absent (CI / other machines).
 */
const IFC_096_P_PATH = path.resolve(process.cwd(), 'external/projects/096/096-P.ifc')
const has096 = existsSync(IFC_096_P_PATH)

const PARSE_TIMEOUT_MS = 300_000

function findStoreyIdByName(api: IfcAPI, modelId: number, ifc: typeof import('web-ifc'), name: string): number | null {
  const ids = api.GetLineIDsWithType(modelId, ifc.IFCBUILDINGSTOREY)
  for (let i = 0; i < ids.size(); i += 1) {
    const expressId = ids.get(i)
    const line = api.GetLine(modelId, expressId, false) as { Name?: { value?: string } | null }
    if (line.Name?.value === name) return expressId
  }
  return null
}

function meanNearestPlanDistanceM(
  toilets: Array<{ x: number; z: number }>,
  points: Array<{ x: number; z: number }>,
): number {
  let sum = 0
  for (const toilet of toilets) {
    let nearest = Infinity
    for (const point of points) {
      const distance = Math.hypot(toilet.x - point.x, toilet.z - point.z)
      if (distance < nearest) nearest = distance
    }
    sum += nearest
  }
  return sum / toilets.length
}

describe.skipIf(!has096)('engineer plan frame on 096-P (gated: requires local client file)', () => {
  let api: IfcAPI
  let modelId: number
  let network: EngineerPipeNetwork
  let stacks: EngineerRiserStack[]
  let toilets: Array<Fixture & { position: NonNullable<Fixture['position']> }>

  beforeAll(async () => {
    const ifc = await import('web-ifc')
    api = new ifc.IfcAPI()
    await api.Init()
    modelId = api.OpenModel(readFileSync(IFC_096_P_PATH))

    const storey01Id = findStoreyIdByName(api, modelId, ifc, '01')
    expect(storey01Id).not.toBeNull()

    const fixtures = await detectFixtures(api, modelId, storey01Id!)
    toilets = fixtures.filter(
      (fixture): fixture is Fixture & { position: NonNullable<Fixture['position']> } =>
        fixture.kind === 'TOILETPAN' && fixture.position !== null,
    )

    network = await extractEngineerPipeNetwork(api, modelId, {
      systemPrefixes: ['SW-GRV', 'VNT'],
    })
    // Stacks are compared model-wide: 096 models several risers as single
    // full-height pipes, so per-storey containment understates which stacks
    // pass through storey 01 (documented W7 caveat). Risers are vertical
    // shafts — their plan positions are valid on every storey they serve.
    stacks = groupEngineerRiserStacks(network)
  }, PARSE_TIMEOUT_MS)

  afterAll(() => {
    if (api !== undefined && modelId !== undefined) api.CloseModel(modelId)
  })

  it('finds the 11 toilets and the engineer riser stacks', () => {
    expect(toilets).toHaveLength(11)
    expect(stacks.length).toBeGreaterThan(0)
  })

  it('z = −(IFC Y) puts engineer riser stacks next to the toilets; z = +Y puts them ~1,300 km away', () => {
    const toiletPlan = toilets.map((toilet) => ({ x: toilet.position.x, z: toilet.position.z }))

    // Correct convention (the one ifcSourceToViewerPoint / the aligner encode).
    const alignedStacks = alignEngineerStacksToViewerPlan(stacks)
    const correctPlan = alignedStacks.map((stack) => ({ x: stack.xM, z: stack.yM }))
    const correctMeanM = meanNearestPlanDistanceM(toiletPlan, correctPlan)

    // Flipped convention (z = +IFC Y): mirrors the building across the world
    // X axis, ~664 km on each side for 096's survey coordinates.
    const flippedPlan = stacks.map((stack) => ({ x: stack.xM, z: stack.yM }))
    const flippedMeanM = meanNearestPlanDistanceM(toiletPlan, flippedPlan)

    console.info(
      `[096 gated] engineer stacks: ${stacks.length}; ` +
        `mean nearest toilet→stack distance: z=−Y ${correctMeanM.toFixed(2)} m, ` +
        `z=+Y ${flippedMeanM.toFixed(0)} m`,
    )

    // Toilets connect to nearby vertical stacks — a few metres at most.
    expect(correctMeanM).toBeLessThan(5)
    // The mirrored frame is off by the full doubled survey northing.
    expect(flippedMeanM).toBeGreaterThan(100_000)
  })

  it('converted storey-01 SW-GRV segment midpoints stay inside the toilet footprint neighbourhood', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) =>
        segment.storeyName === '01' &&
        (segment.systemName ?? '').startsWith('SW-GRV') &&
        segment.endpointSource === 'extrusion-axis' &&
        segment.start !== null &&
        segment.end !== null,
    )
    expect(storey01SwGrv.length).toBeGreaterThan(0)

    const xs = toilets.map((toilet) => toilet.position.x)
    const zs = toilets.map((toilet) => toilet.position.z)
    // Toilets span most of the ~26×23 m footprint (W1 gated fact); pipes on
    // the same floor must stay within a small margin around that box.
    const marginM = 15
    const minX = Math.min(...xs) - marginM
    const maxX = Math.max(...xs) + marginM
    const minZ = Math.min(...zs) - marginM
    const maxZ = Math.max(...zs) + marginM

    for (const segment of storey01SwGrv) {
      const start = ifcSourceToViewerPoint(segment.start!, network.metersPerSourceUnit)
      const end = ifcSourceToViewerPoint(segment.end!, network.metersPerSourceUnit)
      const midX = (start.x + end.x) / 2
      const midZ = (start.z + end.z) / 2
      expect(midX).toBeGreaterThanOrEqual(minX)
      expect(midX).toBeLessThanOrEqual(maxX)
      expect(midZ).toBeGreaterThanOrEqual(minZ)
      expect(midZ).toBeLessThanOrEqual(maxZ)
    }
  })
})
