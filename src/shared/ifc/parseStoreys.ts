import type { IfcAPI } from 'web-ifc'
import type { Storey, IfcModelId, StoreyId } from '@/domain/types'

/**
 * Parses IfcBuildingStorey entities from an already-opened IFC model.
 * Returns storeys sorted bottom-to-top by elevation.
 */
export async function parseStoreys(
  api: IfcAPI,
  webIfcModelId: number,
  domainModelId: IfcModelId,
): Promise<Storey[]> {
  const { IFCBUILDINGSTOREY } = await import('web-ifc')

  const ids = api.GetLineIDsWithType(webIfcModelId, IFCBUILDINGSTOREY)
  const storeys: Storey[] = []

  for (let i = 0; i < ids.size(); i++) {
    const expressID = ids.get(i) as StoreyId
    // flatten=true resolves referenced attributes into inline values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = api.GetLine(webIfcModelId, expressID, true) as any

    const name: string =
      line.LongName?.value ?? line.Name?.value ?? `Storey ${expressID}`
    const elevation: number = line.Elevation?.value ?? 0

    storeys.push({ id: expressID, name, elevation, modelId: domainModelId })
  }

  return storeys.sort((a, b) => a.elevation - b.elevation)
}
