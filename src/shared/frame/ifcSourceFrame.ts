import type { Point3D } from '@/shared/routes/planGeometry'
import type { EngineerPoint3, EngineerRiserStack } from '@/domain/engineerPipes'

/**
 * Conversion between the IFC SOURCE frame and the viewer SOURCE frame (W7).
 *
 * Two "source" frames exist in the app and they differ in axes AND units:
 *
 * - IFC source frame: the model's own project coordinates as written in the
 *   file — Z-up, in the model's declared length unit (096 is centimetres).
 *   Engineer pipe endpoints from `extractEngineerPipeNetwork` (extrusion-axis
 *   path) live here.
 * - Viewer source frame: web-ifc-normalized geometry — metres, Y-up, with
 *   IFC X→x, IFC Z (elevation)→y, IFC Y (north)→−z. Fixture positions, riser
 *   positions, and `FloorMeshes.sourceBoundingBox` live here (BEFORE the W1
 *   local-origin subtraction).
 *
 * The z = −(IFC Y) sign is the same convention the full exporter writes back
 * (`-position.z * sourceUnitsPerViewerUnit` for the IFC Y coordinate) and is
 * proven empirically against the real 096-P model in
 * `src/shared/ifc/engineerPlanFrame.096.test.ts`: engineer riser stacks
 * converted through this helper land next to the storey-01 toilets, while the
 * flipped sign puts them ~1,300 km away.
 */
export function ifcSourceToViewerPoint(
  point: EngineerPoint3,
  metersPerSourceUnit: number,
): Point3D {
  return {
    x: point.x * metersPerSourceUnit,
    y: point.z * metersPerSourceUnit,
    z: -point.y * metersPerSourceUnit,
  }
}

/**
 * Aligns engineer riser stacks (plan xM/yM in IFC source metres, yM = IFC Y)
 * to the viewer plan frame so they are directly comparable with our riser
 * positions in `computeEngineerComparison`: viewer plan is (x, z) with
 * z = −(IFC Y), and that module reads `yM` as the second plan axis.
 * Only the sign of `yM` changes; units are already metres.
 */
export function alignEngineerStacksToViewerPlan(
  stacks: EngineerRiserStack[],
): EngineerRiserStack[] {
  return stacks.map((stack) => ({ ...stack, yM: -stack.yM }))
}
