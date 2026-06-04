# ADAM_10 sanitary demo readiness report (BIM-54)

This report validates the ADAM_10 sanitary routing demo after the grouped routing, IFC export, and UI polish work landed.

## Scope

Validated the PRD plumbing path only:

- Upload ADAM_10 IFC and open an included demo floor.
- Detect wet-area fixtures used by the sanitary demo flow.
- Select/place sanitary risers before routing.
- Preview grouped bathroom drainage routes in the 2D floor view.
- Export the selected-floor IFC and route/debug mapping.
- Document presentation limitations and fallback steps.

Out of scope: sprinklers, fire protection, production code-compliance review, and full-building routing certification.

## Latest validation evidence

- Screenshot smoke run: `/opt/bimpipe/.hermes/screenshots/BIM-54/20260604T154352Z/`
- Smoke report: `/opt/bimpipe/.hermes/screenshots/BIM-54/20260604T154352Z/report.md`
- Exported debug mapping: `/opt/bimpipe/.hermes/screenshots/BIM-54/20260604T154352Z/downloads/ADAM_10-2-full-riser-mapping.json`
- Exported IFC: `/opt/bimpipe/.hermes/screenshots/BIM-54/20260604T154352Z/downloads/ADAM_10-2-full.ifc`

Automated smoke checks passed for:

- ADAM_10 IFC loaded and floor opened.
- Seven toilets and seven risers visible in the demo flow.
- Five sanitary routes visible in preview/export UI.
- Place risers and Download IFC CTAs available without manual JSON/data editing.
- Before/After route preview available.
- 2.0% design slope labels visible.
- Ø110 and Ø50 pipe diameter labels visible.
- IFC and debug JSON downloads created.
- Debug evidence includes grouped route data, pipe diameters, slope, and export counts.
- No raw investor/debug/enum copy leaked into the product UI smoke path.

## PRD plumbing checklist

- **Riser justification:** toilet/wet-area detections are visible before riser placement and are used to drive the sanitary demo explanation.
- **Risers before routing:** the demo flow requires Place risers before the sanitary route preview and export state.
- **Toilets/WCs:** toilet route labels show Ø110 intent in the route preview.
- **Small fixtures:** small-fixture route labels show Ø50 branch intent where grouped fixture routing is visible.
- **Collection main:** grouped route debug evidence includes Ø63 main-line data where grouping requires it.
- **Vertical offsets and slope:** route preview labels include 2.0% design slope; debug/export evidence includes slope data.
- **Grouped drainage:** After mode shows local grouped bathroom drainage rather than a global cross-building trunk.
- **Branch geometry:** debug/export evidence includes 45-degree branch/join data where geometry allows.
- **Export parity:** the Download IFC action creates both IFC output and route/debug mapping for the same selected-floor route plan shown in preview.

## Demo-ready presentation path

1. Open `/app` with demo mode enabled.
2. Upload `/opt/bimpipe/.hermes/demo-assets/ADAM_10/ADAM_10.ifc`.
3. Wait until the included default floor opens and the viewer reports ready.
4. Open **Toilets** and confirm the seven detected toilets.
5. Click **Place risers**.
6. Open **Risers** and confirm seven risers, five sanitary routes, and **Download IFC** readiness.
7. Toggle **Before** and **After** to show the route overlay appearing on the same floor.
8. Use **Download IFC** only after the route preview is visible.

## Known limitations

- The demo validates the investor-facing ADAM_10 scenario, not a full-building or production code-compliance review.
- Route labels are presentation aids; final engineering deliverables still require discipline-specific review in the downstream BIM/Revit workflow.
- Branch-angle and grouped-route details are strongest in the debug/export evidence; not every geometric detail is exposed as text in the UI overlay.
- The exported IFC/debug evidence is scoped to the selected-floor route plan currently shown in preview, by design, to avoid preview/export drift.
- Large IFC parsing remains browser-local and may require a few moments before the floor-open state is ready.

## Fallback steps for the live demo

- If the dev server does not print readiness logs, verify `http://127.0.0.1:5173/app` directly; Vite may still be serving the app.
- If the route overlay is not visible, open **Toilets**, click **Place risers**, then switch back to **After** mode.
- If export is not available, confirm risers have been selected and the **Risers** panel says the sanitary route preview is ready for IFC export.
- If ADAM_10 fails to parse during the presentation, use the latest screenshot set in `/opt/bimpipe/.hermes/screenshots/BIM-54/20260604T154352Z/` as the prepared fallback walkthrough.

## Verdict

BIM-54 is demo-ready for the ADAM_10 sanitary routing investor walkthrough, with the limitations above documented and no sprinkler/fire/protection scope touched.
