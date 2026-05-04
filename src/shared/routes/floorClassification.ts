import type { Storey, StoreyId } from '@/domain/types'
import type { RiserPlacementRuleProfile } from './riserPlacementProfile'

export type FloorClass = 'standard' | 'basement' | 'roof' | 'penthouse'

export interface ClassifiedFloor {
  storeyId: StoreyId
  class: FloorClass
  confidence: number
  reasons: string[]
}

export function classifyFloors(storeys: Storey[]): ClassifiedFloor[] {
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation)
  const residentialCandidates = sorted.filter((storey) => !isBasement(storey.name) && !isRoof(storey.name))
  const penthouseId = residentialCandidates.length > 1 ? residentialCandidates.at(-1)?.id ?? null : null

  return sorted.map((storey) => classifyFloor(storey, penthouseId))
}

export function classifyFloor(storey: Storey, penthouseStoreyId: StoreyId | null): ClassifiedFloor {
  if (isBasement(storey.name)) {
    return { storeyId: storey.id, class: 'basement', confidence: 0.98, reasons: ['name indicates basement/cellar'] }
  }

  if (isRoof(storey.name)) {
    return { storeyId: storey.id, class: 'roof', confidence: 0.98, reasons: ['name indicates roof/terrace'] }
  }

  if (penthouseStoreyId !== null && storey.id === penthouseStoreyId) {
    return { storeyId: storey.id, class: 'penthouse', confidence: 0.7, reasons: ['last non-basement/non-roof floor'] }
  }

  return { storeyId: storey.id, class: 'standard', confidence: 0.8, reasons: ['eligible residential/standard floor'] }
}

export function getEligibleStoreyIdsForAutoRisers(
  storeys: Storey[],
  ruleProfile: RiserPlacementRuleProfile,
): StoreyId[] {
  const classifications = classifyFloors(storeys)
  return classifications
    .filter((entry) => {
      if (entry.class === 'basement' && ruleProfile.excludedFloorTypes.includes('basement')) return false
      if (entry.class === 'roof' && ruleProfile.excludedFloorTypes.includes('roof')) return false
      if (entry.class === 'penthouse' && ruleProfile.penthouseRule === 'exclude_new_risers') return false
      return true
    })
    .map((entry) => entry.storeyId)
}

function isBasement(name: string): boolean {
  return /מרתף|basement|cellar|\bb\d*\b|sub[-\s]?basement/i.test(name)
}

function isRoof(name: string): boolean {
  return /roof|terrace|pent roof|rooftop/i.test(name)
}
