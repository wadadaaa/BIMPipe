import type { IfcAPI } from 'web-ifc'
import type { Fixture, KitchenArea, StoreyId } from '@/domain/types'
import {
  mergeStoreyDetections,
  type MergedStoreyDetection,
  type SourcedStoreyDetection,
} from '@/domain/mergeFixturesAcrossFiles'
import { detectFixtures } from './detectFixtures'
import { detectKitchens } from './detectKitchens'

/**
 * Express IDs are only unique within one IFC file. Merged fixtures from linked
 * files are shifted into a distinct per-file range so they can never collide
 * with host express IDs in React keys, selection state, or riser assignment.
 * The stride comfortably exceeds any real model's express-ID space.
 */
export const LINKED_MODEL_EXPRESS_ID_STRIDE = 1_000_000_000

export interface HostDetectionTarget {
  webIfcModelId: number
  storeyId: StoreyId
  fileName: string
}

export interface LinkedDetectionTarget {
  webIfcModelId: number
  /** The linked file's OWN storey express ID (from the alignment pair). */
  storeyId: StoreyId
  fileName: string
}

/**
 * Runs fixture + kitchen detection on the host storey and on every linked
 * file's aligned storey, then merges the results per the cross-file dedupe
 * rules (`mergeStoreyDetections`). Linked results are retagged to the HOST
 * storey ID (downstream state is keyed by host storeys) and their express IDs
 * are shifted into a per-file range (see LINKED_MODEL_EXPRESS_ID_STRIDE).
 */
export async function detectMergedStoreyFixtures(
  api: IfcAPI,
  host: HostDetectionTarget,
  linkedTargets: LinkedDetectionTarget[],
): Promise<MergedStoreyDetection> {
  const hostDetection: SourcedStoreyDetection = {
    fileName: host.fileName,
    fixtures: await detectFixtures(api, host.webIfcModelId, host.storeyId),
    kitchens: await detectKitchens(api, host.webIfcModelId, host.storeyId),
  }

  const linkedDetections: SourcedStoreyDetection[] = []
  for (const [index, target] of linkedTargets.entries()) {
    const idOffset = (index + 1) * LINKED_MODEL_EXPRESS_ID_STRIDE
    const fixtures = await detectFixtures(api, target.webIfcModelId, target.storeyId)
    const kitchens = await detectKitchens(api, target.webIfcModelId, target.storeyId)
    linkedDetections.push({
      fileName: target.fileName,
      fixtures: fixtures.map((fixture): Fixture => ({
        ...fixture,
        expressId: fixture.expressId + idOffset,
        storeyId: host.storeyId,
      })),
      kitchens: kitchens.map((kitchen): KitchenArea => ({
        ...kitchen,
        expressId: kitchen.expressId + idOffset,
        storeyId: host.storeyId,
      })),
    })
  }

  return mergeStoreyDetections(hostDetection, linkedDetections)
}
