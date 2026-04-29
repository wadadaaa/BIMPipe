# Revit IFC Visibility Metadata

## 2026-04-29

Behaviour: each exported BIMPipe riser now carries `Qto_PipeSegmentBaseQuantities` via `IfcElementQuantity`, with `NetLength` and `GrossLength` both set to the riser extrusion length in source IFC units.

Scope: this slice only enriches IFC metadata for Revit/import consumers. It does not change geometry, placement, type records, system assignment, IFC schema, or native Revit pipe editability.

ADAM_10 expected deltas after re-run:
- +7 `IfcElementQuantity`
- +14 `IfcQuantityLength`
- +7 quantity `IfcRelDefinesByProperties`

Manual Revit verification: TODO. Open the regenerated IFC, select R1..R7, and check whether Revit's `IFC Quantities` panel shows `NetLength` and `GrossLength`. Confirm geometry and placement remain unchanged from the continuous-riser baseline.

Known limitation: these quantities are informational metadata. Editing Revit-displayed length/quantity fields is not expected to drive geometry through the IFC import path.
