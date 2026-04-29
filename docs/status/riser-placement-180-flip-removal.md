# Riser Placement 180 Flip Removal

## Date

2026-04-28

## References

- Before: `/Users/wadadaaa/Downloads/ADAM_10-2-full-riser-mapping (1).json`
- After: `experiments/ifc-riser-lab/output/ADAM_10-2-full-no180-riser-mapping.json`

## Summary

The exporter now writes the BIMPipe web plan position verbatim into the existing export path before the already-validated axis swap and storey-chain inverse. The axis swap remains correct, chain rotation is preserved, and the 180-degree point reflection through the floor bounds center was the sole placement-mismatch cause removed in this slice.

## Known Follow-Ups

- Risers can extrude above the roof because `RISER_HEIGHT_MM` is still fixed at 3000 mm.

## Manual Revit Verification

TODO:

1. Open `experiments/ifc-riser-lab/output/ADAM_10-2-full-no180-ifc2x3.ifc` in Revit.
2. Navigate to the `"קומה 2"` floor plan.
3. Compare R1..R7 against image 11.
4. Confirm each riser is visible/selectable.
5. Confirm placement tolerance is <= 50 mm.
6. Record import warnings/errors and screenshots before claiming Revit success.

## 2026-04-28 driver clean-source fix

Cause: the previous driver run fell back to `ADAM_10-2-full (1).ifc`, which already had 98 BIMPipe segments from the 180-degree flipped export; the new run added another 98, so Revit showed 196 total with both correct and ghost positions.

Fix: the driver fallback now points at `/Users/wadadaaa/Downloads/ADAM_10-passthrough.ifc` (verified clean: 0 BIMPipe segments) and aborts if the selected source bytes already contain the literal `BIMPipe` substring.

Re-run result: `ADAM_10-2-full-no180-ifc2x3.ifc` contains exactly 98 BIMPipe-named flow segments, 14 per stack across R1..R7, and the debug JSON has 98 records.

Manual Revit verification remains TODO: open the new IFC, navigate to Floor Plan `"קומה 2"`, and compare against the BIMPipe UI placements from image 12 with tolerance <= 50 mm.
