import type { IfcAPI } from 'web-ifc'
import type { StoreyId } from '@/domain/types'
import {
  buildContinuityMap,
  type ContinuityMap,
  type ContinuityStoreyInput,
} from '@/domain/continuityMap'
import { toMeters, type LengthUnit as ModelLengthUnit } from '@/shared/lengthUnits'
import {
  extractContinuityStoreyInputs,
  type ExtractContinuityOptions,
} from './extractContinuityInputs'

/**
 * App-facing continuity-map builder (W5): extraction + unit conversion +
 * host-storey remap + domain build, with timings.
 *
 * Unit boundary (empirically verified, not assumed):
 * - Element footprints come from web-ifc `GetFlatMesh`, which emits geometry
 *   in METRES regardless of the model's declared unit — proven on the cm
 *   model 096 by `engineerPlanFrame.096.test.ts`, where fixture centroids
 *   from the same vertex math land within ~1.2 m of engineer riser stacks
 *   converted cm→m (a raw-cm frame would be off by 100x). Footprints are
 *   therefore passed through unconverted with map units 'm'.
 * - Storey elevations from `parseStoreys` are RAW source units (096: cm) and
 *   are converted to metres here with the resolved model unit.
 */

/** Converts raw source-unit storey elevations to metres (pure, for tests). */
export function convertContinuityElevationsToMeters(
  storeys: ContinuityStoreyInput[],
  sourceUnit: ModelLengthUnit,
): ContinuityStoreyInput[] {
  return storeys.map((storey) => ({
    ...storey,
    elevation: toMeters(storey.elevation, sourceUnit),
  }))
}

export interface RemapContinuityStoreysResult {
  storeys: ContinuityStoreyInput[]
  /** Dropped storeys, with reasons — never silently removed. */
  diagnostics: string[]
}

/**
 * Rewrites the storey IDs of a LINKED architecture model to the host model's
 * storey IDs (W4 alignment pairs), so grids, shaft candidates, and snapping
 * all speak host storey IDs. Storeys without a host counterpart are dropped
 * with a diagnostic: keeping their linked-model express IDs could collide
 * numerically with unrelated host storey IDs.
 */
export function remapContinuityStoreysToHost(
  storeys: ContinuityStoreyInput[],
  sourceToHostStoreyId: Map<StoreyId, StoreyId>,
): RemapContinuityStoreysResult {
  const remapped: ContinuityStoreyInput[] = []
  const diagnostics: string[] = []
  for (const storey of storeys) {
    const hostStoreyId = sourceToHostStoreyId.get(storey.storeyId)
    if (hostStoreyId === undefined) {
      diagnostics.push(
        `Storey "${storey.storeyName}" (linked express ID ${storey.storeyId}) has no aligned host storey and was excluded from the continuity map.`,
      )
      continue
    }
    remapped.push({ ...storey, storeyId: hostStoreyId })
  }
  return { storeys: remapped, diagnostics }
}

export interface BuildContinuityMapForModelArgs {
  api: IfcAPI
  webIfcModelId: number
  /** Resolved length unit of the SOURCE model's raw attributes (never assumed). */
  lengthUnit: ModelLengthUnit
  /**
   * Linked-model storey ID → host storey ID mapping from the W4 alignment.
   * Null when the source model IS the host (identity, no remap).
   */
  sourceToHostStoreyId: Map<StoreyId, StoreyId> | null
  /** Optional storey scope + progress callback (see ExtractContinuityOptions). */
  storeyIds?: ExtractContinuityOptions['storeyIds']
  onStoreyProgress?: ExtractContinuityOptions['onStoreyProgress']
}

export interface ContinuityMapBuildResult {
  /** Units 'm'; storey IDs are HOST storey IDs. */
  map: ContinuityMap
  /** Adapter + remap diagnostics (domain diagnostics live in map.diagnostics). */
  diagnostics: string[]
  /** Geometry extraction time (the expensive part). */
  extractMs: number
  /** Pure buildContinuityMap time. */
  buildMs: number
  processedStoreyCount: number
}

export async function buildContinuityMapForModel({
  api,
  webIfcModelId,
  lengthUnit,
  sourceToHostStoreyId,
  storeyIds,
  onStoreyProgress,
}: BuildContinuityMapForModelArgs): Promise<ContinuityMapBuildResult> {
  const extractStart = performance.now()
  const extraction = await extractContinuityStoreyInputs(api, webIfcModelId, {
    storeyIds,
    onStoreyProgress,
  })
  const extractMs = performance.now() - extractStart

  const diagnostics = [...extraction.diagnostics]
  let storeys = convertContinuityElevationsToMeters(extraction.storeys, lengthUnit)
  if (sourceToHostStoreyId !== null) {
    const remap = remapContinuityStoreysToHost(storeys, sourceToHostStoreyId)
    storeys = remap.storeys
    diagnostics.push(...remap.diagnostics)
  }

  const buildStart = performance.now()
  const map = buildContinuityMap({ units: 'm', storeys })
  const buildMs = performance.now() - buildStart

  return { map, diagnostics, extractMs, buildMs, processedStoreyCount: storeys.length }
}
