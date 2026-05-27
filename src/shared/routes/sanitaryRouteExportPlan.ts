import type { Riser, Storey, StoreyId } from '@/domain/types'
import { planDistance } from './planGeometry'
import type { RouteSegment, SanitaryFixtureRoute, SanitaryPipeDiameterMm } from './buildSanitaryRoutes'

export interface SanitaryExportSegment {
  key: string
  riserId: string
  riserStackLabel: string
  storeyId: StoreyId
  segment: RouteSegment
  slope: number
  startHeightAboveFloorM: number
  upstreamPlanDistance: number
  label: string
  fixtureExpressIds: number[]
}

const COORD_KEY_SCALE = 1000

export function collectSanitaryExportSegments(
  routes: SanitaryFixtureRoute[],
  storeys: Pick<Storey, 'id' | 'elevation'>[],
  risers: Riser[],
): SanitaryExportSegment[] {
  if (routes.length === 0) return []

  const riserById = new Map(risers.map((riser) => [riser.id, riser]))
  const storeyElevationById = new Map(storeys.map((storey) => [storey.id, storey.elevation]))
  const segmentsByKey = new Map<string, SanitaryExportSegment>()

  for (const route of routes) {
    const riser = riserById.get(route.riserId)
    if (!riser) continue

    const riserStoreyElevation = storeyElevationById.get(riser.storeyId)
    if (typeof riserStoreyElevation !== 'number' || !Number.isFinite(riserStoreyElevation)) continue

    let upstreamPlanDistance = 0
    for (const segment of route.segments) {
      const key = segmentGeometryKey(segment)
      const existing = segmentsByKey.get(key)
      if (existing) {
        if (!existing.fixtureExpressIds.includes(route.fixtureExpressId)) {
          existing.fixtureExpressIds.push(route.fixtureExpressId)
        }
        upstreamPlanDistance += planDistance(segment.from, segment.to)
        continue
      }

      segmentsByKey.set(key, {
        key,
        riserId: route.riserId,
        riserStackLabel: riser.stackLabel,
        storeyId: riser.storeyId,
        segment,
        slope: route.slope,
        startHeightAboveFloorM: route.startHeightAboveFloorM,
        upstreamPlanDistance,
        label: buildSegmentLabel(route, segment, riser.stackLabel),
        fixtureExpressIds: [route.fixtureExpressId],
      })

      upstreamPlanDistance += planDistance(segment.from, segment.to)
    }
  }

  return [...segmentsByKey.values()].sort((left, right) => left.key.localeCompare(right.key))
}

export function segmentEndpointElevationsSourceUnits(
  exportSegment: SanitaryExportSegment,
  storeyElevationSourceUnits: number,
  sourceUnitsPerViewerUnit: number,
  millimetresPerSourceUnit: number,
): { startElevation: number; endElevation: number } {
  const heightAboveFloorSourceUnits =
    exportSegment.startHeightAboveFloorM * (1000 / millimetresPerSourceUnit)
  const upstreamDrop =
    exportSegment.upstreamPlanDistance * sourceUnitsPerViewerUnit * exportSegment.slope
  const segmentPlanLength = planDistance(exportSegment.segment.from, exportSegment.segment.to)
  const segmentDrop = segmentPlanLength * sourceUnitsPerViewerUnit * exportSegment.slope

  const startElevation = storeyElevationSourceUnits + heightAboveFloorSourceUnits - upstreamDrop
  const endElevation = startElevation - segmentDrop
  return { startElevation, endElevation }
}

function segmentGeometryKey(segment: RouteSegment): string {
  const from = coordKey(segment.from)
  const to = coordKey(segment.to)
  return `${from}->${to}|${segment.kind}|${segment.pipeDiameterMm}`
}

function coordKey(point: { x: number; y: number; z: number }): string {
  return [
    Math.round(point.x * COORD_KEY_SCALE),
    Math.round(point.y * COORD_KEY_SCALE),
    Math.round(point.z * COORD_KEY_SCALE),
  ].join(',')
}

function buildSegmentLabel(
  route: SanitaryFixtureRoute,
  segment: RouteSegment,
  stackLabel: string,
): string {
  const diameter = segment.pipeDiameterMm
  const role = segment.kind === 'branch' ? 'Branch' : 'Main'
  const fixture = route.fixtureName.trim() || `#${route.fixtureExpressId}`
  return `BIMPipe ${role} ${diameter}mm ${fixture} -> ${stackLabel}`
}

export function diameterLabel(diameterMm: SanitaryPipeDiameterMm): string {
  return `PVC ${diameterMm}`
}
