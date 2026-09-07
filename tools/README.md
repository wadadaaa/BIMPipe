# tools/

Offline, stdlib-only Python 3.9+ helpers for working with IFC files that are far too
large to open in the browser or in web-ifc (multi-GB federated exports). They stream
the STEP text and never load the whole file into memory; the only in-memory structure
is a compact `express id -> (byte offset, type code)` index (~30 bytes per entity).

These scripts are development tooling, not part of the app bundle: `tools/` is outside
`src/`, is not referenced by `tsconfig*.json`, and contains no TS/JS, so `pnpm lint`,
`pnpm build` and `pnpm test` are unaffected.

Outputs derived from project models belong under the gitignored `external/` (or
`/tmp`) and are never committed or shipped. Do not put project, client or people
names into these scripts or into this README.

## `ifc-federated-census.py`

Recovers the spatial structure of a (federated) IFC2X3 file and counts elements per
storey, by category, without loading it:

```sh
python3 tools/ifc-federated-census.py /path/to/model.ifc \
    --out /tmp/model-census --index-cache /tmp/model-index
```

Writes `/tmp/model-census.json` and `/tmp/model-census.txt`:

- every `IfcBuilding` (labelled `building #k (N storeys)`), its site and express id
- every `IfcBuildingStorey` with elevation (in the file's own length unit) and counts
  of walls, curtain walls, slabs, columns, beams, openings, doors, windows, spaces,
  flow terminals/segments/fittings/controllers, furnishing, members, plates,
  coverings, stairs, railings, roofs, proxies and other elements
- elements that are not assigned to any storey (per building, and globally)
- the global entity type histogram and timing / peak RSS

Containment is resolved through `IfcRelContainedInSpatialStructure`; aggregated parts
(`IfcRelAggregates`, e.g. curtain wall members) and openings (`IfcRelVoidsElement`)
inherit the storey of their parent / voided element; spaces are read from the
spatial decomposition. Use the output to pick the building and storeys to extract.

`--index-cache DIR` stores the index on disk (~10 bytes/entity) so a second script run
on the same file skips the indexing pass. The cache is invalidated when the source
file size or mtime changes.

## `ifc-extract-storey-band.py`

Cuts one building's selected storeys out of a large file into a small, standalone,
openable IFC2X3 file with original express ids:

```sh
python3 tools/ifc-extract-storey-band.py /path/to/model.ifc /path/to/out-band.ifc \
    --building '#1234' --storeys L10,L11,L12 \
    --index-cache /tmp/model-index --report /tmp/out-band.report.json
```

- `--building` takes the express id (`#123` or `123`) or the GlobalId of the
  `IfcBuilding`; `--storeys` takes the storey `Name`s to keep.
- Kept: header, `IfcProject`, units, all representation contexts, owner history, the
  building and its site, the selected storeys and their spaces, every product
  contained in them plus aggregated parts, openings and fills, and the transitive
  closure of everything they reference (placements, representations, mapped items and
  representation maps, profiles, materials, styles, property sets, type objects).
- Relationship entities are re-attached to the selection: `RelatedObjects` lists are
  rewritten to the intersection with the selection and dropped when empty; pairwise
  relationships are kept only when both sides are selected.
- `--exclude-types IFCGRID,IFCANNOTATION` leaves out product types; `--no-styles`
  drops `IfcStyledItem` / layer assignments to make the file smaller.
- The script aborts if any reference in the output would dangle.

The `--report` JSON lists per-storey element counts (comparable with the census),
entity type counts, rewritten relationships, timing and peak RSS.

Validate the result by opening it with web-ifc (Node) and streaming all meshes; see
`src/shared/ifc/*.gated.test.ts` for how the repo opens files with `IfcAPI`.

## Shared modules

- `ifc_step_index.py` – streaming indexer, mmap line access, attribute splitting,
  reference extraction, STEP string decoding.
- `ifc_spatial.py` – project/site/building/storey tree, containment, aggregation and
  opening resolution, census categories.

## `gauntlet/export-floor-models.ts`

Node-side exporter for the drawing A/B: writes both sides of one floor as
`FloorDrawingModel` JSON (`src/domain/drawing/floorDrawingModel.ts`) plus the
comparison-metrics input.

```sh
node tools/gauntlet/export-floor-models.ts --list
node tools/gauntlet/export-floor-models.ts --floor 096-01
node tools/gauntlet/export-floor-models.ts --spec /tmp/my-floor.json --out /tmp/gauntlet
```

Writes `<out>/<floor>/engineer.json`, `ours.json`, `metrics-input.json`,
`metrics.json` (hard metrics + verdict, `src/domain/gauntletMetrics.ts`) and
`summary.json`; the default `--out` is `external/gauntlet/models` (gitignored — the
output is client-derived geometry and must stay there).

- Runs on Node ≥ 22.18 (native type stripping); needs no build step.
- The repo has no `tsx`/`vite-node`, so the script spawns vitest on
  `src/shared/drawing/gauntletExport.gated.test.ts` with `GAUNTLET_EXPORT=1` and
  passes the floor/spec/out through `GAUNTLET_EXPORT_FLOOR` / `GAUNTLET_EXPORT_SPEC` /
  `GAUNTLET_EXPORT_OUT`. That test file is skipped in a normal `pnpm test`.
- "Ours" comes from the same code path the app uses
  (`src/shared/drawing/gauntletFloorPipeline.ts`: alignment → merged fixtures →
  continuity map → wet-core stacks → fixture assignment → branch routes).
- Spec shape (`gauntletFloorSpecSchema`): `floor`, `host {path, fileName}`,
  `linked [...]`, `storey {name | elevationSource}`, `storeyLabel`, optional
  `typology` (`residential | office` — applied as the app does: `wetCore.typology`
  at suggest time, then the suggestion's typology and fixture rows drive assignment
  and routing) and `wholeBuildingExtent`. Built-in keys: `096-01`, `shbj-L04`.

## `gauntlet/run-round.ts`, `gauntlet/tally-round.ts`, `gauntlet/CRITIC.md`

One gauntlet round: export both sides → hard metrics → anonymized renders → blind
A/B pairs; then tally the critic replies.

```sh
node tools/gauntlet/run-round.ts --round 00                       # both floors, 10 trials each
node tools/gauntlet/run-round.ts --round 03 --floors F2 --trials 10 --seed 42
node tools/gauntlet/run-round.ts --round 00 --force-trials        # pairs even on red metrics
node tools/gauntlet/tally-round.ts --round 00                     # after the critics answered
```

- Floor codes `F1` (residential storey, spec `096-01`) and `F2` (office storey, spec
  `shbj-L04`) are the only names a critic ever sees in a path.
- Writes `external/gauntlet/rounds/NN/<F>/`: `models/` (the export), `metrics.json`
  (`computeGauntletMetrics` — obstruction, stacks ratio, mean distance to the
  engineer's stacks, branch-length ratio on the fixtures both sides serve (gated;
  the full-set ratios on the drawn union set and the literal band are reported
  alongside), coverage counts, routed fraction, verdict + reds; `models/summary.json`
  adds the shared-set sensitivity at 0.75 / 1.0 / 1.5 m, each with the WC diameter rule
  on and off), `engineer.png` / `ours.png` (`render-drawing.mjs --anonymize`, same
  scale/dpi), `verdict.json`, `key.json` (which side is ours — hidden, outside the trial
  folders), `prompts.json` (exact critic prompt per trial) and `trial-<t>/A.png, B.png`
  in a seeded random order (mulberry32; default seed derived from the round number).
- A red metric writes `verdict.json = { result: 'loss', reason }` and no trial folders;
  `--force-trials` writes them anyway (verdict unchanged) so the gap can still be named.
- Diagnostic shared-set variant (round 3): when the two sides serve different fixture
  populations (`fixturesOnlyEngineerServes + fixturesOnlyWeServe > 0`), the round also
  writes `rounds/NN/<F>S/` — both sheets restricted to the fixtures both sides serve
  (`src/shared/drawing/sharedFixtureVariant.ts` → `restrictFloorDrawingToFixtures`:
  ours keeps the route segments carrying ≥ 1 shared fixture and the stacks they still
  reach; the engineer's runs are unchanged; unshared fixture symbols leave both
  sheets), with its own renders, seeded trial pairs and `verdict.json = { result:
  'diagnostic' }`. It is tallied like a floor but never gated — the `<F>` pair is the
  round's result; the variant only tells whether the unserved fixtures drove the critics.
  The export step writes the restricted models as `engineer.shared.json` /
  `ours.shared.json` (+ `summary.json.sharedVariant`) on every floor.
- `tally-round.ts` parses `critic/trial-<t>.txt` (WINNER / CONFIDENCE / GAP), maps
  sides through `key.json`, writes `verdicts.json` and `summary.json` (engineer
  preferred x/N, confidence spread, gap histogram, `gapToFixNext`); variant folders
  are labelled "diagnostic, not gated" in its output.
- The critic protocol (fresh-context agent per trial, exact prompt, what never enters a
  prompt) is in `gauntlet/CRITIC.md`.
- Runs on Node ≥ 22.18; imports nothing from `src/` (delegates to
  `export-floor-models.ts` and `render-drawing.mjs`). Everything it writes is
  client-derived and stays under the gitignored `external/`.

## `render-drawing.mjs`

Renders a `FloorDrawingModel` JSON (the renderer contract in
`src/domain/drawing/floorDrawingModel.ts`) to an SVG sheet in the reference graphic
language, and optionally to PNG, with the same renderer the app's "Drawing preview"
button uses:

```sh
node tools/render-drawing.mjs external/gauntlet/models/<floor>/ours.json /tmp/ours.svg \
    --png /tmp/ours.png --anonymize
node tools/render-drawing.mjs synthetic:toilet-block /tmp/synthetic.svg --png /tmp/synthetic.png
```

- Options: `--png <out.png>`, `--anonymize` (drops the title strip), `--scale 50|100`
  (default 100), `--dpi N` (default 220, the raster density of the reference rasters),
  `--no-underlay`.
- `<model.json>` may be `synthetic:toilet-block` or `synthetic:mini` to render the
  built-in synthetic models (`src/domain/drawing/syntheticFloorModels.ts`).
- No build step: the TypeScript sources are loaded through Vite's SSR module loader
  (`createServer` + `ssrLoadModule`, Vite is already a devDependency), so the `@/`
  alias resolves. PNG rasterisation uses the `@resvg/resvg-js` devDependency
  (`src/domain/drawing/renderFloorDrawingPng.ts`, Node-only; the app bundle only
  imports the SVG renderer).
- Renders of client-derived models belong under `external/` or `/tmp`.
