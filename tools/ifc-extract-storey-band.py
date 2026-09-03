#!/usr/bin/env python3
"""
Extract one building's selected storeys (a "storey band") from a large, possibly
federated IFC2X3 file into a small, standalone IFC2X3 file.

Usage:
  python3 tools/ifc-extract-storey-band.py <model.ifc> <out.ifc> \\
      --building <expressId|GlobalId> --storeys L10,L11,L12 \\
      [--index-cache DIR] [--exclude-types IFCGRID,IFCANNOTATION] [--no-styles] [--report out.json]

What is kept:
  - header, IfcProject, units, all geometric representation (sub)contexts, owner history
  - the selected building, its site, and the selected storeys (by Name)
  - every product contained in those storeys (IFCRELCONTAINEDINSPATIALSTRUCTURE), their
    aggregated parts (curtain wall members/plates, stair flights, ...), their openings
    (IFCRELVOIDSELEMENT) and fills (IFCRELFILLSELEMENT)
  - the full transitive closure of forward references (placements, representations, mapped
    items and representation maps, profiles, materials, property sets, type objects ...)
  - relationship entities re-attached to the selection: RelatedObjects lists are rewritten
    to the intersection with the selection, and dropped when empty

Express ids are preserved (STEP allows gaps). Nothing is renumbered.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ifc_spatial import build_spatial_tree, category_of  # noqa: E402
from ifc_step_index import (  # noqa: E402
    StepIndex,
    format_ref_list,
    join_entity,
    peak_rss_mb,
    ref_list,
    refs_of,
    split_entity,
)

# Relationship / inverse-only entities and how to re-attach them to a selection. Once a
# relationship is kept, everything it still references (property set, type, material,
# opening, port ...) is pulled into the selection by the normal forward closure.
#   ("intersect", list_attr): rewrite the list at list_attr to the selected ids; drop if empty.
#   ("intersect_if_relating", list_attr, relating_attr): same, but only when the single
#       entity at relating_attr is selected.
#   ("aggregates", relating_attr, list_attr): keep when the whole is selected. Under a
#       project/site/building only selected parts are kept (other buildings/storeys are cut);
#       under a storey/space/element all parts are pulled in (spaces, curtain wall members ...).
#   ("if_relating", relating_attr): keep when the entity at relating_attr is selected.
#   ("both", attr_a, attr_b): keep only when both referenced entities are selected.
#   ("styled_item", item_attr): keep when the styled representation item is selected.
REL_RULES: dict[str, tuple] = {
    "IFCRELCONTAINEDINSPATIALSTRUCTURE": ("intersect_if_relating", 4, 5),
    "IFCRELAGGREGATES": ("aggregates", 4, 5),
    "IFCRELDEFINESBYPROPERTIES": ("intersect", 4),
    "IFCRELDEFINESBYTYPE": ("intersect", 4),
    "IFCRELASSOCIATESMATERIAL": ("intersect", 4),
    "IFCRELASSOCIATESCLASSIFICATION": ("intersect", 4),
    "IFCRELASSOCIATESLIBRARY": ("intersect", 4),
    "IFCRELASSOCIATESDOCUMENT": ("intersect", 4),
    "IFCRELASSIGNSTOGROUP": ("intersect", 4),
    "IFCRELVOIDSELEMENT": ("if_relating", 4),
    "IFCRELFILLSELEMENT": ("both", 4, 5),
    "IFCRELCONNECTSPATHELEMENTS": ("both", 5, 6),
    "IFCRELCONNECTSELEMENTS": ("both", 5, 6),
    "IFCRELCOVERSBLDGELEMENTS": ("intersect_if_relating", 5, 4),
    "IFCRELCONNECTSPORTTOELEMENT": ("if_relating", 5),
    "IFCRELCONNECTSPORTS": ("both", 4, 5),
    "IFCRELSERVICESBUILDINGS": ("intersect_if_relating", 5, 4),
    "IFCRELSPACEBOUNDARY": ("both", 4, 5),
    "IFCPRESENTATIONLAYERASSIGNMENT": ("intersect", 2),
    "IFCPRESENTATIONLAYERWITHSTYLE": ("intersect", 2),
    "IFCSTYLEDITEM": ("styled_item", 0),
}
CUT_AGGREGATION_UNDER = {"IFCPROJECT", "IFCSITE", "IFCBUILDING"}
STYLE_RULE_TYPES = {"IFCSTYLEDITEM", "IFCPRESENTATIONLAYERASSIGNMENT", "IFCPRESENTATIONLAYERWITHSTYLE"}

ALWAYS_KEEP_TYPES = (
    "IFCPROJECT",
    "IFCGEOMETRICREPRESENTATIONCONTEXT",
    "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


class Selection:
    def __init__(self, idx: StepIndex):
        self.idx = idx
        self.flags = bytearray(len(idx.offsets))
        self.rewritten: dict[int, bytes] = {}
        self.count = 0
        self.dropped_rels = Counter()
        self.rewritten_rels = Counter()

    def has(self, eid: int) -> bool:
        return self.flags[eid] == 1

    def line(self, eid: int) -> bytes:
        return self.rewritten.get(eid) or self.idx.line(eid)

    def add_closure(self, roots) -> int:
        """Add roots and everything reachable through forward references. Returns #added."""
        stack = [r for r in roots if not self.flags[r]]
        added = 0
        flags = self.flags
        idx = self.idx
        while stack:
            eid = stack.pop()
            if flags[eid]:
                continue
            if not idx.has(eid):
                raise KeyError(f"dangling reference #{eid}")
            flags[eid] = 1
            added += 1
            for r in refs_of(self.line(eid)):
                if not flags[r]:
                    stack.append(r)
        self.count += added
        return added

    def ids(self):
        return (i for i, f in enumerate(self.flags) if f)


def apply_relationship_rules(sel: Selection, include_styles: bool) -> int:
    """One sweep over all relationship-like entities. Returns number of entities newly selected."""
    idx = sel.idx
    added = 0
    for tname, rule in REL_RULES.items():
        if not include_styles and tname in STYLE_RULE_TYPES:
            continue
        for rid in idx.ids_of(tname):
            if sel.has(rid):
                continue
            eid, tb, attrs = split_entity(idx.line(rid))
            kind = rule[0]
            roots: list[int] = []
            def intersect(list_attr: int) -> bool:
                related = ref_list(attrs[list_attr])
                keep = [r for r in related if sel.has(r)]
                if not keep:
                    return False
                if len(keep) != len(related):
                    attrs[list_attr] = format_ref_list(keep)
                    sel.rewritten[eid] = join_entity(eid, tb, attrs)
                    sel.rewritten_rels[tname] += 1
                return True

            if kind == "intersect":
                if intersect(rule[1]):
                    roots = [eid]
            elif kind == "intersect_if_relating":
                _, list_attr, relating_attr = rule
                relating = ref_list(attrs[relating_attr])
                if relating and sel.has(relating[0]) and intersect(list_attr):
                    roots = [eid]
            elif kind == "aggregates":
                _, relating_attr, list_attr = rule
                relating = ref_list(attrs[relating_attr])
                if not relating or not sel.has(relating[0]):
                    continue
                if idx.type_of(relating[0]) in CUT_AGGREGATION_UNDER:
                    if intersect(list_attr):
                        roots = [eid]
                else:
                    roots = [eid]
            elif kind == "if_relating":
                _, relating_attr = rule
                relating = ref_list(attrs[relating_attr])
                if relating and sel.has(relating[0]):
                    roots = [eid]
            elif kind == "both":
                _, a, b = rule
                ra, rb = ref_list(attrs[a]), ref_list(attrs[b])
                if ra and rb and sel.has(ra[0]) and sel.has(rb[0]):
                    roots = [eid]
            elif kind == "styled_item":
                item = ref_list(attrs[rule[1]])
                if item and sel.has(item[0]):
                    roots = [eid]
            if roots:
                added += sel.add_closure(roots)
    return added


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ifc", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--building", required=True, help="IFCBUILDING express id (#123) or GlobalId")
    ap.add_argument("--storeys", required=True, help="comma-separated storey Names to keep (e.g. L10,L11,L12)")
    ap.add_argument("--index-cache", type=Path, default=None)
    ap.add_argument("--exclude-types", default="", help="comma-separated product types to leave out")
    ap.add_argument("--no-styles", action="store_true", help="skip IfcStyledItem / layer assignments")
    ap.add_argument("--report", type=Path, default=None, help="write a JSON summary here")
    args = ap.parse_args()

    t0 = time.time()
    log(f"indexing {args.ifc} ...")
    idx = StepIndex.build_or_load(args.ifc, args.index_cache, log=log)
    t_index = time.time() - t0
    exclude = {t.strip().upper() for t in args.exclude_types.split(",") if t.strip()}
    wanted_names = [s.strip() for s in args.storeys.split(",") if s.strip()]

    with idx:
        tree = build_spatial_tree(idx)
        building = tree.find_building(args.building)
        storeys = tree.storeys_of(building.eid)
        by_name = {s.name: s for s in storeys}
        missing = [n for n in wanted_names if n not in by_name]
        if missing:
            raise SystemExit(f"storeys not found in building #{building.eid}: {missing}; "
                             f"available: {[s.name for s in storeys]}")
        chosen = [by_name[n] for n in wanted_names]
        site = tree.ancestor_of_type(building.eid, "IFCSITE")
        log(f"building #{building.eid} ({len(storeys)} storeys); keeping "
            + ", ".join(f"{s.name}@{s.elevation:.0f}" for s in chosen))

        sel = Selection(idx)
        roots = list(idx.ids_of(*ALWAYS_KEEP_TYPES)) + [building.eid] + ([site] if site else [])
        roots += [s.eid for s in chosen]
        chosen_ids = {s.eid for s in chosen}
        # spaces are aggregated under storeys (spatial decomposition), not "contained"
        spaces = [n.eid for n in tree.nodes.values()
                  if n.type_name == "IFCSPACE" and tree.ancestor_of_type(n.eid, "IFCBUILDINGSTOREY") in chosen_ids]
        roots += spaces
        products: list[int] = []
        excluded = Counter()
        for el, container in tree.container_of.items():
            if container in chosen_ids or tree.ancestor_of_type(container, "IFCBUILDINGSTOREY") in chosen_ids:
                t = idx.type_of(el) or "?"
                if t in exclude:
                    excluded[t] += 1
                    continue
                products.append(el)
                if container not in chosen_ids:
                    roots.append(container)  # e.g. a space hosting the element
        t1 = time.time()
        sel.add_closure(roots + products)
        log(f"  {len(products)} contained products, {len(spaces)} spaces; "
            f"closure so far {sel.count:,} entities ({time.time() - t1:.1f}s)")

        sweep = 0
        while True:
            sweep += 1
            added = apply_relationship_rules(sel, include_styles=not args.no_styles)
            log(f"  relationship sweep {sweep}: +{added:,} entities (total {sel.count:,})")
            if added == 0:
                break
            if sweep > 20:
                raise SystemExit("relationship closure did not converge")
        t_select = time.time() - t1

        # ---- verify every reference inside the selection resolves inside the selection
        t2 = time.time()
        dangling = 0
        type_counts: Counter = Counter()
        for eid in sel.ids():
            type_counts[idx.type_names[idx.type_codes[eid]]] += 1
            for r in refs_of(sel.line(eid)):
                if not sel.has(r):
                    dangling += 1
        if dangling:
            raise SystemExit(f"internal error: {dangling} dangling references in selection")

        # ---- write
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "wb") as out:
            out.write(idx.header_bytes())
            for eid in sel.ids():
                out.write(sel.line(eid))
            footer = idx.footer_bytes()
            out.write(footer if footer.endswith(b"\n") else footer + b"\n")
        t_write = time.time() - t2

    # per-storey element summary (contained + aggregated parts + openings), same rules as the census
    rows = {s.eid: {"expressId": s.eid, "name": s.name, "elevation": s.elevation, "globalId": s.guid,
                    "categories": Counter(), "types": Counter()} for s in chosen}
    for el in set(tree.container_of) | set(tree.aggregate_parent) | set(tree.voided_by):
        if el in tree.nodes or not sel.has(el):
            continue
        row = rows.get(tree.storey_of_element(el))
        if row is not None:
            t = idx.type_of(el) or "?"
            row["categories"][category_of(t)] += 1
            row["types"][t] += 1
    storey_summary = []
    for s in chosen:
        row = rows[s.eid]
        row["spaces"] = sum(1 for sp in spaces if tree.ancestor_of_type(sp, "IFCBUILDINGSTOREY") == s.eid)
        row["categories"] = dict(row["categories"].most_common())
        row["types"] = dict(row["types"].most_common())
        row["total"] = sum(row["types"].values())
        storey_summary.append(row)

    report = {
        "source": str(args.ifc),
        "output": str(args.out),
        "outputBytes": args.out.stat().st_size,
        "building": {"expressId": building.eid, "globalId": building.guid, "storeyCount": len(storeys)},
        "storeys": storey_summary,
        "containedProducts": len(products),
        "excludedProducts": dict(excluded),
        "entitiesWritten": sel.count,
        "entityTypes": dict(type_counts.most_common()),
        "rewrittenRelationships": dict(sel.rewritten_rels),
        "timing": {
            "indexSeconds": round(t_index, 1),
            "selectSeconds": round(t_select, 1),
            "writeSeconds": round(t_write, 1),
            "totalSeconds": round(time.time() - t0, 1),
            "peakRssMb": peak_rss_mb(),
        },
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    log(f"wrote {args.out} ({report['outputBytes'] / 1e6:.1f} MB, {sel.count:,} entities) "
        f"in {report['timing']['totalSeconds']}s, peak RSS {report['timing']['peakRssMb']:.0f} MB")
    for row in storey_summary:
        log(f"  {row['name']}@{row['elevation']:.0f}: {row['total']} elements {row['categories']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
