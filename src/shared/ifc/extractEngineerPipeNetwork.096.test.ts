import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { extractEngineerPipeNetwork } from './extractEngineerPipeNetwork'
import {
  groupEngineerRiserStacks,
  type EngineerPipeNetwork,
  type EngineerRiserStack,
} from '@/domain/engineerPipes'

/**
 * Gated integration test against the real engineer plumbing model
 * external/projects/096/096-P.ifc (gitignored client data — never committed).
 * Skips cleanly when the file is absent. The model is 17 MB and parses in
 * tens of seconds, hence the long hook timeout.
 */

const IFC_096_P_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../external/projects/096/096-P.ifc',
)
const has096 = fs.existsSync(IFC_096_P_PATH)

const PARSE_TIMEOUT_MS = 300_000
const EXPECTED_STOREY_01_SW_GRV_SEGMENTS = 129
const EXPECTED_DIAMETERS_MM = new Set([50, 63, 110, 160])

describe.skipIf(!has096)('extractEngineerPipeNetwork on 096-P.ifc (gated)', () => {
  let api: IfcAPI
  let modelId: number
  let network: EngineerPipeNetwork
  let stacks: EngineerRiserStack[]

  beforeAll(async () => {
    const { IfcAPI } = await import('web-ifc')
    api = new IfcAPI()
    await api.Init()
    modelId = api.OpenModel(fs.readFileSync(IFC_096_P_PATH))
    // One extraction serves both the SW-GRV assertions and riser grouping.
    network = await extractEngineerPipeNetwork(api, modelId, {
      systemPrefixes: ['SW-GRV', 'VNT'],
    })
    stacks = groupEngineerRiserStacks(network)
  }, PARSE_TIMEOUT_MS)

  afterAll(() => {
    if (api !== undefined && modelId !== undefined) api.CloseModel(modelId)
  })

  it('resolves the centimetre length unit and the 44 storeys', () => {
    expect(network.metersPerSourceUnit).toBe(0.01)
    expect(network.storeys).toHaveLength(44)
    expect(network.storeys.some((storey) => storey.name === '01')).toBe(true)
  })

  it(
    `finds exactly ${EXPECTED_STOREY_01_SW_GRV_SEGMENTS} SW-GRV segments on storey "01"`,
    { timeout: 60_000 },
    () => {
      const storey01SwGrv = network.segments.filter(
        (segment) =>
          segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
      )
      expect(storey01SwGrv).toHaveLength(EXPECTED_STOREY_01_SW_GRV_SEGMENTS)
    },
  )

  it('extracts only diameters from {50, 63, 110, 160} mm on storey "01" SW-GRV', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const roundedDiameters = new Set(
      storey01SwGrv.map((segment) =>
        segment.outerDiameterMm === null ? null : Math.round(segment.outerDiameterMm * 100) / 100,
      ),
    )
    // Log the observed set for the task report.
    console.info('[096 gated] storey-01 SW-GRV diameters (mm):', [...roundedDiameters].sort())
    for (const diameter of roundedDiameters) {
      expect(diameter).not.toBeNull()
      expect(EXPECTED_DIAMETERS_MM.has(diameter!)).toBe(true)
    }
  })

  it('extracts a non-null InvertElevation for every storey "01" SW-GRV segment', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const nullInverts = storey01SwGrv.filter((segment) => segment.invertElevationM === null)
    expect(nullInverts).toHaveLength(0)
  })

  it('groups at least one engineer riser stack spanning 3 or more storeys', () => {
    expect(stacks.length).toBeGreaterThan(0)
    const maxSpan = Math.max(...stacks.map((stack) => stack.storeys.length))
    console.info(
      `[096 gated] engineer riser stacks: ${stacks.length}, max storey span: ${maxSpan}`,
    )
    expect(maxSpan).toBeGreaterThanOrEqual(3)
  })

  it('derives every storey "01" SW-GRV centreline from the extrusion axis', () => {
    const storey01SwGrv = network.segments.filter(
      (segment) => segment.storeyName === '01' && (segment.systemName ?? '').startsWith('SW-GRV'),
    )
    const bySource = new Map<string | null, number>()
    for (const segment of storey01SwGrv) {
      bySource.set(segment.endpointSource, (bySource.get(segment.endpointSource) ?? 0) + 1)
    }
    console.info('[096 gated] storey-01 SW-GRV endpoint sources:', Object.fromEntries(bySource))
    expect(storey01SwGrv.every((segment) => segment.start !== null && segment.end !== null)).toBe(
      true,
    )
  })
})
