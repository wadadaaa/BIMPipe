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
