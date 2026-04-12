import type { IfcAPI } from 'web-ifc'
import type { Fixture, FixtureKind, StoreyId } from '@/domain/types'
import { detectPlanUnits, planDistance } from '@/shared/routes/planGeometry'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'

interface DetectedFixtureCandidate extends Fixture {
  confidence: number
}

/**
 * Returns the world-space bounding-box centre of an element by transforming all
 * vertex positions through the column-major 4×4 flatTransformation matrix and
 * computing min/max extents across every geometry in the mesh.
 *
 * This is more accurate than reading t[12,13,14] (the insertion origin), which
 * points to the pipe-connection stub rather than the visible body of the fixture.
 */
export function getIfcElementPosition(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): { x: number; y: number; z: number } | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (let gi = 0; gi < flatMesh.geometries.size(); gi++) {
      const placed = flatMesh.geometries.get(gi)
      const t = placed.flatTransformation
      const geomData = api.GetGeometry(webIfcModelId, placed.geometryExpressID)
      const rawVerts = api.GetVertexArray(
        geomData.GetVertexData(),
        geomData.GetVertexDataSize(),
      )
      geomData.delete()

      // Vertex stride is 6: [x, y, z, nx, ny, nz]
      for (let j = 0; j < rawVerts.length / 6; j++) {
        const lx = rawVerts[j * 6]
        const ly = rawVerts[j * 6 + 1]
        const lz = rawVerts[j * 6 + 2]
        // Column-major 4×4 transform: col0=[0..3], col1=[4..7], col2=[8..11], col3=[12..15]
        const wx = t[0] * lx + t[4] * ly + t[8] * lz + t[12]
        const wy = t[1] * lx + t[5] * ly + t[9] * lz + t[13]
        const wz = t[2] * lx + t[6] * ly + t[10] * lz + t[14]
        if (wx < minX) minX = wx
        if (wx > maxX) maxX = wx
        if (wy < minY) minY = wy
        if (wy > maxY) maxY = wy
        if (wz < minZ) minZ = wz
        if (wz > maxZ) maxZ = wz
      }
    }

    if (!isFinite(minX)) return null
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    }
  } catch {
    return null
  }
}

const KNOWN_KINDS = new Set<string>([
  'BATH', 'SINK', 'TOILETPAN', 'URINAL',
  'WASHHANDBASIN', 'CISTERN', 'BIDET',
])

const EXCLUDED_FIXTURE_PATTERN = /shower|מקלח(?:ת|ון)|אגנית/i
const KITCHEN_PATTERN = /kitchen(?:ette)?|מטבח/i
const EXPLICIT_WASH_BASIN_PATTERN = /wash.?hand.?basin|washbasin|hand.?basin|lavatory|כיור\s*רחצה/i

function toFixtureKind(raw: string): FixtureKind {
  const upper = raw.toUpperCase()
  return KNOWN_KINDS.has(upper) ? (upper as FixtureKind) : 'OTHER'
}

// Keyword → FixtureKind mapping for ambiguous exports where plumbing fixtures are
// represented as proxy/furnishing/flow elements. The keywords intentionally cover
// both English and common Hebrew labels seen in local BIM exports.
const KEYWORD_MATCHERS: Array<[RegExp, FixtureKind]> = [
  [/toilet|toiletpan|water closet|\bwc\b|אסלה/i, 'TOILETPAN'],
  [/kitchen.?sink|sink.*kitchen|כיור\s*מטבח|מטבח.*כיור/i, 'SINK'],
  [/wash.?hand.?basin|washbasin|hand.?basin|lavatory|כיור\s*רחצה|כיור/i, 'WASHHANDBASIN'],
  [/\bsink\b|kitchen sink/i, 'SINK'],
  [/\bbath(?!room)|bathtub|אמבט(?:יה)?/i, 'BATH'],
  [/urinal|משתנה/i, 'URINAL'],
  [/bidet|בידה/i, 'BIDET'],
  [/cistern|flush tank|ניאגר/i, 'CISTERN'],
]

export function inferFixtureKindFromText(text: string): FixtureKind | null {
  for (const [pattern, kind] of KEYWORD_MATCHERS) {
    if (pattern.test(text)) return kind
  }
  return null
}

export function isExcludedFixtureText(text: string): boolean {
  return EXCLUDED_FIXTURE_PATTERN.test(text)
}

function isKitchenText(text: string): boolean {
  return KITCHEN_PATTERN.test(text)
}

function normalizeFixtureKindForKitchen(
  kind: FixtureKind,
  searchText: string,
  inKitchenSpace: boolean,
): FixtureKind {
  if (kind === 'SINK' || kind === 'OTHER') return kind
  if (kind !== 'WASHHANDBASIN') return kind
  if (!inKitchenSpace && !isKitchenText(searchText)) return kind
  if (EXPLICIT_WASH_BASIN_PATTERN.test(searchText)) return kind
  return 'SINK'
}

function inferModelUnitsFromFixtures(fixtures: Fixture[]): 'mm' | 'm' {
  return detectPlanUnits(fixtures.flatMap((fixture) => (fixture.position ? [fixture.position] : [])))
}

function dedupeDetectedFixtures(fixtures: DetectedFixtureCandidate[]): Fixture[] {
  if (fixtures.length <= 1) return fixtures

  const mergeThreshold = inferModelUnitsFromFixtures(fixtures) === 'mm' ? 120 : 0.12
  const deduped: DetectedFixtureCandidate[] = []

  const sorted = [...fixtures].sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence
    if (Number(a.position !== null) !== Number(b.position !== null)) {
      return Number(b.position !== null) - Number(a.position !== null)
    }
    return a.expressId - b.expressId
  })

  for (const fixture of sorted) {
    const duplicateIndex = deduped.findIndex((existing) => areDuplicateFixtures(existing, fixture, mergeThreshold))

    if (duplicateIndex === -1) {
      deduped.push(fixture)
      continue
    }

    const existing = deduped[duplicateIndex]
    deduped[duplicateIndex] = choosePreferredFixture(existing, fixture)
  }

  return deduped
    .sort((a, b) => a.expressId - b.expressId)
    .map((fixture) => ({
      expressId: fixture.expressId,
      name: fixture.name,
      kind: fixture.kind,
      storeyId: fixture.storeyId,
      isKitchenSink: fixture.isKitchenSink,
      position: fixture.position,
    }))
}

function areDuplicateFixtures(
  left: DetectedFixtureCandidate,
  right: DetectedFixtureCandidate,
  mergeThreshold: number,
): boolean {
  if (left.kind !== right.kind) return false

  if (left.position === null || right.position === null) return false

  const distance = planDistance(left.position, right.position)
  if (distance > mergeThreshold) return false

  const lowerConfidence = Math.min(left.confidence, right.confidence)
  const higherConfidence = Math.max(left.confidence, right.confidence)
  const confidenceGap = higherConfidence - lowerConfidence

  // Only collapse ambiguous proxy/fallback hits into a stronger nearby source.
  return lowerConfidence <= 1 && confidenceGap >= 2
}

function choosePreferredFixture(
  left: DetectedFixtureCandidate,
  right: DetectedFixtureCandidate,
): DetectedFixtureCandidate {
  let chosen: DetectedFixtureCandidate
  if (right.confidence !== left.confidence) {
    chosen = right.confidence > left.confidence ? right : left
  } else if (Number(right.position !== null) !== Number(left.position !== null)) {
    chosen = right.position !== null ? right : left
  } else {
    chosen = right.expressId < left.expressId ? right : left
  }

  return {
    ...chosen,
    isKitchenSink: left.isKitchenSink || right.isKitchenSink,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readLineText(line: any): string {
  return [
    line.Name?.value,
    line.LongName?.value,
    line.ObjectType?.value,
    line.Description?.value,
    line.Tag?.value,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
}

/**
 * Returns plumbing-related elements in the given storey.
 *
 * Queries several IFC types to cover models from different authoring tools:
 *   - IFCSANITARYTERMINAL      — explicit sanitary fixtures (most specific)
 *   - IFCFLOWTERMINAL          — broader flow terminals (used by some Revit exports)
 *   - IFCBUILDINGELEMENTPROXY  — Revit catch-all: toilets, basins etc. identified by
 *                                name/ObjectType keyword matching
 *   - IFCFURNISHINGELEMENT     — furniture/family exports that still carry plumbing names
 *
 * Elements already collected from a more specific type are not duplicated.
 */
export async function detectFixtures(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<Fixture[]> {
  const {
    IFCSANITARYTERMINAL,
    IFCFLOWTERMINAL,
    IFCBUILDINGELEMENTPROXY,
    IFCFURNISHINGELEMENT,
  } = await import('web-ifc')

  const { elementIds: storeyElementIds } = await collectSpatialTreeElements(
    api,
    webIfcModelId,
    storeyId,
  )
  const kitchenElementIds = await collectKitchenElementIds(api, webIfcModelId, storeyId)

  const fixtures: DetectedFixtureCandidate[] = []
  const seen = new Set<number>()

  // Collect typed fixtures (IFCSANITARYTERMINAL, IFCFLOWTERMINAL): kind from PredefinedType.
  // IFCFLOWTERMINAL is broad enough to include non-plumbing equipment, so ambiguous
  // "OTHER" entries are only kept when the human-readable name still matches a known fixture.
  function collectTyped(typeConstant: number) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
    for (let i = 0; i < ids.size(); i++) {
      const expressId = ids.get(i)
      if (!storeyElementIds.has(expressId) || seen.has(expressId)) continue

      // flatten=false avoids deep WASM object resolution that can crash on complex types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, expressId, false) as any
      const name: string = line.Name?.value ?? line.LongName?.value ?? `Fixture ${expressId}`
      const searchText = readLineText(line)
      if (isExcludedFixtureText(`${line.PredefinedType?.value ?? ''} ${searchText}`)) continue

      const predefinedKind = toFixtureKind(line.PredefinedType?.value ?? '')
      const fallbackKind = inferFixtureKindFromText(searchText)
      const inferredKind =
        predefinedKind !== 'OTHER'
          ? predefinedKind
          : typeConstant === IFCSANITARYTERMINAL
            ? (fallbackKind ?? 'OTHER')
            : fallbackKind

      if (inferredKind === null) continue

      seen.add(expressId)
      const position = getIfcElementPosition(api, webIfcModelId, expressId)
      const kind = normalizeFixtureKindForKitchen(
        inferredKind,
        searchText,
        kitchenElementIds.has(expressId),
      )
      const isKitchenSink = kind === 'SINK' && (kitchenElementIds.has(expressId) || isKitchenText(searchText))

      fixtures.push({
        expressId,
        name,
        kind,
        storeyId,
        isKitchenSink,
        position,
        confidence: typeConstant === IFCSANITARYTERMINAL ? 4 : 3,
      })
    }
  }

  // Collect keyword-matched exports (proxy/furnishing) that only identify plumbing
  // through human-readable metadata rather than a reliable PredefinedType.
  function collectKeywordMatched(typeConstant: number) {
    const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
    for (let i = 0; i < ids.size(); i++) {
      const expressId = ids.get(i)
      if (!storeyElementIds.has(expressId) || seen.has(expressId)) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, expressId, false) as any
      const name: string = line.Name?.value ?? line.LongName?.value ?? ''
      const searchText = readLineText(line)
      if (isExcludedFixtureText(`${line.PredefinedType?.value ?? ''} ${searchText}`)) continue

      const inferredKind = inferFixtureKindFromText(searchText)
      if (inferredKind === null) continue // not a plumbing fixture

      seen.add(expressId)
      const position = getIfcElementPosition(api, webIfcModelId, expressId)
      const kind = normalizeFixtureKindForKitchen(
        inferredKind,
        searchText,
        kitchenElementIds.has(expressId),
      )
      const isKitchenSink = kind === 'SINK' && (kitchenElementIds.has(expressId) || isKitchenText(searchText))
      fixtures.push({
        expressId,
        name: name || `Fixture ${expressId}`,
        kind,
        storeyId,
        isKitchenSink,
        position,
        confidence: typeConstant === IFCFURNISHINGELEMENT ? 2 : 1,
      })
    }
  }

  // Final fallback: scan every element associated with the storey and accept any
  // object whose text metadata looks like plumbing, regardless of IFC class.
  function collectKeywordMatchesFromStoreyElements() {
    for (const expressId of storeyElementIds) {
      if (seen.has(expressId)) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, expressId, false) as any
      if (!line) continue

      const searchText = readLineText(line)
      if (isExcludedFixtureText(`${line.PredefinedType?.value ?? ''} ${searchText}`)) continue

      const inferredKind = inferFixtureKindFromText(searchText)
      if (inferredKind === null) continue

      const name: string = line.Name?.value ?? line.LongName?.value ?? `Fixture ${expressId}`
      seen.add(expressId)
      const position = getIfcElementPosition(api, webIfcModelId, expressId)
      const kind = normalizeFixtureKindForKitchen(
        inferredKind,
        searchText,
        kitchenElementIds.has(expressId),
      )
      const isKitchenSink = kind === 'SINK' && (kitchenElementIds.has(expressId) || isKitchenText(searchText))
      fixtures.push({ expressId, name, kind, storeyId, isKitchenSink, position, confidence: 0 })
    }
  }

  collectTyped(IFCSANITARYTERMINAL)
  collectTyped(IFCFLOWTERMINAL)
  collectKeywordMatched(IFCBUILDINGELEMENTPROXY)
  collectKeywordMatched(IFCFURNISHINGELEMENT)
  collectKeywordMatchesFromStoreyElements()

  return dedupeDetectedFixtures(fixtures)
}

async function collectKitchenElementIds(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<Set<number>> {
  const { IFCSPACE } = await import('web-ifc')
  const { spatialNodeIds } = await collectSpatialTreeElements(api, webIfcModelId, storeyId)
  const kitchenElementIds = new Set<number>()
  const ids = api.GetLineIDsWithType(webIfcModelId, IFCSPACE)

  for (let i = 0; i < ids.size(); i++) {
    const expressId = ids.get(i)
    if (!spatialNodeIds.has(expressId)) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = api.GetLine(webIfcModelId, expressId, false) as any
    if (!line || !isKitchenText(readLineText(line))) continue

    const { elementIds } = await collectSpatialTreeElements(api, webIfcModelId, expressId)
    for (const elementId of elementIds) {
      kitchenElementIds.add(elementId)
    }
  }

  return kitchenElementIds
}
