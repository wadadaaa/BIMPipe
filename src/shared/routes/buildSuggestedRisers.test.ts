import { describe, expect, it } from 'vitest'
import type { DemoConfig } from '@/shared/demoConfig'
import type { ContinuityMap } from '@/domain/continuityMap'
import { toStackExtentFixtures } from '@/domain/riserStackExtent'
import type { Fixture, KitchenArea, Riser, Storey } from '@/domain/types'
import type { FloorMeshes } from '@/shared/ifc/extractFloorMeshes'
import {
  buildSuggestedRisers,
  buildSuggestedRisersWithSnap,
  buildWetCoreSuggestedRisers,
  type StackExtentOptions,
} from './buildSuggestedRisers'

const storeys: Storey[] = [
  { id: 1, name: 'קומה 1', elevation: 300, modelId: 'model-1' },
  { id: 2, name: 'קומה 2', elevation: 600, modelId: 'model-1' },
  { id: 3, name: 'קומה 3', elevation: 900, modelId: 'model-1' },
  { id: 4, name: 'קומה 4', elevation: 1200, modelId: 'model-1' },
  { id: 99, name: 'מרתף 1', elevation: -300, modelId: 'model-1' },
]

const toilet: Fixture = {
  expressId: 11,
  name: 'WC-11',
  kind: 'TOILETPAN',
  storeyId: 2,
  position: { x: 100, y: 600, z: 100 },
}

const demoConfig: DemoConfig = {
  name: 'test demo',
  model: { fileName: 'tower.ifc', schema: 'IFC2X3', source: 'x', assetPath: 'x' },
  // Demo routing is deliberately scoped to a single floor.
  scope: { includedFloors: ['קומה 2'], excludedFloors: [] },
  routing: { mode: 'demo', allowManualRiserSelection: true },
}

function makeLabeler(): () => string {
  let n = 1
  return () => `R${n++}`
}

describe('buildSuggestedRisers', () => {
  it('spans every eligible floor as one vertical stack even when the demo scope is a single floor', () => {
    const risers = buildSuggestedRisers(storeys, 2, [toilet], [], null, makeLabeler(), {
      enabled: true,
      config: demoConfig,
    })

    // Eligible floors: 1, 2, 3 (floor 4 is the penthouse, מרתף 1 is a basement — both excluded).
    // The riser is a vertical shaft, so it must appear on all eligible floors, not only קומה 2.
    expect(new Set(risers.map((riser) => riser.storeyId))).toEqual(new Set([1, 2, 3]))
    // All entries belong to the same physical stack.
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
    expect(new Set(risers.map((riser) => riser.stackLabel))).toEqual(new Set(['R1']))
  })

  it('spans the residential floors but honors demo-excluded floors (ADAM_10-like)', () => {
    const adamStoreys: Storey[] = [
      { id: 10, name: '-2.5', elevation: -250, modelId: 'model-1' },
      { id: 11, name: '-1 מרתף', elevation: -100, modelId: 'model-1' },
      { id: 12, name: 'קומת קרקע', elevation: 0, modelId: 'model-1' },
      { id: 13, name: 'קומה 1', elevation: 300, modelId: 'model-1' },
      { id: 14, name: 'קומה 2', elevation: 600, modelId: 'model-1' },
      { id: 15, name: 'קומה 3', elevation: 900, modelId: 'model-1' },
      { id: 16, name: 'קומה 4', elevation: 1200, modelId: 'model-1' },
      { id: 17, name: 'גג', elevation: 1500, modelId: 'model-1' },
    ]
    const adamConfig: DemoConfig = {
      ...demoConfig,
      scope: {
        includedFloors: ['קומת קרקע', 'קומה 1', 'קומה 2'],
        excludedFloors: ['-2.5', '-1 מרתף', 'גג'],
      },
    }
    const adamToilet: Fixture = { ...toilet, storeyId: 14, position: { x: 100, y: 600, z: 100 } }

    const risers = buildSuggestedRisers(adamStoreys, 14, [adamToilet], [], null, makeLabeler(), {
      enabled: true,
      config: adamConfig,
    })

    const floorIds = new Set(risers.map((riser) => riser.storeyId))
    // The shaft spans the residential floors. Crucially קומה 3 (15) is included — the floor where
    // the user reported risers vanishing. The Hebrew roof "גג" and "-2.5" are demo-excluded, and
    // the named basement is classifier-excluded, so the shaft never lands on them.
    expect(floorIds.has(15)).toBe(true) // קומה 3 — the reported bug
    expect(floorIds.has(14)).toBe(true) // קומה 2 (placement floor)
    expect(floorIds.has(12)).toBe(true) // ground
    expect(floorIds.has(10)).toBe(false) // '-2.5' demo-excluded
    expect(floorIds.has(11)).toBe(false) // named basement, classifier-excluded
    expect(floorIds.has(17)).toBe(false) // Hebrew roof demo-excluded
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
  })

  it('keeps the same stack across floors when demo mode is disabled', () => {
    const risers = buildSuggestedRisers(storeys, 2, [toilet], [], null, makeLabeler(), { enabled: false })

    expect(new Set(risers.map((riser) => riser.storeyId))).toEqual(new Set([1, 2, 3]))
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
  })
})

describe('buildSuggestedRisersWithSnap (W5 continuity flag)', () => {
  // One shaft candidate 0.5 m from the toilet on its own storey; empty grid.
  const map: ContinuityMap = {
    units: 'm',
    cellSize: 0.25,
    grids: [],
    shaftCandidates: [
      {
        id: 'shaft-space:2:space:7',
        source: 'shaft-named-space',
        center: { x: 100.5, z: 100 },
        bounds: { minX: 100.25, maxX: 100.75, minZ: 99.75, maxZ: 100.25 },
        polygon: null,
        storeyIds: [2],
        name: 'פיר',
      },
    ],
    diagnostics: [],
  }

  it('without the snap option, risers match buildSuggestedRisers exactly and no outcomes are recorded', () => {
    const plain = buildSuggestedRisers(storeys, 2, [toilet], [], null, makeLabeler(), { enabled: false })
    const withSnap = buildSuggestedRisersWithSnap(storeys, 2, [toilet], [], null, makeLabeler(), {
      enabled: false,
    })

    expect(withSnap.risers.map((riser) => riser.position)).toEqual(plain.map((riser) => riser.position))
    expect(withSnap.snapOutcomes).toHaveLength(0)
  })

  it('with the snap option, the stack moves to the shaft and the outcome carries its stack label', () => {
    const { risers, snapOutcomes } = buildSuggestedRisersWithSnap(
      storeys,
      2,
      [toilet],
      [],
      null,
      makeLabeler(),
      { enabled: false },
      { map },
    )

    // Every floor of the stack lands on the shaft centre.
    expect(new Set(risers.map((riser) => `${riser.position.x},${riser.position.z}`))).toEqual(
      new Set(['100.5,100']),
    )
    expect(snapOutcomes).toEqual([
      {
        stackLabel: 'R1',
        snap: {
          status: 'snapped',
          target: 'shaft',
          shaftId: 'shaft-space:2:space:7',
          distance: 0.5,
          original: { x: 100, y: 600, z: 100 },
        },
      },
    ])
    // The snap metadata never leaks into the riser objects themselves.
    expect(risers.every((riser) => !('snap' in riser.position) && !('snap' in riser))).toBe(true)
  })

  it('a miss keeps the anchor position and records the reason', () => {
    const emptyMap: ContinuityMap = { ...map, shaftCandidates: [] }
    const { risers, snapOutcomes } = buildSuggestedRisersWithSnap(
      storeys,
      2,
      [toilet],
      [],
      null,
      makeLabeler(),
      { enabled: false },
      { map: emptyMap },
    )

    expect(risers.every((riser) => riser.position.x === 100 && riser.position.z === 100)).toBe(true)
    expect(snapOutcomes).toHaveLength(1)
    expect(snapOutcomes[0].snap.status).toBe('snapMiss')
  })
})

describe('buildSuggestedRisersWithSnap (V4 stack extent)', () => {
  // Tower: basement, ground, 1..5, technical roof. WCs at the same XY on
  // ground..3; storey 4 has a WC elsewhere on the plan, 5 has none.
  const tower: Storey[] = [
    { id: 10, name: 'B1', elevation: -3, modelId: 'model-1' },
    { id: 11, name: 'GF', elevation: 0, modelId: 'model-1' },
    { id: 12, name: '1', elevation: 3, modelId: 'model-1' },
    { id: 13, name: '2', elevation: 6, modelId: 'model-1' },
    { id: 14, name: '3', elevation: 9, modelId: 'model-1' },
    { id: 15, name: '4', elevation: 12, modelId: 'model-1' },
    { id: 16, name: '5', elevation: 15, modelId: 'model-1' },
    { id: 17, name: 'R1', elevation: 18, modelId: 'model-1' },
  ]
  const wcAt = (storeyId: number, x: number, elevation: number): Fixture => ({
    expressId: storeyId * 100,
    name: `WC-${storeyId}`,
    kind: 'TOILETPAN',
    storeyId,
    position: { x, y: elevation, z: 5 },
  })
  const buildingFixtures: Fixture[] = [
    wcAt(11, 10, 0),
    wcAt(12, 10.3, 3),
    wcAt(13, 9.8, 6),
    wcAt(14, 10.1, 9),
    wcAt(15, 30, 12), // different core position → does not continue the stack
  ]
  const sourceFixtures = buildingFixtures.filter((fixture) => fixture.storeyId === 12)
  const extentOptions: StackExtentOptions = {
    buildingFixtures: toStackExtentFixtures(buildingFixtures, []),
    planUnits: 'm',
  }

  it('without the option, every eligible storey is spanned and no extents are reported (unchanged behaviour)', () => {
    const { risers, stackExtents } = buildSuggestedRisersWithSnap(
      tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: false },
    )

    // Eligibility-based list: B1 (basement) and R1 (no roof keyword, so classified as the
    // penthouse) are excluded; everything else is spanned, including 4 and 5.
    expect(risers.map((riser) => riser.storeyId)).toEqual([11, 12, 13, 14, 15, 16])
    expect(stackExtents).toEqual([])
  })

  it('with the option, the stack runs from the collector to the last storey with a matching core', () => {
    const { risers, stackExtents } = buildSuggestedRisersWithSnap(
      tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: false }, undefined, extentOptions,
    )

    // Collector = B1 (basements count); up through 3; 4's WC is 20 m away → stop; 5/R1 never reached.
    expect(risers.map((riser) => riser.storeyId)).toEqual([10, 11, 12, 13, 14])
    expect(risers.every((riser) => riser.source === 'detected')).toBe(true)
    expect(risers.every((riser) => riser.levelRange?.from === 10 && riser.levelRange?.to === 14)).toBe(true)
    expect(new Set(risers.map((riser) => riser.stackId)).size).toBe(1)
    expect(stackExtents).toHaveLength(1)
    expect(stackExtents[0].stackLabel).toBe('R1')
    expect(stackExtents[0].extent).toMatchObject({
      storeyIds: [10, 11, 12, 13, 14],
      collectorStoreyId: 10,
      topStoreyId: 14,
      anchorCoreFingerprint: 'TOILETPAN',
    })
    expect(stackExtents[0].extent.reasons.some((reason) => reason.startsWith('no matching core on 4'))).toBe(true)
  })

  it('honours the collector override and still applies demo floor exclusions', () => {
    const config: DemoConfig = {
      ...demoConfig,
      scope: { includedFloors: ['1'], excludedFloors: ['GF'] },
    }
    const { risers, stackExtents } = buildSuggestedRisersWithSnap(
      tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: true, config }, undefined,
      { ...extentOptions, collectorStoreyId: 11 },
    )

    // Extent = GF..3 (collector override GF); GF is demo-excluded, so the risers skip it
    // while the extent decision itself still records GF as the collector.
    expect(stackExtents[0].extent.storeyIds).toEqual([11, 12, 13, 14])
    expect(risers.map((riser) => riser.storeyId)).toEqual([12, 13, 14])
  })

  it('evaluates the extent at the snapped position when both options are on', () => {
    // Shaft candidate 0.5 m from the anchor WC on storey 1; the extent must be
    // computed at the snapped XY (still within the 2.6 m core radius here).
    const map: ContinuityMap = {
      units: 'm',
      cellSize: 0.25,
      grids: [],
      shaftCandidates: [
        {
          id: 'shaft-space:12:space:1',
          source: 'shaft-named-space',
          center: { x: 10.8, z: 5 },
          bounds: { minX: 10.6, maxX: 11, minZ: 4.8, maxZ: 5.2 },
          polygon: null,
          storeyIds: [12],
        },
      ],
      diagnostics: [],
    }
    const { risers, snapOutcomes, stackExtents } = buildSuggestedRisersWithSnap(
      tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: false }, { map },
      { ...extentOptions, continuityMap: map },
    )

    expect(snapOutcomes[0].snap.status).toBe('snapped')
    expect(risers.every((riser) => riser.position.x === 10.8)).toBe(true)
    expect(stackExtents[0].extent.storeyIds).toEqual([10, 11, 12, 13, 14])
  })

  it('leaves manual overrides untouched: the extent only shapes the auto stacks it creates', () => {
    // A manual stack placed earlier spans floors the extent would never choose
    // (5 and R1). The suggest step neither reads nor rewrites it: merging the
    // page's existing manual risers with the new auto stacks keeps every manual
    // entry byte-identical, and no auto riser ever carries `source: 'manual'`.
    const manualStack: Riser[] = tower.map((storey) => ({
      id: `manual-${storey.id}`,
      stackId: 'manual-stack',
      stackLabel: 'M1',
      storeyId: storey.id,
      position: { x: 40, y: storey.elevation, z: 40 },
      source: 'manual',
      systemType: 'sanitary',
    }))
    const manualSnapshot = JSON.parse(JSON.stringify(manualStack)) as Riser[]

    const { risers } = buildSuggestedRisersWithSnap(
      tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: false }, undefined, extentOptions,
    )
    const merged = [...manualStack, ...risers]

    expect(manualStack).toEqual(manualSnapshot)
    expect(merged.filter((riser) => riser.source === 'manual')).toEqual(manualSnapshot)
    expect(merged.filter((riser) => riser.source === 'manual').map((riser) => riser.storeyId)).toContain(17)
    expect(risers.every((riser) => riser.source === 'detected')).toBe(true)
  })

  it('is deterministic: two runs produce identical storey lists and reasons', () => {
    const run = () =>
      buildSuggestedRisersWithSnap(
        tower, 12, sourceFixtures, [], null, makeLabeler(), { enabled: false }, undefined, extentOptions,
      )
    const first = run()
    const second = run()
    expect(first.stackExtents).toEqual(second.stackExtents)
    expect(first.risers.map((riser) => [riser.storeyId, riser.position])).toEqual(
      second.risers.map((riser) => [riser.storeyId, riser.position]),
    )
  })
})

describe('buildWetCoreSuggestedRisers (V3 wet cores)', () => {
  const metric: Storey[] = [
    { id: 1, name: 'GF', elevation: 0, modelId: 'model-1' },
    { id: 2, name: '1', elevation: 3, modelId: 'model-1' },
    { id: 3, name: '2', elevation: 6, modelId: 'model-1' },
  ]
  const fixtureAt = (expressId: number, kind: Fixture['kind'], x: number, z: number): Fixture => ({
    expressId,
    name: `F-${expressId}`,
    kind,
    storeyId: 2,
    position: { x, y: 3, z },
  })
  // Two wet cores on storey 1: WC + basin (1 m apart) and a lone WC 10 m away;
  // a fixture on another storey and one without a position are ignored/reported.
  const fixtures: Fixture[] = [
    fixtureAt(1, 'TOILETPAN', 10, 5),
    fixtureAt(2, 'WASHHANDBASIN', 11, 5),
    fixtureAt(3, 'TOILETPAN', 20, 5),
    { ...fixtureAt(4, 'TOILETPAN', 10, 5), storeyId: 3 },
    { ...fixtureAt(5, 'SINK', 0, 0), position: null },
  ]
  const kitchen: KitchenArea = {
    expressId: 50,
    name: 'Kitchen',
    storeyId: 2,
    position: { x: 30, y: 3, z: 10 },
  }
  const floorMeshes = {
    boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 0, z: 20 } },
  } as unknown as FloorMeshes

  it('places exactly one stack per wet core plus one per kitchen, spanning eligible storeys', () => {
    const result = buildWetCoreSuggestedRisers({
      storeys: metric,
      sourceStoreyId: 2,
      fixtures,
      kitchens: [kitchen],
      floorMeshes,
      nextLabel: makeLabeler(),
      wetCore: { planUnits: 'm' },
    })

    expect(result.cores.map((core) => core.id)).toEqual(['wet-core:2:1+2', 'wet-core:2:3'])
    expect(result.stacks.map((stack) => stack.anchor)).toEqual(['wet-core', 'wet-core', 'kitchen'])
    expect(result.stacks.map((stack) => stack.stackLabel)).toEqual(['R1', 'R2', 'R3'])
    expect(new Set(result.risers.map((riser) => riser.stackId)).size).toBe(3)
    expect(result.risers.every((riser) => riser.source === 'detected')).toBe(true)
    // Every stack spans the eligible storeys (GF, 1; storey 2 is the top → penthouse-excluded).
    expect(result.risers.filter((riser) => riser.stackLabel === 'R1').map((riser) => riser.storeyId)).toEqual([1, 2])
    expect(result.diagnostics).toEqual(['1 fixture(s) without a plan position were not clustered: 5'])
    // Stack ids are wired for override keying.
    expect(result.stacks.every((stack) => stack.stackId.length > 0)).toBe(true)
    expect(result.stacks[0].stackId).toBe(result.risers[0].stackId)
  })

  it('without a continuity map uses the wall-side edge and reports no snap outcome for it', () => {
    const result = buildWetCoreSuggestedRisers({
      storeys: metric,
      sourceStoreyId: 2,
      fixtures,
      kitchens: [],
      floorMeshes,
      nextLabel: makeLabeler(),
      wetCore: { planUnits: 'm' },
    })
    const first = result.stacks[0]
    expect(first.anchor).toBe('wet-core')
    if (first.anchor !== 'wet-core') return
    // Plan centre is (20, 10); the core (x 10–11, z 5) is farthest from it on its minX edge.
    expect(first.placement.rule).toBe('wall-side-edge')
    expect(first.position).toEqual({ x: 9.85, y: 3, z: 5 })
    expect(result.snapOutcomes).toEqual([])
  })

  it('snaps a core to a shaft candidate and the kitchen corner to the map; extents are evaluated at the final XY', () => {
    const map: ContinuityMap = {
      units: 'm',
      cellSize: 0.25,
      grids: [],
      shaftCandidates: [
        {
          id: 'shaft-space:2:space:1',
          source: 'shaft-named-space',
          center: { x: 11.5, z: 5.5 },
          bounds: { minX: 11.3, maxX: 11.7, minZ: 5.3, maxZ: 5.7 },
          polygon: null,
          storeyIds: [2],
        },
      ],
      diagnostics: [],
    }
    const result = buildWetCoreSuggestedRisers({
      storeys: metric,
      sourceStoreyId: 2,
      fixtures,
      kitchens: [kitchen],
      floorMeshes,
      nextLabel: makeLabeler(),
      wetCore: { planUnits: 'm', continuityMap: map },
      stackExtent: { buildingFixtures: toStackExtentFixtures(fixtures, [kitchen]), planUnits: 'm', continuityMap: map },
    })

    const [first, second, third] = result.stacks
    expect(first.anchor === 'wet-core' && first.placement.rule).toBe('shaft')
    expect(first.position).toEqual({ x: 11.5, y: 3, z: 5.5 })
    // Second core: map has no grid for the storey and no candidate in range → wall-side edge.
    expect(second.anchor === 'wet-core' && second.placement.rule).toBe('wall-side-edge')
    // Kitchen: corner stays, map miss is explicit.
    expect(third.anchor).toBe('kitchen')
    expect(third.anchor === 'kitchen' && third.snap?.status).toBe('snapMiss')
    expect(result.snapOutcomes.map((outcome) => [outcome.stackLabel, outcome.snap.status])).toEqual([
      ['R1', 'snapped'],
      ['R3', 'snapMiss'],
    ])
    expect(result.stackExtents).toHaveLength(3)
    expect(result.stackExtents[0].extent.storeyIds).toContain(2)
    expect(result.risers.every((riser) => !('snap' in riser) && !('placement' in riser))).toBe(true)
  })

  it('skips cores whose moved stack is preserved without consuming a label (contiguous labels on re-suggest)', () => {
    const labels: string[] = []
    const labeler = makeLabeler()
    const result = buildWetCoreSuggestedRisers({
      storeys: metric,
      sourceStoreyId: 2,
      fixtures,
      kitchens: [kitchen],
      floorMeshes,
      nextLabel: () => {
        const label = labeler()
        labels.push(label)
        return label
      },
      wetCore: { planUnits: 'm' },
      preservedCoreIds: new Set(['wet-core:2:1+2']),
    })

    // Only the second core and the kitchen get stacks; the labeler was called exactly twice.
    expect(labels).toEqual(['R1', 'R2'])
    expect(result.stacks.map((stack) => [stack.anchor, stack.stackLabel])).toEqual([
      ['wet-core', 'R1'],
      ['kitchen', 'R2'],
    ])
    expect(result.stacks[0].anchor === 'wet-core' && result.stacks[0].core.id).toBe('wet-core:2:3')
    // Every core is still reported so fixture membership can route to the preserved stack.
    expect(result.cores.map((core) => core.id)).toEqual(['wet-core:2:1+2', 'wet-core:2:3'])
    expect(result.diagnostics).toContain(
      'core TOILETPAN+WASHHANDBASIN (2 fixtures) keeps its moved stack; no new auto stack',
    )
  })

  it('passes the wet core fingerprint to the stack extent so a snapped stack keeps its own core', () => {
    // Building fixtures: the core's WC continues on storey GF and 2 at the same
    // XY, but a basin sits next to the stack on the anchor storey only.
    const buildingFixtures = toStackExtentFixtures(
      [
        fixtureAt(1, 'TOILETPAN', 20, 5),
        { ...fixtureAt(4, 'WASHHANDBASIN', 20.5, 5), storeyId: 2 },
        { ...fixtureAt(2, 'TOILETPAN', 20, 5), storeyId: 1 },
        { ...fixtureAt(3, 'TOILETPAN', 20, 5), storeyId: 3 },
      ],
      [],
    )
    const result = buildWetCoreSuggestedRisers({
      storeys: metric,
      sourceStoreyId: 2,
      fixtures: [fixtureAt(1, 'TOILETPAN', 20, 5)],
      kitchens: [],
      floorMeshes,
      nextLabel: makeLabeler(),
      wetCore: { planUnits: 'm' },
      stackExtent: { buildingFixtures, planUnits: 'm' },
    })
    expect(result.stackExtents).toHaveLength(1)
    const { extent } = result.stackExtents[0]
    expect(extent.anchorCoreFingerprint).toBe('TOILETPAN')
    expect(extent.reasons[0]).toBe('anchor core on 1: TOILETPAN (wet-core membership)')
    // Storey 2 has a WC at the XY → matching core → spanned (GF, 1, 2).
    expect(extent.storeyIds).toEqual([1, 2, 3])
  })

  it('is deterministic regardless of fixture input order', () => {
    const run = (input: Fixture[]) =>
      buildWetCoreSuggestedRisers({
        storeys: metric,
        sourceStoreyId: 2,
        fixtures: input,
        kitchens: [],
        floorMeshes,
        nextLabel: makeLabeler(),
        wetCore: { planUnits: 'm' },
      })
    const first = run(fixtures)
    const second = run([...fixtures].reverse())
    expect(second.cores.map((core) => core.id)).toEqual(first.cores.map((core) => core.id))
    expect(second.risers.map((riser) => [riser.stackLabel, riser.storeyId, riser.position])).toEqual(
      first.risers.map((riser) => [riser.stackLabel, riser.storeyId, riser.position]),
    )
  })
})
