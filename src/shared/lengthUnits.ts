/**
 * Canonical length-unit conversion and formatting.
 *
 * Every displayed length in the app must go through this module. Units are
 * always explicit ('mm' | 'cm' | 'm') — there is no implicit default unit.
 *
 * Two kinds of length values exist in the app and they carry different units:
 * - Raw IFC attribute values (e.g. IfcBuildingStorey.Elevation) are in the
 *   model's source unit as declared by IfcUnitAssignment (see
 *   `resolveModelLengthUnit`). A cm-based Revit export stores elevation 3015
 *   meaning 30.15 m.
 * - Mesh-derived viewer coordinates (fixture centroids, riser positions) are
 *   normalized to metres by web-ifc's geometry pipeline whenever the model
 *   declares its length unit.
 */

export type LengthUnit = 'mm' | 'cm' | 'm'

const METERS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
}

const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
}

export function toMeters(value: number, unit: LengthUnit): number {
  return value * METERS_PER_UNIT[unit]
}

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit]
}

export interface FormatLengthOptions {
  /** Fraction digits in the formatted number. Defaults: 2 for metres, 0 for millimetres. */
  decimals?: number
}

/** Formats a raw length as metres, e.g. `formatLengthM(3015, 'cm') === '30.15 m'`. */
export function formatLengthM(
  value: number,
  unit: LengthUnit,
  opts: FormatLengthOptions = {},
): string {
  return `${formatNumber(toMeters(value, unit), opts.decimals ?? 2)} m`
}

/** Formats a raw length as millimetres, e.g. `formatLengthMm(0.15, 'm') === '150 mm'`. */
export function formatLengthMm(
  value: number,
  unit: LengthUnit,
  opts: FormatLengthOptions = {},
): string {
  return `${formatNumber(toMm(value, unit), opts.decimals ?? 0)} mm`
}

/** toFixed with negative-zero normalization so "-0.00" never reaches the UI. */
function formatNumber(value: number, decimals: number): string {
  const text = value.toFixed(decimals)
  return /^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text
}
