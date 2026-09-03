import type { IfcAPI } from 'web-ifc'
import type { Fixture, FixtureKind, StoreyId } from '@/domain/types'
import { detectPlanUnits, planDistance } from '@/shared/routes/planGeometry'
import { createArtifactAwareBoundsAccumulator } from '@/shared/frame/modelFrame'
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
 *
 * Bounds are artifact-aware: stray (0,0,0)-adjacent vertices in otherwise
 * far-from-origin meshes are dropped before the centre is computed, so a single
 * zero vertex cannot drag a fixture centroid hundreds of kilometres off the
 * building. Near-origin models keep every vertex.
 */
export function getIfcElementPosition(
  api: IfcAPI,
  webIfcModelId: number,
  expressId: number,
): { x: number; y: number; z: number } | null {
  try {
    const flatMesh = api.GetFlatMesh(webIfcModelId, expressId)
    if (flatMesh.geometries.size() === 0) return null

    const bounds = createArtifactAwareBoundsAccumulator()

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
        bounds.add(wx, wy, wz)
      }
    }

    const box = bounds.result()
    if (box === null) return null
    return {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      z: (box.minZ + box.maxZ) / 2,
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
// Floor traps / drains / roof & balcony outlets. Covers Revit family tokens
// (`Floor_Drain`, `Floor_Trap`) and the Hebrew abbreviations `מ.ר` (מחסום רצפה)
// and `ק.ב` / `ק.ב.נ` used as type labels. JS `\b` is ASCII-only, so Hebrew
// abbreviations are delimited with letter/digit lookarounds instead.
const FLOOR_DRAIN_PATTERN =
  /floor[\s_-]*drain|floor[\s_-]*trap|roof[\s_-]*(?:drain|outlet)|balcony[\s_-]*(?:drain|outlet)|מחסום\s*רצפה|נקז|(?<![\p{L}\d])(?:מ\.ר|ק\.ב(?:\.נ)?)(?![\p{L}\d])/iu
const KITCHEN_PATTERN = /kitchen(?:ette)?|מטבח/i
const EXPLICIT_WASH_BASIN_PATTERN = /wash.?hand.?basin|washbasin|hand.?basin|lavatory|כיור\s*רחצה/i

/** Zero-width / BOM characters occasionally embedded in Revit family names. */
const INVISIBLE_CHARS_PATTERN = /[\u200B-\u200F\uFEFF]/g

function toFixtureKind(raw: string): FixtureKind {
  const upper = raw.toUpperCase()
  return KNOWN_KINDS.has(upper) ? (upper as FixtureKind) : 'OTHER'
}

/**
 * Why a piece of text is explicitly NOT a sanitary fixture. Exclusions are
 * evaluated before any fixture keyword so an accessory that mentions its host
 * (`Flushing-Tank-for-Toilet`) or a fire terminal can never spawn a fixture.
 */
export type FixtureExclusionReason = 'accessory' | 'fire-protection' | 'floor-drain'

export type FixtureTextClassification =
  | { type: 'fixture'; kind: FixtureKind }
  | { type: 'excluded'; reason: FixtureExclusionReason }
  | { type: 'unmatched' }

type FixtureTextRule =
  | { pattern: RegExp; kind: FixtureKind }
  | {
      pattern: RegExp
      exclude: FixtureExclusionReason
      /**
       * The exclusion is skipped when this pattern matches EARLIER in the text
       * than `pattern`. Revit names are `Family : Type` with the subject first,
       * so `Water Closet - Flush Tank` is a toilet variant while
       * `Flushing-Tank-for-Toilet` is an accessory that merely names its host.
       */
      unlessHostFirst?: RegExp
    }

const TOILET_PATTERN = /toilet|water closet|\bwc\b|אסל(?:ה|ת|ות)/i
const BASIN_OR_SINK_PATTERN = /basin|lavatory|\bsinks?\b|slop[\s_-]*sink|כיור|עביט/i
/** Any fixture the accessory could belong to; used by `unlessHostFirst`. */
const ACCESSORY_HOST_PATTERN = new RegExp(
  `${TOILET_PATTERN.source}|${BASIN_OR_SINK_PATTERN.source}|\\bbath(?!room)|bathtub|אמבט|urinal|משתנ|bidet|בידה`,
  'i',
)

/**
 * Ordered text rules for exports where plumbing fixtures are only identifiable
 * through human-readable metadata (Revit `Category : Family : Type` names,
 * ObjectType, Description). The FIRST matching rule wins, so order encodes
 * precedence:
 *
 *   1. accessories (cisterns / flushing tanks, P-traps, siphons)   → excluded,
 *      unless a host fixture is named first (`Water Closet - Flush Tank`)
 *   2. floor traps / drains / roof outlets                          → excluded*
 *   3. fire protection (sprinklers, hydrants, fire cabinets/hoses) → excluded
 *   4. basin / sink evidence                                        → SINK / WASHHANDBASIN
 *   5. toilet evidence (only reached when no basin evidence exists) → TOILETPAN
 *   6. bath, urinal, bidet
 *
 * Basin/sink rules precede toilet rules on purpose: a bare `WC` token is part of
 * many basin family names (`Sink-WC`, `Basin WC`), so basin evidence in the same
 * name wins over it. English and Hebrew labels are covered side by side.
 *
 * (*) floor drains follow `DETECT_FIXTURES_CONFIG.includeShowerFloorDrains`
 *     in `classifyFixtureLine`; every other exclusion is unconditional.
 */
const FIXTURE_TEXT_RULES: readonly FixtureTextRule[] = [
  // 1. accessories
  {
    pattern: /flush(?:ing)?[\s_-]*tank|cistern|ניאגר(?:ה)?/i,
    exclude: 'accessory',
    unlessHostFirst: ACCESSORY_HOST_PATTERN,
  },
  {
    pattern: /\bp[\s_-]*trap|bottle[\s_-]*trap|siphon|סיפון/i,
    exclude: 'accessory',
    unlessHostFirst: ACCESSORY_HOST_PATTERN,
  },
  // 2. floor drains / traps / outlets
  { pattern: FLOOR_DRAIN_PATTERN, exclude: 'floor-drain' },
  // 3. fire protection
  {
    pattern:
      /sprinkler|\bspr\b|hydrant|fire[\s_-]*(?:protection|cabinet|hose|reel|extinguisher|fighting)|hose[\s_-]*reel|ספרינקלר|מתז|הידרנט|כיבוי/i,
    exclude: 'fire-protection',
  },
  // 4. basin / sink evidence
  { pattern: /kitchen.?sink|sink.*kitchen|כיור\s*מטבח|מטבח.*כיור/i, kind: 'SINK' },
  { pattern: /wash.?hand.?basin|washbasin|hand.?basin|\bbasins?\b|lavatory|כיור\s*רחצה|כיור/i, kind: 'WASHHANDBASIN' },
  { pattern: /\bsinks?\b|slop[\s_-]*sink|עביט/i, kind: 'SINK' },
  // 5. toilet evidence
  { pattern: TOILET_PATTERN, kind: 'TOILETPAN' },
  // 6. others
  { pattern: /\bbath(?!room)|bathtub|אמבט(?:יה)?/i, kind: 'BATH' },
  { pattern: /urinal|משתנ(?:ה|ות)/i, kind: 'URINAL' },
  { pattern: /bidet|בידה/i, kind: 'BIDET' },
]

/**
 * Pure, ordered text classifier (see `FIXTURE_TEXT_RULES`). Exposed so tests and
 * diagnostics can see WHY a line was excluded, not just that it was.
 */
export function classifyFixtureText(text: string): FixtureTextClassification {
  const normalized = text.replace(INVISIBLE_CHARS_PATTERN, '')
  for (const rule of FIXTURE_TEXT_RULES) {
    const matchIndex = normalized.search(rule.pattern)
    if (matchIndex === -1) continue
    if ('kind' in rule) return { type: 'fixture', kind: rule.kind }
    if (rule.unlessHostFirst) {
      const hostIndex = normalized.search(rule.unlessHostFirst)
      if (hostIndex !== -1 && hostIndex < matchIndex) continue
    }
    return { type: 'excluded', reason: rule.exclude }
  }
  return { type: 'unmatched' }
}

export function inferFixtureKindFromText(text: string): FixtureKind | null {
  const classification = classifyFixtureText(text)
  return classification.type === 'fixture' ? classification.kind : null
}

export function isExcludedFixtureText(text: string): boolean {
  return EXCLUDED_FIXTURE_PATTERN.test(text)
}

export interface DetectFixturesOptions {
  /**
   * When true, shower and floor-drain elements are detected as fixtures instead of
   * being skipped. They are reported as kind 'OTHER' because `FixtureKind` has no
   * dedicated shower/floor-drain kind (`src/domain/types.ts` is frozen for T2).
   */
  includeShowerFloorDrains?: boolean
}

/**
 * Single code-level policy constant for shower/floor-drain detection. Floor drains
 * matter for drainage planning, but the current product flow excludes them; flip
 * this constant to include them without touching call sites.
 */
export const DETECT_FIXTURES_CONFIG: Required<DetectFixturesOptions> = {
  includeShowerFloorDrains: false,
}

function isKitchenText(text: string): boolean {
  return KITCHEN_PATTERN.test(text)
}

/** How the element was reached; decides which classification rule applies. */
export type FixtureClassificationSource = 'sanitary-terminal' | 'flow-terminal' | 'keyword'

/**
 * Pure per-element fixture-kind classifier shared by full detection (below)
 * and the lightweight per-storey fixture scan (`scanStoreyFixtures`). This is
 * THE single source of classification rules; both callers must stay on it.
 *
 * Returns null when the element is not a plumbing fixture: no evidence, an
 * excluded shower/floor drain under the current options, or an explicit text
 * exclusion (accessory, fire protection — see `FIXTURE_TEXT_RULES`).
 *
 * Precedence per source:
 *   - shower text/PredefinedType → null (or OTHER when floor drains are included)
 *   - typed sources: a known IFC PredefinedType is authoritative (a sanitary
 *     terminal explicitly typed CISTERN stays a CISTERN)
 *   - otherwise the ordered text rules decide; text exclusions return null so an
 *     accessory or fire terminal never spawns a fixture, whatever its IFC class
 *   - an untyped IfcSanitaryTerminal with no text evidence is still OTHER
 */
export function classifyFixtureLine(
  source: FixtureClassificationSource,
  { predefinedType, searchText }: { predefinedType: string; searchText: string },
  options: Required<DetectFixturesOptions> = DETECT_FIXTURES_CONFIG,
): FixtureKind | null {
  const typedSearchText = `${predefinedType} ${searchText}`
  const isShower = isExcludedFixtureText(typedSearchText)
  if (!options.includeShowerFloorDrains && isShower) return null

  const textClass = classifyFixtureText(searchText)
  const fallbackKind = textClass.type === 'fixture' ? textClass.kind : null
  const isFloorDrain = textClass.type === 'excluded' && textClass.reason === 'floor-drain'
  const showerFloorDrainKind: FixtureKind | null =
    options.includeShowerFloorDrains && (isShower || isFloorDrain) ? 'OTHER' : null

  if (source === 'keyword') return fallbackKind ?? showerFloorDrainKind

  const predefinedKind = toFixtureKind(predefinedType)
  if (predefinedKind !== 'OTHER') return predefinedKind
  if (textClass.type === 'excluded') return showerFloorDrainKind
  return source === 'sanitary-terminal' ? (fallbackKind ?? 'OTHER') : (fallbackKind ?? showerFloorDrainKind)
}

export function normalizeFixtureKindForKitchen(
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

/** Concatenated human-readable metadata of one IFC line, for keyword matching. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readLineText(line: any): string {
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
  options: DetectFixturesOptions = DETECT_FIXTURES_CONFIG,
): Promise<Fixture[]> {
  const includeShowerFloorDrains =
    options.includeShowerFloorDrains ?? DETECT_FIXTURES_CONFIG.includeShowerFloorDrains
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
      const inferredKind = classifyFixtureLine(
        typeConstant === IFCSANITARYTERMINAL ? 'sanitary-terminal' : 'flow-terminal',
        { predefinedType: line.PredefinedType?.value ?? '', searchText },
        { includeShowerFloorDrains },
      )

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
      const inferredKind = classifyFixtureLine(
        'keyword',
        { predefinedType: line.PredefinedType?.value ?? '', searchText },
        { includeShowerFloorDrains },
      )
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
      const inferredKind = classifyFixtureLine(
        'keyword',
        { predefinedType: line.PredefinedType?.value ?? '', searchText },
        { includeShowerFloorDrains },
      )
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
