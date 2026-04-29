## 2026-04-29 Revit IFC download baseline

Baseline: the validated Revit IFC path is the full-source exporter,
`exportFullIfcWithRisersWithDebug`, not the old plumbing-only exporter.

Manual Revit result: `ADAM_10-2-full-no180-ifc2x3 (6)` opens in Revit 2024.3
with 7 visible BIMPipe risers. R1..R7 match the expected positions and their
Edit Type -> IFC Parameters expose the type-level pipe metadata from
`Pset_PipeSegmentTypeCommon` (diameters, wall thickness, roughness rounded by
Revit display precision, and stack Reference).

Download change: the Risers panel now exposes one IFC download action. It uses
the full-source exporter and downloads both the IFC and the riser-mapping JSON.
The old plumbing-only export path is no longer reachable from the workspace UI.

Known limitation: the exported objects are still imported IFC pipe-category
objects, not native editable Revit MEP pipes. Native endpoint grips and
geometry-changing Length edits remain outside the IFC-import path.
