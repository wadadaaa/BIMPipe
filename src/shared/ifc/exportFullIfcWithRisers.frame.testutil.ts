import type { IfcAPI } from 'web-ifc'
import { FRAME_PSET_NAME } from './exportFullIfcWithRisers'

type IfcScalar = { value?: string | number | null } | string | number | null | undefined

export interface BimPipeFramePsetReading {
  /** Property name -> nominal value. */
  properties: Record<string, string | number>
  /** IFC type names of the objects the pset is attached to (expected: ['IfcProject']). */
  relatedObjectTypes: string[]
}

/**
 * Test helper: reads the `BIMPipe_Frame` property set from a reopened model as
 * a plain name -> value record, and reports which object it is attached to.
 * Returns null when the pset is absent.
 */
export function readBimPipeFramePset(api: IfcAPI, modelId: number): BimPipeFramePsetReading | null {
  const psetType = api.GetTypeCodeFromName('IFCPROPERTYSET')
  const psetIds = api.GetLineIDsWithType(modelId, psetType)

  for (let i = 0; i < psetIds.size(); i += 1) {
    const psetId = psetIds.get(i)
    const pset = api.GetLine(modelId, psetId, false) as {
      Name?: IfcScalar
      HasProperties?: Array<{ value?: number } | null> | null
    } | null
    if (readScalar(pset?.Name) !== FRAME_PSET_NAME) continue

    const record: Record<string, string | number> = {}
    for (const ref of pset?.HasProperties ?? []) {
      const propertyId = ref?.value
      if (typeof propertyId !== 'number') continue
      const property = api.GetLine(modelId, propertyId, false) as {
        Name?: IfcScalar
        NominalValue?: IfcScalar
      } | null
      const name = readScalar(property?.Name)
      const value = readScalar(property?.NominalValue)
      if (typeof name === 'string' && value !== null) record[name] = value
    }

    return { properties: record, relatedObjectTypes: findRelatedObjectTypes(api, modelId, psetId) }
  }

  return null
}

function findRelatedObjectTypes(api: IfcAPI, modelId: number, psetId: number): string[] {
  const relType = api.GetTypeCodeFromName('IFCRELDEFINESBYPROPERTIES')
  const relIds = api.GetLineIDsWithType(modelId, relType)
  const types: string[] = []
  for (let i = 0; i < relIds.size(); i += 1) {
    const rel = api.GetLine(modelId, relIds.get(i), false) as {
      RelatedObjects?: Array<{ value?: number } | null> | null
      RelatingPropertyDefinition?: { value?: number } | null
    } | null
    if (rel?.RelatingPropertyDefinition?.value !== psetId) continue
    for (const ref of rel.RelatedObjects ?? []) {
      if (typeof ref?.value === 'number') {
        types.push(api.GetNameFromTypeCode(api.GetLineType(modelId, ref.value)))
      }
    }
  }
  return types
}

function readScalar(value: IfcScalar): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  const inner = value?.value
  return typeof inner === 'string' || typeof inner === 'number' ? inner : null
}
