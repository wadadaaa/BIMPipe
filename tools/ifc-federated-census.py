#!/usr/bin/env python3
"""
Census of a (possibly federated) IFC2X3 file: buildings, storeys, elevations and
per-storey element counts by category, computed by streaming the file once.

Usage:
  python3 tools/ifc-federated-census.py <model.ifc> --out <report-basename> [--index-cache DIR]

Writes <report-basename>.json and <report-basename>.txt.
The input may be huge (GBs); nothing but a compact index is held in memory.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ifc_spatial import CATEGORIES, build_spatial_tree, category_of, elements_by_container  # noqa: E402
from ifc_step_index import StepIndex, peak_rss_mb  # noqa: E402

SHORT = {
    "wall": "wall", "curtain_wall": "cwall", "slab": "slab", "column": "col", "beam": "beam",
    "opening": "open", "door": "door", "window": "win", "space": "space", "flow_terminal": "term",
    "flow_segment": "seg", "flow_fitting": "fit", "flow_controller": "ctrl", "furnishing": "furn",
    "member": "memb", "plate": "plate", "covering": "cover", "stair": "stair", "railing": "rail",
    "roof": "roof", "proxy": "proxy", "other": "other",
}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ifc", type=Path)
    ap.add_argument("--out", type=Path, required=True, help="report basename (writes .json and .txt)")
    ap.add_argument("--index-cache", type=Path, default=None, help="directory to cache the id/offset index")
    args = ap.parse_args()

    t0 = time.time()
    log(f"indexing {args.ifc} ...")
    idx = StepIndex.build_or_load(args.ifc, args.index_cache, log=log)
    t_index = time.time() - t0

    with idx:
        tree = build_spatial_tree(idx)
        by_container = elements_by_container(idx, tree)

        buildings_out = []
        for k, b in enumerate(tree.buildings(), start=1):
            storeys = tree.storeys_of(b.eid)
            site = tree.ancestor_of_type(b.eid, "IFCSITE")
            storeys_out = []
            for s in storeys:
                counts = {c: 0 for c in CATEGORIES}
                types: dict[str, int] = {}
                # elements contained in the storey itself or in spaces below it;
                # spaces themselves are spatial nodes aggregated under the storey
                for cid, node in tree.nodes.items():
                    if cid != s.eid and tree.ancestor_of_type(cid, "IFCBUILDINGSTOREY") != s.eid:
                        continue
                    if node.type_name == "IFCSPACE":
                        counts["space"] += 1
                        types["IFCSPACE"] = types.get("IFCSPACE", 0) + 1
                    for tname, ids in by_container.get(cid, {}).items():
                        counts[category_of(tname)] += len(ids)
                        types[tname] = types.get(tname, 0) + len(ids)
                storeys_out.append({
                    "expressId": s.eid,
                    "globalId": s.guid,
                    "name": s.name,
                    "elevation": s.elevation,
                    "total": sum(counts.values()),
                    "counts": counts,
                    "types": dict(sorted(types.items(), key=lambda kv: -kv[1])),
                })
            # elements contained directly in the building / site (no storey)
            unassigned: dict[str, int] = {}
            for cid in ([b.eid] + ([site] if site else [])):
                for tname, ids in by_container.get(cid, {}).items():
                    unassigned[tname] = unassigned.get(tname, 0) + len(ids)
            buildings_out.append({
                "label": f"building #{k} ({len(storeys)} storeys)",
                "expressId": b.eid,
                "globalId": b.guid,
                "name": b.name,
                "siteExpressId": site,
                "storeyCount": len(storeys),
                "elementTotal": sum(s["total"] for s in storeys_out) + sum(unassigned.values()),
                "storeys": storeys_out,
                "elementsWithoutStorey": unassigned,
            })

        no_container = {t: len(ids) for t, ids in by_container.get(0, {}).items()}

    elapsed = time.time() - t0
    report = {
        "source": {"path": str(args.ifc), "sizeBytes": args.ifc.stat().st_size, "entityCount": idx.entity_count},
        "totals": {
            "buildings": idx.count("IFCBUILDING"),
            "sites": idx.count("IFCSITE"),
            "storeys": idx.count("IFCBUILDINGSTOREY"),
            "typeHistogram": dict(sorted(((n, idx.count(n)) for n in idx.type_names), key=lambda kv: -kv[1])),
        },
        "buildings": buildings_out,
        "elementsWithoutResolvableContainer": no_container,
        "timing": {"indexSeconds": round(t_index, 1), "totalSeconds": round(elapsed, 1), "peakRssMb": peak_rss_mb()},
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Path(str(args.out) + ".json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    Path(str(args.out) + ".txt").write_text(render_text(report))
    log(f"done in {elapsed:.1f}s, peak RSS {report['timing']['peakRssMb']:.0f} MB -> {args.out}.json/.txt")
    print(render_text(report))
    return 0


def render_text(report: dict) -> str:
    lines = []
    tot = report["totals"]
    lines.append(f"entities={report['source']['entityCount']:,}  buildings={tot['buildings']}  sites={tot['sites']}  storeys={tot['storeys']}")
    cols = [c for c in CATEGORIES]
    header = f"{'storey':<12}{'elev':>9} " + " ".join(f"{SHORT[c]:>6}" for c in cols) + f" {'total':>7}"
    for b in report["buildings"]:
        lines.append("")
        lines.append(f"### {b['label']}  expressId=#{b['expressId']}  name={b['name']!r}  elements={b['elementTotal']:,}")
        lines.append(header)
        for s in b["storeys"]:
            elev = "" if s["elevation"] is None else f"{s['elevation']:.0f}"
            row = f"{s['name'][:12]:<12}{elev:>9} " + " ".join(f"{s['counts'][c]:>6}" for c in cols) + f" {s['total']:>7}"
            lines.append(row)
        if b["elementsWithoutStorey"]:
            lines.append(f"  (not in any storey: {b['elementsWithoutStorey']})")
    if report["elementsWithoutResolvableContainer"]:
        lines.append("")
        lines.append(f"elements without resolvable spatial container: {report['elementsWithoutResolvableContainer']}")
    t = report["timing"]
    lines.append("")
    lines.append(f"timing: index {t['indexSeconds']}s, total {t['totalSeconds']}s, peak RSS {t['peakRssMb']:.0f} MB")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
