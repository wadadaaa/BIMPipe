import type { IfcAPI } from 'web-ifc'
import type { LengthUnit } from '@/shared/lengthUnits'

interface IfcHandle {
  value?: number | null
}

interface IfcEnumValue {
  value?: string | null
}

/**
 * Reads the model's declared length unit from IfcProject.UnitsInContext
 * (the IfcUnitAssignment LENGTHUNIT entry) of an already-opened web-ifc model.
 *
 * This is the PRIMARY unit signal for the app; coordinate-magnitude heuristics
 * (`detectPlanUnits`) remain only a fallback for models where this returns null.
 *
 * Returns null — never a guess — when:
 * - the model has no IfcProject or no unit assignment,
 * - the assignment has no LENGTHUNIT entry,
 * - the length unit is conversion-based (e.g. feet/inches), or
 * - the SI unit uses a prefix other than MILLI/CENTI/none.
 */
export async function resolveModelLengthUnit(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<LengthUnit | null> {
  const { IFCPROJECT, IFCSIUNIT } = await import('web-ifc')

  const projectIds = api.GetLineIDsWithType(webIfcModelId, IFCPROJECT)
  if (projectIds.size() === 0) return null

  const project = api.GetLine(webIfcModelId, projectIds.get(0), false) as {
    UnitsInContext?: IfcHandle | null
  } | null
  const assignmentId = project?.UnitsInContext?.value ?? null
  if (assignmentId === null) return null

  const assignment = api.GetLine(webIfcModelId, assignmentId, false) as {
    Units?: Array<IfcHandle | null> | null
  } | null

  for (const unitRef of assignment?.Units ?? []) {
    const unitId = unitRef?.value ?? null
    if (unitId === null) continue

    const unit = api.GetLine(webIfcModelId, unitId, false) as {
      UnitType?: IfcEnumValue | null
      Name?: IfcEnumValue | null
      Prefix?: IfcEnumValue | null
    } | null
    if (unit?.UnitType?.value !== 'LENGTHUNIT') continue

    // The assignment's length unit is not an IfcSIUnit (e.g. IfcConversionBasedUnit
    // for feet or inches). Report unknown instead of guessing a conversion factor.
    if (api.GetLineType(webIfcModelId, unitId) !== IFCSIUNIT) return null
    if (unit.Name?.value !== 'METRE') return null

    switch (unit.Prefix?.value ?? null) {
      case 'MILLI':
        return 'mm'
      case 'CENTI':
        return 'cm'
      case null:
        return 'm'
      default:
        // DECI, KILO, MICRO, ... — unsupported; do not silently assume.
        return null
    }
  }

  return null
}
