"""Shared helpers for the non-Sensor-Tower adapters: app matching, number parsing, .docx text."""
from __future__ import annotations

import json
import math
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

from ..catalog import name_score
from ..paths import Paths

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R_EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def norm_key(text: str) -> str:
    return re.sub(r"[^0-9a-zа-яіїєґ]+", "", str(text).lower())


def host(url: str | None) -> str | None:
    if not url:
        return None
    h = urlparse(url if "//" in url else f"//{url}").hostname or ""
    return h.removeprefix("www.") or None


@dataclass
class AppMatcher:
    """Resolve store IDs / packages / brand names / domains to catalog slugs.

    Order: iOS ID, Android package (also with the dots stripped, as AppKittie slugs have them),
    data/catalog/aliases.json, website domain, then a fuzzy name match (>= 0.85, same scorer as
    `make catalog`). Misses are collected in `unmatched` so nothing is dropped silently.
    """
    apps: list[dict]
    aliases: dict[str, str | None]
    unmatched: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, paths: Paths) -> AppMatcher:
        apps = json.loads(paths.apps_catalog_json.read_text(encoding="utf-8"))["apps"]
        f = paths.catalog / "aliases.json"
        raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        return cls(apps, {norm_key(k): v for k, v in raw.items() if not k.startswith("_")})

    def by_ios(self, ios_id: str) -> str | None:
        return next((a["slug"] for a in self.apps if str(ios_id) in a["ios_ids"]), None)

    def by_package(self, pkg: str) -> str | None:
        p = norm_key(pkg)
        return next((a["slug"] for a in self.apps for x in a["android_packages"] if x == pkg or norm_key(x) == p), None)

    def by_name(self, name: str) -> str | None:
        k = norm_key(name)
        if k in self.aliases:
            return self.aliases[k]
        h = host(name) if "." in name and " " not in name.strip() else None
        if h:
            hit = next((a["slug"] for a in self.apps if host(a.get("website")) == h), None)
            if hit:
                return hit
        best = max(((max(name_score(name, a["display_name"]), name_score(name, a.get("unified_name") or "")), a["slug"])
                    for a in self.apps), default=(0, None))
        return best[1] if best[0] >= 0.85 else None

    def resolve(self, *, name: str = "", ios_id: str | None = None, package: str | None = None) -> str | None:
        slug = (ios_id and self.by_ios(ios_id)) or (package and self.by_package(package)) or (name and self.by_name(name))
        if not slug and name and norm_key(name) not in self.aliases:
            self.unmatched.add(name)
        return slug or None


# --- numbers --------------------------------------------------------------------------------------

def num(v) -> float | None:
    """'$1,348.5M' -> 1348500000; '−$152.9M' -> -152900000; '25.0%' -> 0.25; '2 884 000' -> 2884000."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if math.isnan(v) else float(v)
    s = str(v).strip().replace("−", "-").replace("\xa0", " ")
    m = re.fullmatch(r"(-?)\s*[≥>#]?\s*\$?\s*([\d\s,]*\.?\d+)\s*([KMB%]?)(?![A-Za-z]).*", s)
    if not m:
        return None
    value = float(m.group(2).replace(" ", "").replace(",", ""))
    value *= {"K": 1e3, "M": 1e6, "B": 1e9, "%": 0.01, "": 1}[m.group(3)]
    return -value if m.group(1) else value


def clean(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return None if s in ("", "—", "-", "nan", "None") else s


def json_safe(o):
    """NaN/inf -> None, recursively (JSON.parse in the browser rejects NaN)."""
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, dict):
        return {k: json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [json_safe(v) for v in o]
    return o


# --- .docx ----------------------------------------------------------------------------------------

@dataclass
class DocxBlock:
    text: str
    images: list[str]  # names inside word/media/


def docx_blocks(path: Path) -> tuple[list[DocxBlock], zipfile.ZipFile]:
    """Paragraphs (and table cells, one block per cell) in reading order, with the images each holds."""
    z = zipfile.ZipFile(path)
    rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    body = ET.fromstring(z.read("word/document.xml")).find(W + "body")
    out: list[DocxBlock] = []

    def para(p) -> DocxBlock:
        text = "".join(t.text or "" for t in p.iter(W + "t")).strip()
        imgs = [target[b.get(R_EMBED)].split("/")[-1] for b in p.iter(A + "blip") if b.get(R_EMBED) in target]
        return DocxBlock(text, imgs)

    for el in body:
        if el.tag == W + "p":
            out.append(para(el))
        elif el.tag == W + "tbl":
            for tc in el.iter(W + "tc"):
                out.extend(para(p) for p in tc.iter(W + "p"))
    return [b for b in out if b.text or b.images], z
