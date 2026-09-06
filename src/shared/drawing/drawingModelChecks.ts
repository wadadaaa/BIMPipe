import type { FloorDrawingModel } from '@/domain/drawing/floorDrawingModel'
import { drawingPointInBounds } from './drawingFrame'

/**
 * Pure sanity checks on a `FloorDrawingModel`, shared by the gated tests and
 * the export script so a model is never written or asserted with NaN, content
 * outside its frame, or a client string in its labels.
 */

/** True when any numeric value in the model serialises as NaN/Infinity (JSON turns them into null). */
export function drawingModelHasNonFinite(model: FloorDrawingModel): boolean {
  let found = false
  JSON.stringify(model, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) found = true
    return value
  })
  return found
}

/** Pipe endpoints, riser centres and fixture centres outside `boundsM` (+ margin). */
export function drawingContentOutsideBounds(
  model: FloorDrawingModel,
  marginM = 0,
): { pipeEndpoints: number; risers: number; fixtures: number } {
  const { boundsM } = model
  let pipeEndpoints = 0
  for (const pipe of model.pipes) {
    if (!drawingPointInBounds(pipe.start, boundsM, marginM)) pipeEndpoints += 1
    if (!drawingPointInBounds(pipe.end, boundsM, marginM)) pipeEndpoints += 1
  }
  const risers = model.risers.filter((riser) => !drawingPointInBounds(riser.centre, boundsM, marginM)).length
  const fixtures = model.fixtures.filter((fixture) => !drawingPointInBounds(fixture.centre, boundsM, marginM)).length
  return { pipeEndpoints, risers, fixtures }
}

/**
 * Label strings of the model (title, storey label, riser tags, span notes)
 * that contain any of the forbidden substrings (file names, their stems,
 * project codes) — case-insensitive. Empty when the sheet is clean. Needles
 * shorter than 3 characters (e.g. a two-letter discipline stem such as "SA")
 * are ignored: they match ordinary English words and carry no identity.
 */
export const MIN_FORBIDDEN_NEEDLE_LENGTH = 3

export function drawingLabelsContaining(model: FloorDrawingModel, forbidden: readonly string[]): string[] {
  const needles = forbidden
    .flatMap((value) => [value, value.replace(/\.ifc$/i, '')])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= MIN_FORBIDDEN_NEEDLE_LENGTH)
  const labels = [
    model.title,
    model.storeyLabel,
    ...model.risers.map((riser) => riser.tag),
    ...model.risers.flatMap((riser) => riser.spansStoreyLabels ?? []),
  ]
  return labels.filter((label) => {
    const lower = label.toLowerCase()
    return needles.some((needle) => lower.includes(needle))
  })
}
