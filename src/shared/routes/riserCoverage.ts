import type { Fixture, Riser } from '@/domain/types'
import { detectPlanUnits, planDistance } from './planGeometry'

export const MAX_RISER_TO_WC_MM = 500
export const MAX_RISER_TO_WC_M = 0.5

type PositionedToilet = Fixture & {
  kind: 'TOILETPAN'
  position: NonNullable<Fixture['position']>
}

export interface ToiletCoverageIssue {
  fixtureExpressId: number
  fixtureName: string
  nearestDistance: number | null
  reason: 'no_riser' | 'out_of_range' | 'shared_riser'
}

export function getMaxRiserToWcDistance(units: 'mm' | 'm'): number {
  return units === 'mm' ? MAX_RISER_TO_WC_MM : MAX_RISER_TO_WC_M
}

export function findUncoveredToilets(fixtures: Fixture[], risers: Riser[]): ToiletCoverageIssue[] {
  const toilets = fixtures.filter(
    (fixture): fixture is PositionedToilet =>
      fixture.kind === 'TOILETPAN' && fixture.position !== null,
  )

  if (toilets.length === 0) return []

  const units = detectPlanUnits(toilets.map((toilet) => toilet.position))
  const maxDistance = getMaxRiserToWcDistance(units)
  const candidateRisersByToilet = toilets.map((toilet) =>
    risers
      .map((riser, riserIndex) => ({
        riserIndex,
        distance: planDistance(toilet.position, riser.position),
      }))
      .sort((a, b) => a.distance - b.distance),
  )
  const inRangeRisersByToilet = candidateRisersByToilet.map((candidates) =>
    candidates
      .filter((candidate) => candidate.distance <= maxDistance)
      .map((candidate) => candidate.riserIndex),
  )
  const riserToToilet = new Array<number>(risers.length).fill(-1)
  const matchedToilets = new Set<number>()
  const toiletIndexes = Array.from({ length: toilets.length }, (_, index) => index).sort((a, b) => {
    const optionsDelta = inRangeRisersByToilet[a].length - inRangeRisersByToilet[b].length
    if (optionsDelta !== 0) return optionsDelta

    const nearestA = candidateRisersByToilet[a][0]?.distance ?? Infinity
    const nearestB = candidateRisersByToilet[b][0]?.distance ?? Infinity
    return nearestA - nearestB
  })

  for (const toiletIndex of toiletIndexes) {
    const visited = new Set<number>()
    if (tryMatchToilet(toiletIndex, inRangeRisersByToilet, riserToToilet, visited)) {
      matchedToilets.add(toiletIndex)
    }
  }

  return toilets.flatMap((toilet, toiletIndex) => {
    if (matchedToilets.has(toiletIndex)) return []

    const nearestDistance = candidateRisersByToilet[toiletIndex][0]?.distance ?? null
    const hasNearbyRiser =
      nearestDistance !== null && nearestDistance <= maxDistance

    return [
      {
        fixtureExpressId: toilet.expressId,
        fixtureName: toilet.name,
        nearestDistance,
        reason:
          nearestDistance === null
            ? 'no_riser'
            : hasNearbyRiser
              ? 'shared_riser'
              : 'out_of_range',
      },
    ]
  })
}

function tryMatchToilet(
  toiletIndex: number,
  candidateRisersByToilet: number[][],
  riserToToilet: number[],
  visited: Set<number>,
): boolean {
  for (const riserIndex of candidateRisersByToilet[toiletIndex]) {
    if (visited.has(riserIndex)) continue
    visited.add(riserIndex)

    if (
      riserToToilet[riserIndex] === -1 ||
      tryMatchToilet(riserToToilet[riserIndex], candidateRisersByToilet, riserToToilet, visited)
    ) {
      riserToToilet[riserIndex] = toiletIndex
      return true
    }
  }

  return false
}
