## 2026-04-29 Revit IFC type inline Pset

Behaviour: `Pset_PipeSegmentTypeCommon` is now exposed in two ways for each
BIMPipe IFC2X3 pipe type: the existing `IfcRelDefinesByProperties` relation
is preserved, and the same property set is also referenced inline from
`IfcPipeSegmentType.HasPropertySets`.

Scope: this changes only metadata attachment for the BIMPipe-created
`IfcPipeSegmentType`. Geometry, placement, continuous per-stack extrusion,
Qto quantities, system assignment, and native Revit editability are unchanged.

Reason: Revit 2024 showed BIMPipe objects as visible pipe-category imports and
displayed IFC Parameters, but native engineering fields such as Outside
Diameter, Wall Thickness, Roughness, and Pipe Segment remained blank. Some IFC
importers read type property sets only from `HasPropertySets`, so this slice
tests that narrower path without changing the exporter strategy.

Manual Revit verification: pass in Revit 2024.3 on
`ADAM_10-2-full-no180-ifc2x3 (6)`. For R2, Edit Type -> IFC Parameters
surfaced type-level values from `Pset_PipeSegmentTypeCommon`; user also
confirmed the same values match for R1 and R3..R7:
- NominalDiameter / OuterDiameter = 11.00 cm
- InnerDiameter = 10.00 cm
- WallThickness = 0.50 cm
- Reference = R2
- Roughness appears as 0.00 cm because Revit rounds the stored value
  (0.0015 mm = 0.00015 cm) to two decimal places.

Known limitation: even if these values surface, imported IFC objects are still
not native editable Revit pipes; Length edits and endpoint grips remain outside
the IFC-import path.
