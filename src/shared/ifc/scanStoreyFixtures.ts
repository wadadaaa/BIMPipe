import type { IfcAPI } from 'web-ifc'
import type { FixtureKind, Storey, StoreyId } from '@/domain/types'
import {
  buildFixtureFingerprint,
  chooseInitialStorey,
  type InitialStoreySummary,
} from '@/domain/chooseInitialStorey'
import {
  classifyFixtureLine,
  normalizeFixtureKindForKitchen,
  readLineText,
  type FixtureClassificationSource,
} from './detectFixtures'
import { collectSpatialTreeElementsForStoreys } from './collectSpatialTreeElements'

/**
 * Lightweight per-storey fixture scan used to choose the floor to auto-open
 * BEFORE any floor geometry exists. It reuses `classifyFixtureLine` — the
 * exact classification rules of `detectFixtures` — but never touches mesh
 * geometry: no `GetFlatMesh`, no positions, so scanning all storeys of a
 * 17 MB / 44-storey model stays sub-second (property/line reads only).
 *
 * Known, accepted differences from full `detectFixtures` on an open floor:
 * - No position-based dedupe (it needs element positions), so counts can be
 *   slightly higher where a proxy duplicates a sanitary terminal. The same
 *   rule applies to every storey, so fingerprint GROUPING stays consistent.
 * - Kitchen-space membership is not resolved (needs per-space walks and only
 *   refines WASHHANDBASIN → SINK); the text-based part of that rule still
 *   applies identically on every storey.
 */
export interface StoreyFixtureCounts {
  storeyId: StoreyId
  toiletCount: number
  totalFixtureCount: number
  countsByKind: Partial<Record<FixtureKind, number>>
}

export async function scanStoreyFixtureCounts(
  api: IfcAPI,
  webIfcModelId: number,
  storeyIds: StoreyId[],
): Promise<Map<StoreyId, StoreyFixtureCounts>> {
  const { IFCSANITARYTERMINAL, IFCFLOWTERMINAL } = await import('web-ifc')

  const elementsByStorey = await collectSpatialTreeElementsForStoreys(api, webIfcModelId, storeyIds)
  const sanitaryTerminalIds = readTypeIdSet(api, webIfcModelId, IFCSANITARYTERMINAL)
  const flowTerminalIds = readTypeIdSet(api, webIfcModelId, IFCFLOWTERMINAL)

  const result = new Map<StoreyId, StoreyFixtureCounts>()

  for (const storeyId of storeyIds) {
    const countsByKind: Partial<Record<FixtureKind, number>> = {}
    let totalFixtureCount = 0

    for (const expressId of elementsByStorey.get(storeyId)?.elementIds ?? []) {
      // Mirrors detectFixtures' collector precedence: typed sanitary/flow
      // terminals first, everything else via keyword matching.
      const source: FixtureClassificationSource = sanitaryTerminalIds.has(expressId)
        ? 'sanitary-terminal'
        : flowTerminalIds.has(expressId)
          ? 'flow-terminal'
          : 'keyword'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, expressId, false) as any
      if (!line) continue

      const searchText = readLineText(line)
      const classified = classifyFixtureLine(source, {
        predefinedType: line.PredefinedType?.value ?? '',
        searchText,
      })
      if (classified === null) continue

      const kind = normalizeFixtureKindForKitchen(classified, searchText, false)
      countsByKind[kind] = (countsByKind[kind] ?? 0) + 1
      totalFixtureCount += 1
    }

    result.set(storeyId, {
      storeyId,
      toiletCount: countsByKind.TOILETPAN ?? 0,
      totalFixtureCount,
      countsByKind,
    })
  }

  return result
}

export interface InitialStoreyDecision {
  storeyId: StoreyId | null
  storeyName: string | null
  /** Human-readable explanation for the Decisions panel / debug JSON. */
  reason: string
  /** Wall-clock duration of the per-storey fixture scan; null when it never ran. */
  scanMs: number | null
}

/**
 * Runs the per-storey fixture scan once and feeds the pure chooser
 * (`chooseInitialStorey`). Called once per model open; the subsequently
 * opened floor runs the regular position-aware `detectFixtures`, which
 * re-reads the already-open in-memory model (no file re-parse).
 */
export async function chooseInitialStoreyByFixtures(
  api: IfcAPI,
  webIfcModelId: number,
  storeys: Storey[],
): Promise<InitialStoreyDecision> {
  const scanStart = performance.now()
  const counts = await scanStoreyFixtureCounts(
    api,
    webIfcModelId,
    storeys.map((storey) => storey.id),
  )
  const scanMs = Math.round(performance.now() - scanStart)

  const summaries: InitialStoreySummary[] = storeys.map((storey) => {
    const scan = counts.get(storey.id)
    return {
      id: storey.id,
      name: storey.name,
      elevation: storey.elevation,
      toiletCount: scan?.toiletCount ?? 0,
      fixtureFingerprint: buildFixtureFingerprint(scan?.countsByKind ?? {}),
    }
  })

  const choice = chooseInitialStorey(summaries)
  const chosen = storeys.find((storey) => storey.id === choice.storeyId) ?? null

  return {
    storeyId: choice.storeyId,
    storeyName: chosen?.name ?? null,
    reason: choice.reason,
    scanMs,
  }
}

function readTypeIdSet(api: IfcAPI, webIfcModelId: number, typeConstant: number): Set<number> {
  const ids = api.GetLineIDsWithType(webIfcModelId, typeConstant)
  const set = new Set<number>()
  for (let i = 0; i < ids.size(); i++) {
    set.add(ids.get(i))
  }
  return set
}
