"""Which raw files the pipeline uses: one file per distinct MD5, minus files excluded in source_config.json.

Selection is by content hash, so it is unaffected by renames or by duplicates still sitting in place.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


import pandas as pd

from .audit import md5, raw_files
from .paths import Paths
from .st_io import read_st


def load_source_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


@dataclass(frozen=True)
class InputFile:
    source: str
    path: Path
    md5: str

    def rel(self, root: Path) -> str:
        return self.path.relative_to(root).as_posix()


def input_files(paths: Paths) -> list[InputFile]:
    excluded = {e["md5"] for e in load_source_config(paths.source_config).get("exclude_files", [])}
    seen: set[str] = set()
    out = []
    for source, p in sorted(raw_files(paths), key=lambda sp: (len(sp[1].name), sp[1].name)):
        h = md5(p)
        if h in seen or h in excluded:
            continue
        seen.add(h)
        out.append(InputFile(source, p, h))
    return out


def load_inputs(paths: Paths) -> list[tuple[InputFile, pd.DataFrame]]:
    return [(f, read_st(f.path)[0]) for f in input_files(paths)]
