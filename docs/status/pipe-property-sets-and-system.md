# Pipe Property Sets And System

## 2026-04-29 pipe property sets and sanitary system

Behaviour: each BIMPipe riser now carries `Pset_PipeSegmentTypeCommon` on its `IfcPipeSegmentType` for IFC2X3 and `Pset_FlowSegmentOccurrence` on the `IfcFlowSegment` / `IfcPipeSegment`. The type pset writes nominal, outer, inner diameter, wall thickness, roughness, and stack reference.

All BIMPipe risers are grouped into one new `IfcSystem` named `BIMPipe Sanitary Stacks` with `ObjectType="SANITARY"`, serviced by the model's `IfcBuilding` through `IfcRelServicesBuildings`.

Counts on the ADAM_10 re-run (deltas vs. pre-slice):
- +7 `Pset_PipeSegmentTypeCommon`
- +7 `Pset_FlowSegmentOccurrence`
- +14 `IfcRelDefinesByProperties` (7 type + 7 occurrence)
- +1 `IfcSystem`, +1 `IfcRelAssignsToGroup`, +1 `IfcRelServicesBuildings`

IFC4 path note: only the occurrence-level pset is written for IFC4 because this exporter does not currently create an `IfcPipeSegmentType` on that path. Type-level enrichment for IFC4 is a follow-up.

Manual Revit verification: TODO. Open the new IFC, select R1..R7, document which side-panel fields populated:
- System Classification: __
- System Type / Name: __
- Pipe Segment: __
- Outside Diameter: __
- Inside Diameter: __
- Wall Thickness: __
- Roughness: __
- Material: __

Fields that remain blank go on the follow-up list; this slice's contract is the IFC content listed in the counts table above.
