import { describe, it, expect, vi } from 'vitest'
import { classifyFixtureText, detectFixtures, type FixtureTextClassification } from './detectFixtures'
import type { IfcAPI } from 'web-ifc'

const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617
const IFCRELREFERENCEDINSPATIALSTRUCTURE = 1464116758
const IFCRELAGGREGATES = 160246688
const IFCSPACE = 3856911033
const IFCSANITARYTERMINAL = 3053780
const IFCFLOWTERMINAL = 1623761950
const IFCBUILDINGELEMENTPROXY = 819412036
const IFCFURNISHINGELEMENT = 263784265

vi.mock('web-ifc', () => ({
  IFCRELCONTAINEDINSPATIALSTRUCTURE: 3242617,
  IFCRELREFERENCEDINSPATIALSTRUCTURE: 1464116758,
  IFCRELAGGREGATES: 160246688,
  IFCSPACE: 3856911033,
  IFCSANITARYTERMINAL: 3053780,
  IFCFLOWTERMINAL: 1623761950,
  IFCBUILDINGELEMENTPROXY: 819412036,
  IFCFURNISHINGELEMENT: 263784265,
}))

interface RelLine {
  relatingStoreyId: number
  elementIds: number[]
}

interface AggregateRelLine {
  relatingObjectId: number
  relatedObjectIds: number[]
}

interface FixtureLine {
  id: number
  ifcType: number
  name: string | null
  objectType?: string | null
  predefinedType: string | null
  position?: { x: number; y: number; z: number }
}

// Identity flat transformation with translation (tx, ty, tz) at indices [12,13,14]
function makeFlatTransform(tx = 0, ty = 0, tz = 0): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
}

// Unit cube corners centred at origin, stride 6 (pos + dummy normal).
// With an identity rotation + translation T, bbox centre == T exactly.
const UNIT_BOX_VERTS = new Float32Array([
  -0.5, -0.5, -0.5, 0, 0, -1,
   0.5, -0.5, -0.5, 0, 0, -1,
  -0.5,  0.5, -0.5, 0, 0, -1,
   0.5,  0.5, -0.5, 0, 0, -1,
  -0.5, -0.5,  0.5, 0, 0,  1,
   0.5, -0.5,  0.5, 0, 0,  1,
  -0.5,  0.5,  0.5, 0, 0,  1,
   0.5,  0.5,  0.5, 0, 0,  1,
])

function makeApi(rels: RelLine[], fixtureLines: FixtureLine[], aggregateRels: AggregateRelLine[] = []): IfcAPI {
  const relIds = {
    size: () => rels.length,
    get: (i: number) => 1000 + i,
  }
  const aggregateRelIds = {
    size: () => aggregateRels.length,
    get: (i: number) => 2000 + i,
  }

  function idList(type: number) {
    const matches = fixtureLines.filter((f) => f.ifcType === type)
    return { size: () => matches.length, get: (i: number) => matches[i].id }
  }

  return {
    GetLineIDsWithType: vi.fn((_: number, type: number) => {
      if (type === IFCRELCONTAINEDINSPATIALSTRUCTURE) return relIds
      if (type === IFCRELREFERENCEDINSPATIALSTRUCTURE) {
        return { size: () => 0, get: () => 0 }
      }
      if (type === IFCRELAGGREGATES) return aggregateRelIds
      return idList(type)
    }),
    GetLine: vi.fn((_modelId: number, expressID: number) => {
      // Rel express IDs start at 1000 (see relIds.get above); fixture IDs are < 1000
      if (expressID >= 1000) {
        if (expressID >= 2000) {
          const rel = aggregateRels[expressID - 2000]
          return {
            RelatingObject: { value: rel.relatingObjectId },
            RelatedObjects: rel.relatedObjectIds.map((id) => ({ value: id })),
          }
        }
        const rel = rels[expressID - 1000]
        return {
          RelatingStructure: { value: rel.relatingStoreyId },
          RelatedElements: rel.elementIds.map((id) => ({ value: id })),
        }
      }
      const fixture = fixtureLines.find((f) => f.id === expressID)!
      return {
        Name: fixture.name !== null ? { value: fixture.name } : null,
        LongName: null,
        ObjectType: fixture.objectType ? { value: fixture.objectType } : null,
        PredefinedType: fixture.predefinedType !== null ? { value: fixture.predefinedType } : null,
      }
    }),
    GetFlatMesh: vi.fn((_modelId: number, _expressId: number) => ({
      geometries: {
        size: () => 1,
        get: () => {
          const fixture = fixtureLines.find((item) => item.id === _expressId)
          const position = fixture?.position ?? { x: _expressId * 10, y: _expressId * 5, z: 2 }
          return {
            geometryExpressID: _expressId * 100,
            flatTransformation: makeFlatTransform(position.x, position.y, position.z),
          }
        },
      },
    })),
    GetGeometry: vi.fn(() => ({
      GetVertexData: () => 0,
      GetVertexDataSize: () => UNIT_BOX_VERTS.length,
      delete: vi.fn(),
    })),
    GetVertexArray: vi.fn(() => UNIT_BOX_VERTS),
  } as unknown as IfcAPI
}

// Shorthand helpers
const asSanitary = (id: number, name: string, predefinedType: string): FixtureLine =>
  ({ id, ifcType: IFCSANITARYTERMINAL, name, predefinedType })
const asFlowTerminal = (id: number, name: string, predefinedType: string): FixtureLine =>
  ({ id, ifcType: IFCFLOWTERMINAL, name, predefinedType })
const asProxy = (id: number, name: string, objectType?: string): FixtureLine =>
  ({ id, ifcType: IFCBUILDINGELEMENTPROXY, name, objectType: objectType ?? null, predefinedType: null })
const asFurnishing = (id: number, name: string, objectType?: string): FixtureLine =>
  ({ id, ifcType: IFCFURNISHINGELEMENT, name, objectType: objectType ?? null, predefinedType: null })
const asOddExport = (id: number, name: string, objectType?: string): FixtureLine =>
  ({ id, ifcType: 999999999, name, objectType: objectType ?? null, predefinedType: null })

describe('detectFixtures', () => {
  // --- typed fixtures ---

  it('returns IFCSANITARYTERMINAL fixtures in the storey', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [101, 102] }],
      [
        asSanitary(101, 'WC-01', 'TOILETPAN'),
        asSanitary(102, 'Basin-01', 'WASHHANDBASIN'),
      ],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ expressId: 101, name: 'WC-01', kind: 'TOILETPAN', storeyId: 5 })
    expect(result[1]).toMatchObject({ expressId: 102, name: 'Basin-01', kind: 'WASHHANDBASIN', storeyId: 5 })
  })

  it('returns IFCFLOWTERMINAL fixtures in the storey', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [201] }],
      [asFlowTerminal(201, 'Tap-01', 'SINK')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 201, kind: 'SINK' })
  })

  it('excludes broad IFCFLOWTERMINAL elements when they do not look like plumbing fixtures', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [202] }],
      [asFlowTerminal(202, 'Water heater:DOD:12013965', 'NOTDEFINED')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toEqual([])
  })

  it('keeps IFCFLOWTERMINAL elements with unknown predefined type when the name still matches plumbing keywords', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [203] }],
      [asFlowTerminal(203, 'WC-Guest-01', 'NOTDEFINED')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 203, kind: 'TOILETPAN' })
  })

  it('maps all known predefined types correctly', async () => {
    const kinds = ['BATH', 'SINK', 'TOILETPAN', 'URINAL', 'WASHHANDBASIN', 'CISTERN', 'BIDET'] as const
    const fixtures = kinds.map((kind, i) => asSanitary(i + 1, kind, kind))
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: fixtures.map((f) => f.id) }],
      fixtures,
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result.map((f) => f.kind)).toEqual(kinds)
  })

  it('maps unknown and NOTDEFINED predefined types to OTHER', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10, 11] }],
      [asSanitary(10, 'X', 'NOTDEFINED'), asSanitary(11, 'Y', 'USERDEFINED')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].kind).toBe('OTHER')
    expect(result[1].kind).toBe('OTHER')
  })

  it('maps null predefined type to OTHER', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10] }],
      [{ id: 10, ifcType: IFCSANITARYTERMINAL, name: 'Mystery', predefinedType: null }],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].kind).toBe('OTHER')
  })

  it('is case-insensitive when mapping predefined type', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10] }],
      [asSanitary(10, 'Toilet', 'toiletpan')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].kind).toBe('TOILETPAN')
  })

  it('excludes typed shower terminals from IFC fixture detection', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [12] }],
      [asSanitary(12, 'Shower-01', 'SHOWER')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toEqual([])
  })

  it('falls back to a placeholder name when Name is null', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [42] }],
      [{ id: 42, ifcType: IFCSANITARYTERMINAL, name: null, predefinedType: 'SINK' }],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].name).toContain('42')
  })

  // --- proxy detection ---

  it('includes IFCBUILDINGELEMENTPROXY when Name matches a plumbing keyword', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [301] }],
      [asProxy(301, 'Toilet:WC-A')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 301, kind: 'TOILETPAN' })
  })

  it('includes IFCBUILDINGELEMENTPROXY when ObjectType matches a plumbing keyword', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [302] }],
      [asProxy(302, 'Generic fixture', 'Washhand Basin')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'WASHHANDBASIN' })
  })

  it('excludes IFCBUILDINGELEMENTPROXY when Name does not match any plumbing keyword', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [303] }],
      [asProxy(303, 'Structural column type A')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(0)
  })

  it('maps proxy keywords to the correct FixtureKind', async () => {
    const cases: Array<[string, string]> = [
      ['Toilet pan', 'TOILETPAN'],
      ['WC unit', 'TOILETPAN'],
      ['אסלה נגישה', 'TOILETPAN'],
      ['כיור מטבח', 'SINK'],
      ['Wash hand basin', 'WASHHANDBASIN'],
      ['כיור רחצה', 'WASHHANDBASIN'],
      ['Kitchen sink', 'SINK'],
      ['Bathtub', 'BATH'],
      ['Urinal', 'URINAL'],
      ['Bidet', 'BIDET'],
    ]
    for (const [name, expectedKind] of cases) {
      const api = makeApi(
        [{ relatingStoreyId: 1, elementIds: [1] }],
        [asProxy(1, name)],
      )
      const result = await detectFixtures(api, 0, 1)
      expect(result[0]?.kind, `name="${name}"`).toBe(expectedKind)
    }
  })

  it('treats a text-only cistern as an accessory, not a proxy fixture', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1] }],
      [asProxy(1, 'Cistern')],
    )
    expect(await detectFixtures(api, 0, 1)).toEqual([])
  })

  it('keeps an IfcSanitaryTerminal explicitly typed CISTERN as a CISTERN fixture', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1] }],
      [asSanitary(1, 'Flushing tank', 'CISTERN')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('CISTERN')
  })

  // --- Revit `Category : Family : Type` name patterns (sanitary + architecture exports) ---

  it('classifies basins whose family name carries a bare WC token as basins, not toilets', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1, 2] }],
      [
        asFlowTerminal(1, 'Plumbing Fixtures : LIB_Sanitary-Sink-WC-2D-NH : כיור אובלי תלוי', 'NOTDEFINED'),
        asFlowTerminal(2, 'Plumbing Fixtures : LIB_Sanitary-WC-2D-NH : אסלה תלויה', 'NOTDEFINED'),
      ],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result.map((fixture) => fixture.kind)).toEqual(['WASHHANDBASIN', 'TOILETPAN'])
  })

  it('does not count a flushing tank next to a toilet as a second toilet', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1, 2] }],
      [
        asFlowTerminal(1, 'Plumbing Fixtures : AR-Plumbing-Toilet-3D : Type 01', 'NOTDEFINED'),
        asFlowTerminal(2, 'Plumbing Fixtures : AR-Flushing-Tank-for-Toilet-3D : Type 01', 'NOTDEFINED'),
      ],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 1, kind: 'TOILETPAN' })
  })

  it('counts a multi-bowl sink family as ONE sink fixture per IFC element', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1] }],
      [asFlowTerminal(1, 'Plumbing Fixtures : AR-Multi-Sinks-3D : 5 Sinks', 'NOTDEFINED')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'SINK', isKitchenSink: false })
  })

  it('never turns fire-protection flow terminals into sanitary fixtures', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1, 2, 3, 4] }],
      [
        asFlowTerminal(1, 'Fire Protection : Sprinkler-Pendent : K5.6', 'NOTDEFINED'),
        asFlowTerminal(2, 'Fire Protection : AR-\uFEFFHydrant-Fire-Cabinet-3D : Type 02', 'NOTDEFINED'),
        asProxy(3, 'Mechanical Equipment : LIB_Fire-Hose_Reel : Standard'),
        asFlowTerminal(4, 'Fire Protection : SPR Head : Upright', 'NOTDEFINED'),
      ],
    )
    expect(await detectFixtures(api, 0, 1)).toEqual([])
  })

  it('never turns P-traps, floor traps or floor drains into toilets or basins', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [1, 2, 3, 4] }],
      [
        asFlowTerminal(1, 'Plumbing Fixtures : LIB_Sanitary-P_Trap-Generic : 1-1/4" - 150mm - סיפון מתכת', 'NOTDEFINED'),
        asFlowTerminal(2, 'Plumbing Fixtures : LIB_Drain-Floor_Trap-6x4 : 6x4 - מ.ר', 'NOTDEFINED'),
        asFlowTerminal(3, 'Plumbing Fixtures : LIB_Drain-Floor_Drain-Drop-4inch : 4" - ק.ב.נ', 'NOTDEFINED'),
        asSanitary(4, 'P-Trap 40mm', 'NOTDEFINED'),
      ],
    )
    expect(await detectFixtures(api, 0, 1)).toEqual([])

    const withDrains = await detectFixtures(api, 0, 1, { includeShowerFloorDrains: true })
    expect(withDrains.map((fixture) => [fixture.expressId, fixture.kind])).toEqual([
      [2, 'OTHER'],
      [3, 'OTHER'],
    ])
  })

  it('excludes shower keywords from proxy fixture detection', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [304] }],
      [asProxy(304, 'Shower tray')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toEqual([])
  })

  // --- shower / floor-drain inclusion flag ---

  it('includes typed shower terminals as OTHER when includeShowerFloorDrains is enabled', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [12] }],
      [asSanitary(12, 'Shower-01', 'SHOWER')],
    )
    const result = await detectFixtures(api, 0, 1, { includeShowerFloorDrains: true })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 12, kind: 'OTHER' })
  })

  it('flips shower proxy inclusion with the includeShowerFloorDrains flag', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [304] }],
      [asProxy(304, 'Shower tray')],
    )
    const excluded = await detectFixtures(api, 0, 1)
    const included = await detectFixtures(api, 0, 1, { includeShowerFloorDrains: true })
    expect(excluded).toEqual([])
    expect(included).toHaveLength(1)
    expect(included[0]).toMatchObject({ expressId: 304, kind: 'OTHER' })
  })

  it('detects floor drains as OTHER only when includeShowerFloorDrains is enabled', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [305] }],
      [asFlowTerminal(305, 'Floor drain 50mm', 'NOTDEFINED')],
    )
    const excluded = await detectFixtures(api, 0, 1)
    const included = await detectFixtures(api, 0, 1, { includeShowerFloorDrains: true })
    expect(excluded).toEqual([])
    expect(included).toHaveLength(1)
    expect(included[0]).toMatchObject({ expressId: 305, kind: 'OTHER' })
  })

  it('includes IFCFURNISHINGELEMENT when its metadata matches a plumbing keyword', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [401] }],
      [asFurnishing(401, 'Family 01', 'אסלה')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 401, kind: 'TOILETPAN' })
  })

  it('falls back to keyword matching across all storey elements for unusual IFC classes', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [501] }],
      [asOddExport(501, 'Generic family', 'WC Accessible')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 501, kind: 'TOILETPAN' })
  })

  it('finds fixtures contained inside IFCSPACE aggregated under the storey', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 7001, elementIds: [601] }],
      [asSanitary(601, 'WC in space', 'TOILETPAN')],
      [{ relatingObjectId: 5, relatedObjectIds: [7001] }],
    )

    const result = await detectFixtures(api, 0, 5)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 601, kind: 'TOILETPAN', storeyId: 5 })
  })

  it('marks sinks inside kitchen spaces as kitchen sinks', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 701, elementIds: [602] }],
      [
        asSanitary(602, 'Sink-01', 'SINK'),
        { id: 701, ifcType: IFCSPACE, name: 'Kitchen', predefinedType: null },
      ],
      [{ relatingObjectId: 5, relatedObjectIds: [701] }],
    )

    const result = await detectFixtures(api, 0, 5)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 602, kind: 'SINK', isKitchenSink: true })
  })

  it('reclassifies generic basins inside kitchen spaces as sinks', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 702, elementIds: [603] }],
      [
        asSanitary(603, 'כיור', 'WASHHANDBASIN'),
        { id: 702, ifcType: IFCSPACE, name: 'מטבח', predefinedType: null },
      ],
      [{ relatingObjectId: 5, relatedObjectIds: [702] }],
    )

    const result = await detectFixtures(api, 0, 5)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 603, kind: 'SINK', isKitchenSink: true })
  })

  // --- shared behaviours ---

  it('merges results from all three types without duplicates', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [101, 201, 301] }],
      [
        asSanitary(101, 'WC-01', 'TOILETPAN'),
        asFlowTerminal(201, 'Tap-01', 'SINK'),
        asProxy(301, 'Toilet:T1'),
      ],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(3)
    expect(result.map((f) => f.expressId)).toEqual([101, 201, 301])
  })

  it('does not duplicate an element that appears under multiple type queries', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 5, elementIds: [101] }],
      [
        asSanitary(101, 'WC-01', 'TOILETPAN'),
        asFlowTerminal(101, 'WC-01', 'TOILETPAN'),
      ],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
  })

  it('excludes fixtures that belong to a different storey', async () => {
    const api = makeApi(
      [
        { relatingStoreyId: 5, elementIds: [101] },
        { relatingStoreyId: 6, elementIds: [102] },
      ],
      [asSanitary(101, 'WC-01', 'TOILETPAN'), asSanitary(102, 'WC-02', 'TOILETPAN')],
    )
    const result = await detectFixtures(api, 0, 5)
    expect(result).toHaveLength(1)
    expect(result[0].expressId).toBe(101)
  })

  it('returns an empty array when the storey has no matching elements', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [] }],
      [asSanitary(10, 'WC', 'TOILETPAN')],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result).toEqual([])
  })

  it('attaches the storeyId to each fixture', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 7, elementIds: [20] }],
      [asSanitary(20, 'Sink', 'SINK')],
    )
    const result = await detectFixtures(api, 0, 7)
    expect(result[0].storeyId).toBe(7)
  })

  // --- position extraction ---

  it('attaches position from GetFlatMesh translation', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10] }],
      [{ ...asSanitary(10, 'WC', 'TOILETPAN'), position: { x: 3, y: 7, z: 2 } }],
    )
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].position).toEqual({ x: 3, y: 7, z: 2 })
  })

  it('sets position to null when GetFlatMesh returns no geometries', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10] }],
      [asSanitary(10, 'WC', 'TOILETPAN')],
    )
    ;(api.GetFlatMesh as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      geometries: { size: () => 0, get: () => null },
    })
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].position).toBeNull()
  })

  it('sets position to null when GetFlatMesh throws', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [10] }],
      [asSanitary(10, 'WC', 'TOILETPAN')],
    )
    ;(api.GetFlatMesh as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('WASM error')
    })
    const result = await detectFixtures(api, 0, 1)
    expect(result[0].position).toBeNull()
  })

  it('deduplicates near-identical fixtures of the same kind by position', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [101, 301] }],
      [
        { ...asSanitary(101, 'WC-01', 'TOILETPAN'), position: { x: 1000, y: 2000, z: 0 } },
        { ...asProxy(301, 'Toilet:WC-01'), position: { x: 1060, y: 2030, z: 0 } },
      ],
    )

    const result = await detectFixtures(api, 0, 1)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ expressId: 101, kind: 'TOILETPAN' })
  })

  it('keeps same-kind fixtures when they are spatially distinct', async () => {
    const api = makeApi(
      [{ relatingStoreyId: 1, elementIds: [101, 102] }],
      [
        { ...asSanitary(101, 'WC-A', 'TOILETPAN'), position: { x: 1000, y: 2000, z: 0 } },
        { ...asSanitary(102, 'WC-A', 'TOILETPAN'), position: { x: 2200, y: 2000, z: 0 } },
      ],
    )

    const result = await detectFixtures(api, 0, 1)

    expect(result).toHaveLength(2)
    expect(result.map((fixture) => fixture.expressId)).toEqual([101, 102])
  })
})

describe('classifyFixtureText (ordered name rules)', () => {
  const fixture = (kind: string): FixtureTextClassification =>
    ({ type: 'fixture', kind } as FixtureTextClassification)
  const excluded = (reason: string): FixtureTextClassification =>
    ({ type: 'excluded', reason } as FixtureTextClassification)
  const unmatched: FixtureTextClassification = { type: 'unmatched' }

  const cases: Array<[string, FixtureTextClassification]> = [
    // basin/sink evidence wins over a bare WC token
    ['LIB_Sanitary-Sink-WC-2D-NH', fixture('SINK')],
    ['LIB_Sanitary-Sink-WC-2D-NH : כיור אובלי תלוי', fixture('WASHHANDBASIN')],
    ['Basin WC', fixture('WASHHANDBASIN')],
    ['Sink WC', fixture('SINK')],
    // toilets, English and Hebrew (absolute + construct form)
    ['LIB_Sanitary-WC-2D-NH : אסלה תלויה', fixture('TOILETPAN')],
    ['LIB_Sanitary-WC-2D-NH : אסלת נכים', fixture('TOILETPAN')],
    ['AR-Disabled-Toilet-3D : Type-01', fixture('TOILETPAN')],
    ['AR-MMM-Chemical-WC-Wall-3D : Type 01', fixture('TOILETPAN')],
    ['Toilet-Commercial-Wall-3D1 : 15" Seat Height', fixture('TOILETPAN')],
    ['WC-Guest-01', fixture('TOILETPAN')],
    // sinks: singular, plural, multi-bowl, slop/utility
    ['Sinks', fixture('SINK')],
    ['AR-Multi-Sinks-3D : 5 Sinks', fixture('SINK')],
    ['AR-Multi-Sinks-3D : 4 Sinks', fixture('SINK')],
    ['LIB_Sanitary-SlopSink-2D-NH : עביט שפכין', fixture('SINK')],
    ['Kitchen sink', fixture('SINK')],
    // accessories are not fixtures ...
    ['AR-Flushing-Tank-for-Toilet-3D : Type 01', excluded('accessory')],
    ['Flushing Tank', excluded('accessory')],
    ['Flush-Tank', excluded('accessory')],
    ['Cistern', excluded('accessory')],
    ['Cistern for WC', excluded('accessory')],
    ['ניאגרה', excluded('accessory')],
    ['LIB_Sanitary-P_Trap-Generic : 1-1/4" - 150mm - סיפון מתכת', excluded('accessory')],
    ['P-Trap 40mm', excluded('accessory')],
    // ... unless the host fixture is named first (variant descriptor, not an accessory)
    ['M_Water Closet - Flush Tank:Private - 6.1 Lpf', fixture('TOILETPAN')],
    ['Toilet with cistern', fixture('TOILETPAN')],
    ['Sink with bottle trap', fixture('SINK')],
    // drainage points follow the floor-drain policy
    ['LIB_Drain-Floor_Trap-6x4_8x4-NH : 6x4 - מ.ר', excluded('floor-drain')],
    ['LIB_Drain-Floor_Drain-4x2-NH : 4x2 - ק.ב', excluded('floor-drain')],
    ['LIB_Drain-Floor_Drain-Drop-4inch-NH : 4" - ק.ב.נ', excluded('floor-drain')],
    ['Floor drain 50mm', excluded('floor-drain')],
    ['LIB_Drain-Roof_Balcony_Vertical_Outlet : 70mm - נקז כפול למרפסת', excluded('floor-drain')],
    // fire protection never becomes sanitary
    ['Fire Protection : Sprinkler-Pendent : K5.6', excluded('fire-protection')],
    ['SPR Head Upright', excluded('fire-protection')],
    ['Fire Protection : AR-\uFEFF\uFEFFHydrant-Fire-Cabinet-3D : Type 02', excluded('fire-protection')],
    ['Mechanical Equipment : LIB_Fire-Hose_Reel : Standard', excluded('fire-protection')],
    ['LIB_Fire-Sprinkler_Station : 4"-ראש מערכת ספרינקלר', excluded('fire-protection')],
    // other kinds
    ['AR-Plumbing-Urinal-3D : Type 01', fixture('URINAL')],
    ['Bathtub', fixture('BATH')],
    ['Bidet', fixture('BIDET')],
    // no evidence at all
    ['Casework : AR-Metal-Cabinet-2-Wings-3D : M-302', unmatched],
    ['Water heater:DOD:12013965', unmatched],
    ['Structural column type A', unmatched],
  ]

  it.each(cases)('%s', (text, expected) => {
    expect(classifyFixtureText(text)).toEqual(expected)
  })
})
