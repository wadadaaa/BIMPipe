import type { IfcAPI } from 'web-ifc'
import type { Fixture, KitchenArea, Storey, StoreyId } from '@/domain/types'
import type { FloorClass } from '@/shared/routes/floorClassification'
import { classifyFloors } from '@/shared/routes/floorClassification'
import type { RiserPlacementRuleProfile } from '@/shared/routes/riserPlacementProfile'
import type { HostDetectionTarget, LinkedDetectionTarget } from './detectMergedStoreyFixtures'

export interface StoreyDetectionSummary {
  storeyId: StoreyId
  storeyName: string
  floorClass: FloorClass
  /** Every detected fixture kind (V3: no longer toilets only). */
  fixtureCount: number
  toiletCount: number
  kitchenCount: number
  eligibleForNewRisers: boolean
  eligibilityReason: string
}

export interface StoreyDetectionAggregation {
  floors: StoreyDetectionSummary[]
  /** All fixture kinds per storey — wet-core clustering and stack extents need basins/sinks too. */
  fixturesByStoreyId: Record<StoreyId, Fixture[]>
  kitchensByStoreyId: Record<StoreyId, KitchenArea[]>
}

export interface StoreyDetectionServices {
  detectFixtures: (api: IfcAPI, webIfcModelId: number, storeyId: StoreyId) => Promise<Fixture[]>
  detectKitchens: (api: IfcAPI, webIfcModelId: number, storeyId: StoreyId) => Promise<KitchenArea[]>
  /**
   * Cross-file detection for a host storey with aligned linked storeys (V2
   * dedupe). Used only when `options.linkedTargetsFor` yields targets.
   */
  detectMergedFixtures?: (
    api: IfcAPI,
    host: HostDetectionTarget,
    linkedTargets: LinkedDetectionTarget[],
  ) => Promise<{ fixtures: Fixture[]; kitchens: KitchenArea[] }>
}

export interface AggregateStoreyDetectionsOptions {
  /** Called after each storey; may return a promise to let the UI repaint. */
  onProgress?: (processed: number, total: number, storey: Storey) => void | Promise<void>
  /** Aborting rejects with an `AbortError` DOMException before the next storey. */
  signal?: AbortSignal
  /**
   * Linked storeys aligned to a host storey (multi-IFC). When non-empty for a
   * storey, detection runs through `detectMergedFixtures` so the whole-building
   * fixture set carries the same cross-file merge as the open floor.
   */
  linkedTargetsFor?: (hostStoreyId: StoreyId) => LinkedDetectionTarget[]
  /** Host file name for the merge accounting; only used with linked targets. */
  hostFileName?: string
}

const DEFAULT_SERVICES: StoreyDetectionServices = {
  detectFixtures: async (api, webIfcModelId, storeyId) => {
    const { detectFixtures } = await import('./detectFixtures')
    return detectFixtures(api, webIfcModelId, storeyId)
  },
  detectKitchens: async (api, webIfcModelId, storeyId) => {
    const { detectKitchens } = await import('./detectKitchens')
    return detectKitchens(api, webIfcModelId, storeyId)
  },
  detectMergedFixtures: async (api, host, linkedTargets) => {
    const { detectMergedStoreyFixtures } = await import('./detectMergedStoreyFixtures')
    return detectMergedStoreyFixtures(api, host, linkedTargets)
  },
}

export async function aggregateStoreyDetections(
  api: IfcAPI,
  webIfcModelId: number,
  storeys: Storey[],
  profile: RiserPlacementRuleProfile,
  services: StoreyDetectionServices = DEFAULT_SERVICES,
  options: AggregateStoreyDetectionsOptions = {},
): Promise<StoreyDetectionAggregation> {
  const classifications = classifyFloors(storeys)
  const classificationByStorey = new Map(classifications.map((entry) => [entry.storeyId, entry]))

  const fixturesByStoreyId: Record<StoreyId, Fixture[]> = {}
  const kitchensByStoreyId: Record<StoreyId, KitchenArea[]> = {}

  for (const [index, storey] of storeys.entries()) {
    throwIfAborted(options.signal)
    const linkedTargets = options.linkedTargetsFor?.(storey.id) ?? []
    if (linkedTargets.length > 0 && services.detectMergedFixtures !== undefined) {
      const merged = await services.detectMergedFixtures(
        api,
        { webIfcModelId, storeyId: storey.id, fileName: options.hostFileName ?? 'host.ifc' },
        linkedTargets,
      )
      fixturesByStoreyId[storey.id] = merged.fixtures
      kitchensByStoreyId[storey.id] = merged.kitchens
    } else {
      const [fixtures, kitchens] = await Promise.all([
        services.detectFixtures(api, webIfcModelId, storey.id),
        services.detectKitchens(api, webIfcModelId, storey.id),
      ])
      fixturesByStoreyId[storey.id] = fixtures
      kitchensByStoreyId[storey.id] = kitchens
    }
    if (options.onProgress !== undefined) await options.onProgress(index + 1, storeys.length, storey)
  }
  throwIfAborted(options.signal)

  const floors: StoreyDetectionSummary[] = storeys.map((storey) => {
    const classification = classificationByStorey.get(storey.id)
    const floorClass = classification?.class ?? 'standard'
    const fixtures = fixturesByStoreyId[storey.id] ?? []
    const kitchens = kitchensByStoreyId[storey.id] ?? []
    const toiletCount = fixtures.filter((fixture) => fixture.kind === 'TOILETPAN').length
    const eligibleForNewRisers = isEligibleForNewRisers(floorClass, profile)

    return {
      storeyId: storey.id,
      storeyName: storey.name,
      floorClass,
      fixtureCount: fixtures.length,
      toiletCount,
      kitchenCount: kitchens.length,
      eligibleForNewRisers,
      eligibilityReason: getEligibilityReason(floorClass, eligibleForNewRisers),
    }
  })

  return {
    floors,
    fixturesByStoreyId,
    kitchensByStoreyId,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Storey detection aggregation was cancelled.', 'AbortError')
  }
}

function isEligibleForNewRisers(floorClass: FloorClass, profile: RiserPlacementRuleProfile): boolean {
  if (floorClass === 'basement' && profile.excludedFloorTypes.includes('basement')) return false
  if (floorClass === 'roof' && profile.excludedFloorTypes.includes('roof')) return false
  if (floorClass === 'penthouse' && profile.penthouseRule === 'exclude_new_risers') return false
  return true
}

function getEligibilityReason(floorClass: FloorClass, eligibleForNewRisers: boolean): string {
  if (eligibleForNewRisers) return 'eligible for new riser generation'
  if (floorClass === 'basement') return 'excluded basement floor'
  if (floorClass === 'roof') return 'excluded roof floor'
  if (floorClass === 'penthouse') return 'penthouse analyzed but excluded from new riser generation'
  return 'excluded by floor policy'
}
