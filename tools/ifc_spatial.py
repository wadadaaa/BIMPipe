"""
Spatial structure (project -> site -> building -> storey) and element containment
recovered from an indexed IFC2X3 file, without loading it fully.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ifc_step_index import StepIndex, ref_list, split_entity, step_float, step_string

SPATIAL_TYPES = ("IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE")

# Category used in the census; the first match wins.
CATEGORY_OF_TYPE = {
    "IFCWALL": "wall",
    "IFCWALLSTANDARDCASE": "wall",
    "IFCCURTAINWALL": "curtain_wall",
    "IFCSLAB": "slab",
    "IFCCOLUMN": "column",
    "IFCBEAM": "beam",
    "IFCOPENINGELEMENT": "opening",
    "IFCDOOR": "door",
    "IFCWINDOW": "window",
    "IFCSPACE": "space",
    "IFCFLOWTERMINAL": "flow_terminal",
    "IFCFLOWSEGMENT": "flow_segment",
    "IFCFLOWFITTING": "flow_fitting",
    "IFCFLOWCONTROLLER": "flow_controller",
    "IFCFURNISHINGELEMENT": "furnishing",
    "IFCMEMBER": "member",
    "IFCPLATE": "plate",
    "IFCCOVERING": "covering",
    "IFCSTAIR": "stair",
    "IFCSTAIRFLIGHT": "stair",
    "IFCRAILING": "railing",
    "IFCROOF": "roof",
    "IFCBUILDINGELEMENTPROXY": "proxy",
}
CATEGORIES = [
    "wall", "curtain_wall", "slab", "column", "beam", "opening", "door", "window", "space",
    "flow_terminal", "flow_segment", "flow_fitting", "flow_controller", "furnishing",
    "member", "plate", "covering", "stair", "railing", "roof", "proxy", "other",
]


def category_of(type_name: str) -> str:
    return CATEGORY_OF_TYPE.get(type_name, "other")


@dataclass
class SpatialNode:
    eid: int
    type_name: str
    guid: str
    name: str
    elevation: float | None = None
    parent: int | None = None
    children: list[int] = field(default_factory=list)


@dataclass
class SpatialTree:
    nodes: dict[int, SpatialNode]
    project: int | None
    # element id -> storey (or other spatial) id, via IFCRELCONTAINEDINSPATIALSTRUCTURE
    container_of: dict[int, int]
    # child element -> parent element via IFCRELAGGREGATES (non-spatial parents only)
    aggregate_parent: dict[int, int]
    # opening -> voided element via IFCRELVOIDSELEMENT
    voided_by: dict[int, int]

    def buildings(self) -> list[SpatialNode]:
        return sorted((n for n in self.nodes.values() if n.type_name == "IFCBUILDING"), key=lambda n: n.eid)

    def storeys_of(self, building_eid: int) -> list[SpatialNode]:
        out = [self.nodes[c] for c in self.nodes[building_eid].children if self.nodes[c].type_name == "IFCBUILDINGSTOREY"]
        return sorted(out, key=lambda s: (s.elevation if s.elevation is not None else float("inf"), s.eid))

    def ancestor_of_type(self, eid: int, type_name: str) -> int | None:
        seen = 0
        cur = self.nodes.get(eid)
        while cur is not None and seen < 16:
            if cur.type_name == type_name:
                return cur.eid
            cur = self.nodes.get(cur.parent) if cur.parent is not None else None
            seen += 1
        return None

    def container_of_element(self, eid: int) -> int | None:
        """Spatial element that hosts an element, directly or through its aggregation parent /
        the element it voids. Returns any spatial type (storey, building, site, space)."""
        cur = eid
        for _ in range(16):
            c = self.container_of.get(cur)
            if c is not None:
                return c
            nxt = self.aggregate_parent.get(cur)
            if nxt is None:
                nxt = self.voided_by.get(cur)
            if nxt is None:
                return None
            cur = nxt
        return None

    def storey_of_element(self, eid: int) -> int | None:
        c = self.container_of_element(eid)
        if c is None:
            return None
        return self.ancestor_of_type(c, "IFCBUILDINGSTOREY")

    def find_building(self, selector: str) -> SpatialNode:
        """Selector: express id (`#123` or `123`) or GlobalId."""
        s = selector.strip()
        if s.startswith("#"):
            s = s[1:]
        if s.isdigit() and int(s) in self.nodes and self.nodes[int(s)].type_name == "IFCBUILDING":
            return self.nodes[int(s)]
        matches = [n for n in self.buildings() if n.guid == selector]
        if len(matches) == 1:
            return matches[0]
        raise SystemExit(f"building selector {selector!r} did not match exactly one IFCBUILDING "
                         f"(candidates: {', '.join('#%d' % b.eid for b in self.buildings())})")


def build_spatial_tree(idx: StepIndex) -> SpatialTree:
    nodes: dict[int, SpatialNode] = {}
    project = None
    for eid in idx.ids_of(*SPATIAL_TYPES):
        _, tname, attrs = split_entity(idx.line(eid))
        t = tname.decode("ascii")
        guid = step_string(attrs[0]) or ""
        name = step_string(attrs[2]) or ""
        elev = step_float(attrs[9]) if t == "IFCBUILDINGSTOREY" and len(attrs) > 9 else None
        nodes[eid] = SpatialNode(eid, t, guid, name, elev)
        if t == "IFCPROJECT":
            project = eid

    aggregate_parent: dict[int, int] = {}
    for eid in idx.ids_of("IFCRELAGGREGATES"):
        _, _, attrs = split_entity(idx.line(eid))
        relating = ref_list(attrs[4])
        related = ref_list(attrs[5])
        if not relating:
            continue
        parent = relating[0]
        for child in related:
            if child in nodes and parent in nodes:
                nodes[child].parent = parent
                nodes[parent].children.append(child)
            elif child not in nodes:
                aggregate_parent[child] = parent

    container_of: dict[int, int] = {}
    for eid in idx.ids_of("IFCRELCONTAINEDINSPATIALSTRUCTURE"):
        _, _, attrs = split_entity(idx.line(eid))
        structure = ref_list(attrs[5])
        if not structure:
            continue
        for el in ref_list(attrs[4]):
            container_of[el] = structure[0]

    voided_by: dict[int, int] = {}
    for eid in idx.ids_of("IFCRELVOIDSELEMENT"):
        _, _, attrs = split_entity(idx.line(eid))
        relating = ref_list(attrs[4])
        related = ref_list(attrs[5])
        if relating and related:
            voided_by[related[0]] = relating[0]

    return SpatialTree(nodes, project, container_of, aggregate_parent, voided_by)


def elements_by_container(idx: StepIndex, tree: SpatialTree) -> dict[int, dict[str, list[int]]]:
    """spatial container id -> type name -> element ids.

    Covers direct containment, aggregated parts (e.g. curtain wall members) and openings,
    which inherit the container of their parent / voided element. Elements with no
    resolvable container are grouped under key 0.
    """
    out: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    candidates = set(tree.container_of) | set(tree.aggregate_parent) | set(tree.voided_by)
    for eid in candidates:
        if eid in tree.nodes:
            continue
        container = tree.container_of_element(eid) or 0
        out[container][idx.type_of(eid) or "?"].append(eid)
    return out
