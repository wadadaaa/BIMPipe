import type { IfcAPI } from 'web-ifc'
import type { FixtureKind, StoreyId } from '@/domain/types'
import { collectSpatialTreeElements } from './collectSpatialTreeElements'
import { getIfcElementPosition, inferFixtureKindFromText, isExcludedFixtureText } from './detectFixtures'

export interface StoreyTypeCount {
  typeName: string
  count: number
}

export interface FixtureDiagnosticCandidate {
  expressId: number
  typeName: string
  name: string
  objectType: string
  predefinedType: string
  suggestedKind: FixtureKind | null
  position: { x: number; y: number; z: number } | null
}

export interface StoreyFixtureDiagnostics {
  totalElements: number
  topTypes: StoreyTypeCount[]
  candidates: FixtureDiagnosticCandidate[]
}

const CANDIDATE_TYPE_NAMES = new Set([
  'IFCSANITARYTERMINAL',
  'IFCFLOWTERMINAL',
  'IFCBUILDINGELEMENTPROXY',
  'IFCFURNISHINGELEMENT',
  'IFCFLOWCONTROLLER',
])

const PLUMBING_HINT_PATTERN =
  /toilet|toiletpan|water closet|\bwc\b|wash.?hand.?basin|washbasin|hand.?basin|lavatory|\bsink\b|bath(?!room)|bathtub|urinal|bidet|cistern|flush tank|אסלה|כיור|אמבט|ניאגר|בידה|משתנה/i

/**
 * Returns a breakdown of the IFC classes present in a storey plus likely
 * fixture candidates that can be surfaced in the UI when automatic matching fails.
 */
export async function diagnoseStoreyTypes(
  api: IfcAPI,
  webIfcModelId: number,
  storeyId: StoreyId,
): Promise<StoreyFixtureDiagnostics> {
  const ifcModule = await import('web-ifc')

  // Build a reverse map: type constant → export name
  const reverseMap = new Map<number, string>()
  for (const [key, value] of Object.entries(ifcModule)) {
    if (typeof value === 'number') reverseMap.set(value, key)
  }

  const { elementIds } = await collectSpatialTreeElements(api, webIfcModelId, storeyId)

  // Count by IFC type
  const counts = new Map<string, number>()
  const candidates: FixtureDiagnosticCandidate[] = []
  for (const id of elementIds) {
    const typeConst = api.GetLineType(webIfcModelId, id)
    const typeName = reverseMap.get(typeConst) ?? `Unknown(${typeConst})`
    counts.set(typeName, (counts.get(typeName) ?? 0) + 1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = api.GetLine(webIfcModelId, id, false) as any
    const name = line?.Name?.value ?? line?.LongName?.value ?? `Element ${id}`
    const objectType = line?.ObjectType?.value ?? ''
    const predefinedType = line?.PredefinedType?.value ?? ''
    const description = line?.Description?.value ?? ''
    const searchText = [name, objectType, predefinedType, description].join(' ')
    if (isExcludedFixtureText(searchText)) continue

    const suggestedKind = inferFixtureKindFromText(searchText)
    const isPlumbingHint = suggestedKind !== null || PLUMBING_HINT_PATTERN.test(searchText)

    if (!CANDIDATE_TYPE_NAMES.has(typeName) && !isPlumbingHint) continue

    candidates.push({
      expressId: id,
      typeName,
      name,
      objectType,
      predefinedType,
      suggestedKind,
      position: getIfcElementPosition(api, webIfcModelId, id),
    })
  }

  const topTypes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([typeName, count]) => ({ typeName, count }))

  const sortedCandidates = candidates
    .sort((a, b) => {
      const aHint = Number(
        a.suggestedKind !== null ||
          PLUMBING_HINT_PATTERN.test(`${a.name} ${a.objectType} ${a.predefinedType}`),
      )
      const bHint = Number(
        b.suggestedKind !== null ||
          PLUMBING_HINT_PATTERN.test(`${b.name} ${b.objectType} ${b.predefinedType}`),
      )
      if (aHint !== bHint) return bHint - aHint
      if (a.typeName !== b.typeName) return a.typeName.localeCompare(b.typeName)
      return a.name.localeCompare(b.name)
    })
    .slice(0, 24)

  return {
    totalElements: elementIds.size,
    topTypes,
    candidates: sortedCandidates,
  }
}

export function logStoreyFixtureDiagnostics(
  storeyId: StoreyId,
  diagnostics: StoreyFixtureDiagnostics,
) {
  console.group(`[BIMPipe] Storey ${storeyId} — ${diagnostics.totalElements} elements`)
  for (const type of diagnostics.topTypes) {
    console.log(`  ${type.count.toString().padStart(4)}×  ${type.typeName}`)
  }

  if (diagnostics.candidates.length > 0) {
    console.table(
      diagnostics.candidates.map((candidate) => ({
        expressId: candidate.expressId,
        type: candidate.typeName,
        name: candidate.name,
        objectType: candidate.objectType,
        predefinedType: candidate.predefinedType,
        suggestedKind: candidate.suggestedKind ?? '—',
        position: candidate.position ? 'yes' : 'no',
      })),
    )
  }
  console.groupEnd()
}
