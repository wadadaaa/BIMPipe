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

// ---------------------------------------------------------------------------
// Multi-model build (V3): host + every linked file contribute to ONE map
// ---------------------------------------------------------------------------

/** One loaded file that contributes geometry to the merged continuity map. */
export interface ContinuityMapSource {
  fileName: string
  webIfcModelId: number
  /** Resolved length unit of the file's raw attributes; null = unknown → file skipped with a diagnostic. */
  lengthUnit: ModelLengthUnit | null
  /** Linked storey ID → host storey ID; null when this file IS the host. */
  sourceToHostStoreyId: Map<StoreyId, StoreyId> | null
  /**
   * Optional scope in the file's OWN storey ids. Linked files are normally
   * scoped to the storeys that align to the host so a 100+ MB architecture
   * file is not walked in full.
   */
  storeyIds?: ReadonlySet<StoreyId>
}

export interface ContinuitySourceContribution {
  fileName: string
  storeyCount: number
  obstructionCount: number
  voidCount: number
  spaceCount: number
  extractMs: number
  /** Set when the file contributed nothing, with the reason. */
  skippedReason: string | null
}

export interface ContinuityMapMultiBuildResult extends ContinuityMapBuildResult {
  /** Files that actually contributed geometry, in input order. */
  sourceFileNames: string[]
  contributions: ContinuitySourceContribution[]
}

export interface BuildContinuityMapForModelsArgs {
  api: IfcAPI
  /** Host first, then linked files (upload order). */
  sources: ContinuityMapSource[]
  onProgress?: (progress: {
    fileName: string
    sourceIndex: number
    sourceCount: number
    processed: number
    total: number
  }) => void | Promise<void>
}

/**
 * Merges the per-storey continuity inputs of several files (already in HOST
 * storey ids and metres) into one bottom-to-top storey list. Element ids are
 * prefixed with the file name so ids from different files never collide.
 * Storey name/elevation come from the first file that mentions the storey
 * (the host, since it is first). Pure, for tests.
 */
export function mergeContinuityStoreyInputs(
  perSource: Array<{ fileName: string; storeys: ContinuityStoreyInput[] }>,
): ContinuityStoreyInput[] {
  const byStorey = new Map<StoreyId, ContinuityStoreyInput>()
  for (const { fileName, storeys } of perSource) {
    const prefix = (id: string) => `${fileName}:${id}`
    for (const storey of storeys) {
      const target = byStorey.get(storey.storeyId) ?? {
        storeyId: storey.storeyId,
        storeyName: storey.storeyName,
        elevation: storey.elevation,
        obstructions: [],
        voids: [],
        spaces: [],
      }
      target.obstructions.push(...storey.obstructions.map((item) => ({ ...item, id: prefix(item.id) })))
      target.voids.push(...storey.voids.map((item) => ({ ...item, id: prefix(item.id) })))
      target.spaces.push(...storey.spaces.map((item) => ({ ...item, id: prefix(item.id) })))
      byStorey.set(storey.storeyId, target)
    }
  }
  return [...byStorey.values()].sort((a, b) => a.elevation - b.elevation || a.storeyId - b.storeyId)
}

/**
 * Builds ONE continuity map from every loaded file: the host's own geometry
 * plus each linked file's walls / columns / slabs / openings / spaces, remapped
 * onto host storeys. This is what lets slab openings modelled only in a linked
 * structural file become shaft candidates for the host's fixtures.
 */
export async function buildContinuityMapForModels({
  api,
  sources,
  onProgress,
}: BuildContinuityMapForModelsArgs): Promise<ContinuityMapMultiBuildResult> {
  const diagnostics: string[] = []
  const contributions: ContinuitySourceContribution[] = []
  const perSource: Array<{ fileName: string; storeys: ContinuityStoreyInput[] }> = []
  let extractMs = 0

  for (const [sourceIndex, source] of sources.entries()) {
    if (source.lengthUnit === null) {
      const reason = `${source.fileName} declares no supported length unit; its storey elevations cannot be converted, so it was left out of the continuity map.`
      diagnostics.push(reason)
      contributions.push(emptyContribution(source.fileName, 0, reason))
      continue
    }
    if (source.sourceToHostStoreyId !== null && source.sourceToHostStoreyId.size === 0) {
      const reason = `${source.fileName}: none of its storeys align to the host, so it was left out of the continuity map.`
      diagnostics.push(reason)
      contributions.push(emptyContribution(source.fileName, 0, reason))
      continue
    }

    const extractStart = performance.now()
    const extraction = await extractContinuityStoreyInputs(api, source.webIfcModelId, {
      storeyIds: source.storeyIds,
      onStoreyProgress:
        onProgress === undefined
          ? undefined
          : (processed, total) =>
              onProgress({ fileName: source.fileName, sourceIndex, sourceCount: sources.length, processed, total }),
    })
    const sourceExtractMs = performance.now() - extractStart
    extractMs += sourceExtractMs
    diagnostics.push(...extraction.diagnostics.map((line) => `${source.fileName}: ${line}`))

    let storeys = convertContinuityElevationsToMeters(extraction.storeys, source.lengthUnit)
    if (source.sourceToHostStoreyId !== null) {
      const remap = remapContinuityStoreysToHost(storeys, source.sourceToHostStoreyId)
      storeys = remap.storeys
      diagnostics.push(...remap.diagnostics.map((line) => `${source.fileName}: ${line}`))
    }
    perSource.push({ fileName: source.fileName, storeys })
    contributions.push({
      fileName: source.fileName,
      storeyCount: storeys.length,
      obstructionCount: storeys.reduce((sum, storey) => sum + storey.obstructions.length, 0),
      voidCount: storeys.reduce((sum, storey) => sum + storey.voids.length, 0),
      spaceCount: storeys.reduce((sum, storey) => sum + storey.spaces.length, 0),
      extractMs: sourceExtractMs,
      skippedReason: null,
    })
  }

  const merged = mergeContinuityStoreyInputs(perSource)
  const buildStart = performance.now()
  const map = buildContinuityMap({ units: 'm', storeys: merged })
  const buildMs = performance.now() - buildStart

  return {
    map,
    diagnostics,
    extractMs,
    buildMs,
    processedStoreyCount: merged.length,
    sourceFileNames: perSource.map((entry) => entry.fileName),
    contributions,
  }
}

function emptyContribution(fileName: string, extractMs: number, skippedReason: string): ContinuitySourceContribution {
  return { fileName, storeyCount: 0, obstructionCount: 0, voidCount: 0, spaceCount: 0, extractMs, skippedReason }
}
