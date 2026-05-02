# Continuous Riser Per Stack

## 2026-04-29 continuous riser per stack

Behaviour: full IFC export now writes exactly one `IfcFlowSegment` (IFC2X3) / `IfcPipeSegment` (IFC4) per stack instead of one per `(stack, storey)`. For ADAM_10 with 7 stacks x 14 storeys this is a 98 -> 7 reduction.

Each segment has `Depth = top storey elevation - bottom storey elevation`, in source units. For ADAM_10 this is approximately 3260 cm.

Cause of previous behaviour: the export loop iterated per storey and wrote a fixed `RISER_HEIGHT_MM = 3000` mm extrusion at each step, producing 30 cm gaps between consecutive floor segments visible in Revit section views.

Files: 7 BIMPipe-named flow segments, 7 `IfcLocalPlacement`, 7 `IfcExtrudedAreaSolid`, and 21 `IfcCartesianPoint` entities are added by BIMPipe.

Manual Revit verification: TODO. Open the new IFC, cut Section 1 through any stack, confirm a single continuous pipe with an editable Length parameter that equals the top minus bottom storey elevation. Plan view of `קומה 2` must still show 7 risers at the same plan positions as image 12.
