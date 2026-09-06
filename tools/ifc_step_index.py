"""
Streaming index for very large IFC-SPF (STEP Part 21) files.

Stdlib only. Never loads the whole file into memory: one sequential pass
records, per express id, the byte offset of its line and a small type code.
Entities are then read on demand through an mmap.

Assumptions (verified for Revit/ODA exports; the indexer aborts otherwise):
  - one entity per line, `#<id>=<TYPE>(...);`
  - the file is ASCII (non-ASCII text uses STEP \\X2\\ escapes)
"""

from __future__ import annotations

import json
import mmap
import os
import re
import sys
import time
from array import array
from pathlib import Path
from typing import Iterable

INDEX_FORMAT = 2

_STRING_RE = re.compile(rb"'(?:[^']|'')*'")
_REF_RE = re.compile(rb"#(\d+)")
_X2_RE = re.compile(r"\\X2\\([0-9A-F]+)\\X0\\")
_X_RE = re.compile(r"\\X\\([0-9A-F]{2})")


class StepIndex:
    """id -> (line offset, type code) plus per-type id lists."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.offsets = array("q")
        self.type_codes = array("H")
        self.type_names: list[str] = []
        self.ids_by_type: dict[str, array] = {}
        self.data_start = 0  # byte offset of the first line after `DATA;`
        self.data_end = 0  # byte offset of the trailing `ENDSEC;`
        self.entity_count = 0
        self._file = None
        self._mm: mmap.mmap | None = None

    # ------------------------------------------------------------------ build
    @classmethod
    def build(cls, path: Path, log=print) -> "StepIndex":
        idx = cls(path)
        size = os.path.getsize(path)
        t0 = time.time()
        # Pre-size for the typical ~55 bytes/entity; grows on demand.
        est = size // 40 + 1024
        offsets = array("q", bytes(8 * est))
        type_codes = array("H", bytes(2 * est))
        cap = est
        code_by_token: dict[bytes, int] = {}
        code_by_name: dict[str, int] = {}
        type_names: list[str] = []
        ids_by_code: list[array] = []
        count = 0
        offset = 0
        in_data = False
        data_start = 0
        data_end = 0
        last_report = t0
        with open(path, "rb") as f:
            for line in f:
                if line[:1] == b"#":
                    if not in_data:
                        raise ValueError("entity line before DATA section")
                    eq = line.index(b"=")
                    eid = int(line[1:eq])
                    lp = line.index(b"(", eq)
                    token = line[eq + 1 : lp]
                    code = code_by_token.get(token)
                    if code is None:
                        name = token.strip().decode("ascii")
                        code = code_by_name.get(name)
                        if code is None:
                            code = len(type_names)
                            if code >= 65535:
                                raise ValueError("too many entity types for uint16 codes")
                            type_names.append(name)
                            code_by_name[name] = code
                            ids_by_code.append(array("I"))
                        code_by_token[token] = code
                    if eid >= cap:
                        extra = max(eid + 1 - cap, cap // 4)
                        offsets.extend(array("q", bytes(8 * extra)))
                        type_codes.extend(array("H", bytes(2 * extra)))
                        cap += extra
                    if offsets[eid] != 0:
                        raise ValueError(f"duplicate express id #{eid}")
                    offsets[eid] = offset
                    type_codes[eid] = code
                    ids_by_code[code].append(eid)
                    count += 1
                    if (count & 0xFFFFF) == 0:
                        now = time.time()
                        if now - last_report > 5:
                            log(f"  indexed {count:,} entities ({offset * 100 // size}%)")
                            last_report = now
                else:
                    stripped = line.strip()
                    if stripped == b"DATA;":
                        in_data = True
                        data_start = offset + len(line)
                    elif stripped == b"ENDSEC;" and in_data:
                        data_end = offset
                        in_data = False
                offset += len(line)
        if data_end == 0:
            raise ValueError("no DATA ... ENDSEC section found")
        idx.offsets = offsets
        idx.type_codes = type_codes
        idx.type_names = type_names
        idx.ids_by_type = {type_names[c]: ids for c, ids in enumerate(ids_by_code)}
        idx.data_start = data_start
        idx.data_end = data_end
        idx.entity_count = count
        log(f"  index built: {count:,} entities, {len(type_names)} types, {time.time() - t0:.1f}s")
        return idx

    # ------------------------------------------------------------------ cache
    def save(self, cache_dir: Path) -> None:
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        with open(cache_dir / "offsets.q", "wb") as f:
            self.offsets.tofile(f)
        with open(cache_dir / "types.H", "wb") as f:
            self.type_codes.tofile(f)
        with open(cache_dir / "ids_by_type.I", "wb") as f:
            for name in self.type_names:
                self.ids_by_type[name].tofile(f)
        st = os.stat(self.path)
        meta = {
            "format": INDEX_FORMAT,
            "source_size": st.st_size,
            "source_mtime": st.st_mtime,
            "type_names": self.type_names,
            "type_counts": [len(self.ids_by_type[n]) for n in self.type_names],
            "data_start": self.data_start,
            "data_end": self.data_end,
            "entity_count": self.entity_count,
            "cap": len(self.offsets),
        }
        (cache_dir / "meta.json").write_text(json.dumps(meta))

    @classmethod
    def load(cls, path: Path, cache_dir: Path) -> "StepIndex | None":
        cache_dir = Path(cache_dir)
        meta_path = cache_dir / "meta.json"
        if not meta_path.exists():
            return None
        meta = json.loads(meta_path.read_text())
        st = os.stat(path)
        if (
            meta.get("format") != INDEX_FORMAT
            or meta["source_size"] != st.st_size
            or abs(meta["source_mtime"] - st.st_mtime) > 1e-6
        ):
            return None
        idx = cls(path)
        cap = meta["cap"]
        with open(cache_dir / "offsets.q", "rb") as f:
            idx.offsets.fromfile(f, cap)
        with open(cache_dir / "types.H", "rb") as f:
            idx.type_codes.fromfile(f, cap)
        idx.type_names = meta["type_names"]
        with open(cache_dir / "ids_by_type.I", "rb") as f:
            for name, n in zip(idx.type_names, meta["type_counts"]):
                a = array("I")
                if n:
                    a.fromfile(f, n)
                idx.ids_by_type[name] = a
        idx.data_start = meta["data_start"]
        idx.data_end = meta["data_end"]
        idx.entity_count = meta["entity_count"]
        return idx

    @classmethod
    def build_or_load(cls, path: Path, cache_dir: Path | None, log=print) -> "StepIndex":
        if cache_dir is not None:
            idx = cls.load(path, cache_dir)
            if idx is not None:
                log(f"  loaded cached index from {cache_dir} ({idx.entity_count:,} entities)")
                return idx
        idx = cls.build(path, log=log)
        if cache_dir is not None:
            idx.save(cache_dir)
            log(f"  index cached to {cache_dir}")
        return idx

    # ----------------------------------------------------------------- access
    def open(self) -> None:
        if self._mm is None:
            self._file = open(self.path, "rb")
            self._mm = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ)

    def close(self) -> None:
        if self._mm is not None:
            self._mm.close()
            self._mm = None
        if self._file is not None:
            self._file.close()
            self._file = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    def has(self, eid: int) -> bool:
        return 0 <= eid < len(self.offsets) and self.offsets[eid] != 0

    def type_of(self, eid: int) -> str | None:
        if not self.has(eid):
            return None
        return self.type_names[self.type_codes[eid]]

    def line(self, eid: int) -> bytes:
        """Raw entity line including the trailing newline."""
        assert self._mm is not None, "index not opened"
        off = self.offsets[eid]
        if off == 0:
            raise KeyError(f"#{eid} not in file")
        end = self._mm.find(b"\n", off)
        if end < 0:
            end = len(self._mm)
        return self._mm[off : end + 1]

    def ids_of(self, *type_names: str) -> Iterable[int]:
        for name in type_names:
            ids = self.ids_by_type.get(name)
            if ids:
                yield from ids

    def count(self, type_name: str) -> int:
        return len(self.ids_by_type.get(type_name, ()))

    def header_bytes(self) -> bytes:
        assert self._mm is not None
        return self._mm[: self.data_start]

    def footer_bytes(self) -> bytes:
        assert self._mm is not None
        return self._mm[self.data_end :]


# --------------------------------------------------------------------- parsing
def refs_of(line: bytes) -> list[int]:
    """All `#n` references in an entity line, ignoring the id itself and string contents."""
    eq = line.index(b"=")
    body = _STRING_RE.sub(b"''", line[eq + 1 :])
    return [int(m) for m in _REF_RE.findall(body)]


def split_entity(line: bytes) -> tuple[int, bytes, list[bytes]]:
    """Split `#id=TYPE(a,b,(c,d),'e');` into (id, TYPE, [top-level attribute bytes])."""
    eq = line.index(b"=")
    eid = int(line[1:eq])
    lp = line.index(b"(", eq)
    tname = line[eq + 1 : lp].strip()
    body = line.rstrip()
    if not body.endswith(b");"):
        raise ValueError(f"unterminated entity #{eid}")
    return eid, tname, split_attributes(body[lp + 1 : -2])


def split_attributes(body: bytes) -> list[bytes]:
    attrs: list[bytes] = []
    depth = 0
    in_str = False
    start = 0
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if in_str:
            if c == 0x27:  # '
                if i + 1 < n and body[i + 1] == 0x27:
                    i += 1
                else:
                    in_str = False
        elif c == 0x27:
            in_str = True
        elif c == 0x28:  # (
            depth += 1
        elif c == 0x29:  # )
            depth -= 1
        elif c == 0x2C and depth == 0:  # ,
            attrs.append(body[start:i])
            start = i + 1
        i += 1
    attrs.append(body[start:])
    return attrs


def join_entity(eid: int, tname: bytes, attrs: list[bytes]) -> bytes:
    return b"#%d=%s(%s);\n" % (eid, tname, b",".join(attrs))


def ref_list(attr: bytes) -> list[int]:
    """Parse `(#1,#2)` or `#1` or `$` into ids."""
    return [int(m) for m in _REF_RE.findall(attr)]


def format_ref_list(ids: Iterable[int]) -> bytes:
    return b"(" + b",".join(b"#%d" % i for i in ids) + b")"


def step_string(attr: bytes) -> str | None:
    """Decode a STEP string attribute (`'...'`) to text; `$` -> None."""
    s = attr.strip()
    if not (s.startswith(b"'") and s.endswith(b"'")):
        return None
    text = s[1:-1].replace(b"''", b"'").decode("ascii", "replace")
    text = _X2_RE.sub(lambda m: "".join(chr(int(m.group(1)[i : i + 4], 16)) for i in range(0, len(m.group(1)), 4)), text)
    text = _X_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
    return text


def step_float(attr: bytes) -> float | None:
    s = attr.strip()
    if s in (b"$", b"*", b""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def peak_rss_mb() -> float | None:
    try:
        import resource

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux kilobytes.
        return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
    except Exception:
        return None
