import type { IfcAPI } from 'web-ifc'
import { toMeters, type LengthUnit } from '@/shared/lengthUnits'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'

interface IfcHandle {
  value?: number | null
}

interface IfcScalar<T> {
  value?: T | null
}

type IfcNumberList = Array<IfcScalar<number> | number | null> | null | undefined

export interface SourcePoint3 {
  x: number
  y: number
  z: number
}

/**
 * The model's 3D `IfcGeometricRepresentationContext` ('Model') read verbatim.
 *
 * Revit ("CoordinateBase: Project Base Point" exports) and some other authoring
 * tools write the survey-point offset and the true-north rotation here instead
 * of into the IfcSite/IfcBuilding placement chain. web-ifc ignores this WCS
 * when tessellating (its coordination matrix stays identity), so the geometry
 * of such a model lands near the origin and the placement probes report
 * nothing. This reader makes the context an explicit detection source.
 *
 * All values are read as written; nothing is applied to geometry.
 */
export interface RepresentationContextFrame {
  contextExpressId: number
  /** `WorldCoordinateSystem.Location` in the model's declared length unit (IFC axes, Z-up). */
  wcsLocationSource: SourcePoint3
  /**
   * Same location in metres via the single unit converter, or null when the
   * model declares no usable length unit (never guessed).
   */
  wcsLocationM: SourcePoint3 | null
  /** Declared unit the source values are in; null when undeclared/unsupported. */
  lengthUnit: LengthUnit | null
  /**
   * Rotation of the WCS about +Z from `WorldCoordinateSystem.RefDirection`,
   * degrees, counter-clockwise from +X. 0 when RefDirection is absent.
   */
  wcsRotationDeg: number
  /**
   * `TrueNorth` as a signed angle from project +Y, degrees. Positive means true
   * north leans toward +X (clockwise in plan). `atan2(x, y)` of the direction;
   * null when TrueNorth is absent.
   */
  trueNorthDeg: number | null
}

const RADIANS_TO_DEGREES = 180 / Math.PI

/**
 * Finds the 3D 'Model' representation context (never a sub-context) and reads
 * its WorldCoordinateSystem and TrueNorth. Returns null when the model has no
 * 3D context or its WCS placement is unreadable.
 *
 * `declaredUnit` should be the result of `resolveModelLengthUnit` when the
 * caller already has it; otherwise it is resolved here (same converter).
 */
export async function readRepresentationContextFrame(
  api: IfcAPI,
  modelId: number,
  declaredUnit: LengthUnit | null = null,
): Promise<RepresentationContextFrame | null> {
  const { IFCGEOMETRICREPRESENTATIONCONTEXT } = await import('web-ifc')

  const contextId = findModelContextId(api, modelId, IFCGEOMETRICREPRESENTATIONCONTEXT)
  if (contextId === null) return null

  const context = api.GetLine(modelId, contextId, false) as {
    WorldCoordinateSystem?: IfcHandle | null
    TrueNorth?: IfcHandle | null
  } | null
  const wcsId = context?.WorldCoordinateSystem?.value ?? null
  if (wcsId === null) return null

  const wcs = api.GetLine(modelId, wcsId, false) as {
    Location?: IfcHandle | null
    RefDirection?: IfcHandle | null
  } | null
  const location = readNumberList(api, modelId, wcs?.Location?.value ?? null, 'Coordinates')
  if (location === null || location.length < 2) return null
  const wcsLocationSource: SourcePoint3 = {
    x: location[0],
    y: location[1],
    z: location[2] ?? 0,
  }

  const refDirection = readNumberList(api, modelId, wcs?.RefDirection?.value ?? null, 'DirectionRatios')
  const wcsRotationDeg =
    refDirection !== null && refDirection.length >= 2 && (refDirection[0] !== 0 || refDirection[1] !== 0)
      ? Math.atan2(refDirection[1], refDirection[0]) * RADIANS_TO_DEGREES
      : 0

  const trueNorth = readNumberList(api, modelId, context?.TrueNorth?.value ?? null, 'DirectionRatios')
  const trueNorthDeg =
    trueNorth !== null && trueNorth.length >= 2 && (trueNorth[0] !== 0 || trueNorth[1] !== 0)
      ? Math.atan2(trueNorth[0], trueNorth[1]) * RADIANS_TO_DEGREES
      : null

  const lengthUnit = declaredUnit ?? (await resolveModelLengthUnit(api, modelId))
  const wcsLocationM =
    lengthUnit === null
      ? null
      : {
          x: toMeters(wcsLocationSource.x, lengthUnit),
          y: toMeters(wcsLocationSource.y, lengthUnit),
          z: toMeters(wcsLocationSource.z, lengthUnit),
        }

  return {
    contextExpressId: contextId,
    wcsLocationSource,
    wcsLocationM,
    lengthUnit,
    wcsRotationDeg,
    trueNorthDeg,
  }
}

/**
 * Prefers ContextType 'Model' with CoordinateSpaceDimension 3, then any 3D
 * context. `GetLineIDsWithType` without `includeInherited` excludes
 * IfcGeometricRepresentationSubContext lines, so sub-contexts never match.
 */
function findModelContextId(api: IfcAPI, modelId: number, contextType: number): number | null {
  const ids = api.GetLineIDsWithType(modelId, contextType)
  let fallback: number | null = null

  for (let i = 0; i < ids.size(); i += 1) {
    const expressId = ids.get(i)
    if (api.GetLineType(modelId, expressId) !== contextType) continue

    const line = api.GetLine(modelId, expressId, false) as {
      ContextType?: IfcScalar<string> | null
      CoordinateSpaceDimension?: IfcScalar<number> | number | null
    } | null
    const dimension = readScalarNumber(line?.CoordinateSpaceDimension)
    if (dimension !== 3) continue
    if (line?.ContextType?.value === 'Model') return expressId
    fallback ??= expressId
  }

  return fallback
}

function readNumberList(
  api: IfcAPI,
  modelId: number,
  expressId: number | null,
  attribute: 'Coordinates' | 'DirectionRatios',
): number[] | null {
  if (expressId === null) return null
  const line = api.GetLine(modelId, expressId, false) as Record<string, IfcNumberList> | null
  const values = line?.[attribute]
  if (!Array.isArray(values)) return null
  const numbers = values.map((value) => readScalarNumber(value))
  return numbers.every((value): value is number => value !== null) ? numbers : null
}

function readScalarNumber(value: IfcScalar<number> | number | null | undefined): number | null {
  const raw = typeof value === 'number' ? value : value?.value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}
