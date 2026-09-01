import { formatLengthM, type LengthUnit } from '@/shared/lengthUnits'

/**
 * Status-bar elevation chip text for the floor viewer. With a declared model
 * unit the raw IFC elevation is formatted as metres; without one the raw
 * number is shown with no unit suffix (we never assume a unit).
 */
export function formatStoreyElevationChip(elevation: number, unit: LengthUnit | null): string {
  if (unit === null) return Math.round(elevation).toLocaleString()
  return formatLengthM(elevation, unit)
}
