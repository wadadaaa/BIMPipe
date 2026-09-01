import type { IfcAPI } from 'web-ifc'
import { resolveLocalPlacementWorldMatrix } from './localPlacementMatrix'

/**
 * Reads the IfcBuilding ObjectPlacement resolved to WORLD coordinates (the
 * whole PlacementRelTo chain, so any IfcSite offset is included). Values are
 * raw IFC source units, Z-up — exactly what storey alignment needs to compute
 * absolute elevations (`alignStoreysByElevation`).
 *
 * Returns null when the model has no IfcBuilding, the building has no
 * placement, or the placement chain is malformed. Callers must treat null as
 * an explicit blocker (surfaced to the user), never assume a zero offset.
 */
export async function readBuildingPlacementSourcePoint(
  api: IfcAPI,
  webIfcModelId: number,
): Promise<{ x: number; y: number; z: number } | null> {
  const { IFCBUILDING } = await import('web-ifc')

  try {
    const ids = api.GetLineIDsWithType(webIfcModelId, IFCBUILDING)
    for (let i = 0; i < ids.size(); i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const line = api.GetLine(webIfcModelId, ids.get(i), false) as any
      const placementId: number | undefined = line?.ObjectPlacement?.value
      if (typeof placementId !== 'number') continue

      const elements = resolveLocalPlacementWorldMatrix(api, webIfcModelId, placementId).elements
      return { x: elements[12], y: elements[13], z: elements[14] }
    }
  } catch {
    // Malformed placement chain: report as unresolvable, the caller blocks explicitly.
  }

  return null
}
