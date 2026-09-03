import type { StoreyAlignment } from '@/domain/alignStoreys'
import type { EngineerEndpointSource, EngineerPipeNetwork, EngineerRiserStack } from '@/domain/engineerPipes'
import type { StoreyId } from '@/domain/types'
import type { Point3D } from '@/shared/routes/planGeometry'
import {
  alignEngineerStacksToViewerPlan,
  ifcSourceToViewerPoint,
} from '@/shared/frame/ifcSourceFrame'

/**
 * 2D overlay presentation of the engineer pipe network (W7).
 *
 * Pure module: converts extracted engineer segments (IFC source coordinates,
 * source units) and riser stacks (IFC source plan metres) into the viewer's
 * LOCAL frame, ready to draw. Frame math lives in
 * `src/shared/frame/ifcSourceFrame.ts` (empirically proven on 096-P).
 */

export interface EngineerOverlaySegment {
  key: string
  /** Local viewer frame (source metres minus the host model origin). */
  from: Point3D
  to: Point3D
  diameterMm: number | null
  systemName: string | null
}

export interface EngineerOverlayStackMarker {
  key: string
  /** Local viewer plan position of the vertical stack. */
  x: number
  z: number
  diameterMm: number
  /** Storeys whose slab band the stack's Z-range intersects (geometric span). */
  storeyCount: number
}

export interface EngineerOverlayPresentation {
  hasNetwork: boolean
  visibleSegments: EngineerOverlaySegment[]
  /**
   * Engineer SANITARY riser stacks (extent ≥ one storey pitch; vents and stubs
   * are not drawn), shown model-wide rather than storey-filtered: risers are
   * vertical shafts whose plan position is valid on every storey, and 096
   * models several of them as single full-height pipes contained in one
   * storey only (per-storey containment understates the span).
   */
  visibleStackMarkers: EngineerOverlayStackMarker[]
  /**
   * Segments on the open floor whose endpoints could not be placed in the
   * viewer frame (mesh-bounds fallback or missing geometry). Excluded from
   * the drawing, surfaced as a count — never silently dropped.
   */
  excludedSegmentCount: number
}

/**
 * Resolves which storey of the ENGINEER-network model corresponds to the open
 * host floor: the host storey itself when the network came from the host file,
 * otherwise the aligned linked storey from the W4 mapping. Null when the open
 * floor has no counterpart in the engineer model (nothing to overlay).
 */
export function resolveEngineerStoreyId({
  engineerSourceFileName,
  hostFileName,
  selectedStoreyId,
  alignments,
}: {
  engineerSourceFileName: string
  hostFileName: string | null
  selectedStoreyId: StoreyId | null
  alignments: StoreyAlignment[]
}): StoreyId | null {
  if (selectedStoreyId === null) return null
  if (hostFileName !== null && engineerSourceFileName === hostFileName) return selectedStoreyId

  for (const alignment of alignments) {
    if (alignment.linkedFileName !== engineerSourceFileName || alignment.status !== 'aligned') continue
    const pair = alignment.pairs.find((candidate) => candidate.host.storeyId === selectedStoreyId)
    if (pair) return pair.linked.storeyId
  }
  return null
}

/** Endpoint sources whose coordinates live in the proven IFC source frame. */
export const DRAWABLE_ENGINEER_ENDPOINT_SOURCES: ReadonlySet<EngineerEndpointSource> = new Set<EngineerEndpointSource>([
  'extrusion-axis',
  'distribution-ports',
])

function isDrawableEndpointSource(source: EngineerEndpointSource | null): boolean {
  return source !== null && DRAWABLE_ENGINEER_ENDPOINT_SOURCES.has(source)
}

export function getEngineerOverlayPresentation({
  network,
  stacks,
  engineerStoreyId,
  frameOrigin,
  visible,
}: {
  network: EngineerPipeNetwork
  /** Sanitary stacks from `classifyEngineerRiserStacks(...).sanitaryStacks`. */
  stacks: EngineerRiserStack[]
  /** Storey of the engineer model matching the open floor (see resolver). */
  engineerStoreyId: StoreyId
  /** Host model-frame origin in viewer metres (W1 local frame). */
  frameOrigin: Point3D
  visible: boolean
}): EngineerOverlayPresentation {
  const hasNetwork = network.segments.length > 0
  if (!hasNetwork || !visible) {
    return { hasNetwork, visibleSegments: [], visibleStackMarkers: [], excludedSegmentCount: 0 }
  }

  const floorSegments = network.segments.filter((segment) => segment.storeyId === engineerStoreyId)

  const visibleSegments: EngineerOverlaySegment[] = []
  let excludedSegmentCount = 0
  for (const segment of floorSegments) {
    // Extrusion-axis and port-derived (V1b: Revit vertical pipes exported as a
    // cut face with full-length IfcDistributionPorts) endpoints are both in the
    // verified IFC source frame; the mesh-bounds fallback goes through web-ifc's
    // viewer transform instead and has no proven frame here, so those segments
    // are counted, not drawn.
    if (!isDrawableEndpointSource(segment.endpointSource) || segment.start === null || segment.end === null) {
      excludedSegmentCount += 1
      continue
    }
    const from = ifcSourceToViewerPoint(segment.start, network.metersPerSourceUnit)
    const to = ifcSourceToViewerPoint(segment.end, network.metersPerSourceUnit)
    visibleSegments.push({
      key: `engineer-segment-${segment.expressId}`,
      from: { x: from.x - frameOrigin.x, y: from.y - frameOrigin.y, z: from.z - frameOrigin.z },
      to: { x: to.x - frameOrigin.x, y: to.y - frameOrigin.y, z: to.z - frameOrigin.z },
      diameterMm: segment.outerDiameterMm,
      systemName: segment.systemName,
    })
  }

  const visibleStackMarkers = alignEngineerStacksToViewerPlan(stacks).map((stack) => ({
    key: stack.id,
    x: stack.xM - frameOrigin.x,
    z: stack.yM - frameOrigin.z,
    diameterMm: stack.diameterMm,
    storeyCount: stack.spannedStoreyIds.length,
  }))

  return { hasNetwork, visibleSegments, visibleStackMarkers, excludedSegmentCount }
}
