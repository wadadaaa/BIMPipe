# ADAM_10 investor demo

## Demo model

- Canonical demo IFC input: `ADAM_10.ifc`
- IFC schema: `IFC2X3`
- Export source: Autodesk Revit 2024
- The IFC is a large external demo asset and is not committed to Git history by default.

## Local asset placement

1. Obtain `ADAM_10.ifc` from the approved demo asset source.
2. Place it at:

```text
external/demo-assets/ADAM_10.ifc
```

> Do not commit `ADAM_10.ifc` directly unless Git LFS is already configured and intentionally used.

## Demo scope

Source of truth for demo-mode floor filtering is `demo/adam-10/demo.config.json`.

- Included floors: `קומת קרקע`, `קומה 1`, `קומה 2`
- Excluded floors: `-2.5`, `-2 מרתף`, `-1 מרתף`, `גג`, `גג עליון`
- Riser/shaft workflow is constrained by this scope in demo mode.

## Prepared routing baseline

The canonical ADAM_10 demo-prep baseline is documented in:

- `demo/adam-10/demo-baseline.json`

`demo-baseline.json` documents human-readable expectations, while `demo.config.json` remains the executable scope source of truth used by demo mode.

This baseline keeps the live investor flow focused and explainable:

1. upload and parse confirmation,
2. fixture detection visibility,
3. riser suggestion + one manual override,
4. export readiness check (ready vs blocked).

## Run the demo

```bash
pnpm demo:adam10
```

> Note: the script currently uses POSIX-style inline env vars and may require adaptation for Windows shells.

This command enables:

- `DEMO_MODE=true`
- `DEMO_CONFIG=demo/adam-10/demo.config.json`

If the config file or model asset is missing, the app fails fast with a clear actionable message.
