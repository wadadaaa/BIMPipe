import type { IfcAPI } from 'web-ifc'
import type { Fixture, KitchenArea, Storey, StoreyId } from '@/domain/types'
import type { FloorClass } from '@/shared/routes/floorClassification'
import { classifyFloors } from '@/shared/routes/floorClassification'
import type { RiserPlacementRuleProfile } from '@/shared/routes/riserPlacementProfile'

export interface StoreyDetectionSummary {
  storeyId: StoreyId
  storeyName: string
  floorClass: FloorClass
  fixtureCount: number
  toiletCount: number
  kitchenCount: number
  eligibleForNewRisers: boolean
  eligibilityReason: string
}

export interface StoreyDetectionAggregation {
  floors: StoreyDetectionSummary[]
  fixturesByStoreyId: Record<StoreyId, Fixture[]>
  kitchensByStoreyId: Record<StoreyId, KitchenArea[]>
}

export interface StoreyDetectionServices {
  detectFixtures: (api: IfcAPI, webIfcModelId: number, storeyId: StoreyId) => Promise<Fixture[]>
  detectKitchens: (api: IfcAPI, webIfcModelId: number, storeyId: StoreyId) => Promise<KitchenArea[]>
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
}

export async function aggregateStoreyDetections(
  api: IfcAPI,
  webIfcModelId: number,
  storeys: Storey[],
  profile: RiserPlacementRuleProfile,
  services: StoreyDetectionServices = DEFAULT_SERVICES,
): Promise<StoreyDetectionAggregation> {
  const classifications = classifyFloors(storeys)
  const classificationByStorey = new Map(classifications.map((entry) => [entry.storeyId, entry]))

  const fixturesByStoreyId: Record<StoreyId, Fixture[]> = {}
  const kitchensByStoreyId: Record<StoreyId, KitchenArea[]> = {}

  for (const storey of storeys) {
    const [fixtures, kitchens] = await Promise.all([
      services.detectFixtures(api, webIfcModelId, storey.id),
      services.detectKitchens(api, webIfcModelId, storey.id),
    ])

    fixturesByStoreyId[storey.id] = fixtures.filter((fixture) => fixture.kind === 'TOILETPAN')
    kitchensByStoreyId[storey.id] = kitchens
  }

  const floors: StoreyDetectionSummary[] = storeys.map((storey) => {
    const classification = classificationByStorey.get(storey.id)
    const floorClass = classification?.class ?? 'standard'
    const fixtures = fixturesByStoreyId[storey.id] ?? []
    const kitchens = kitchensByStoreyId[storey.id] ?? []
    const toiletCount = fixtures.length
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
