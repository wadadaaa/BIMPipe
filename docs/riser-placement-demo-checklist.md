# Riser placement demo checklist (BIM-14)

Use this checklist when presenting the current demo slice.

## Demo flow

1. Upload the agreed demo IFC model.
2. Open a representative standard floor.
3. Confirm toilets are detected in **Toilets** tab.
4. Click **Suggest risers** and confirm riser pins render in viewer.
5. Open **Risers** tab and confirm generated stack labels are shown.
6. Open **Decisions** tab and verify summary counts:
   - processed vs skipped floors
   - floor classifications
   - newly added riser count
   - reused riser group count
   - coordination/validation warnings
7. Download IFC and debug JSON.
8. Confirm debug JSON includes `validationReport` plus existing mapping fields.

## Scenario expectations to verify

- Typical floors generate new risers.
- Basement and roof floors are excluded from new riser generation.
- Penthouse floors are analyzed but excluded from automatic new riser generation.
- Shifted WC/non-standard layouts produce warnings instead of duplicate/unsafe automatic placement.
- Existing riser reuse is reported via decision metadata (`reusedRiserGroups` / `existingRisers`) when available.

## Known limitations

- Placement decision details may be unavailable in the current UI flow for some runs; the Decisions panel and `validationReport.validationIssues` explicitly call this out.
- Manual IFC validation still requires the external agreed demo model file (no large IFC fixture is committed in repo).
