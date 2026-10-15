"""Repo paths. Override the root with COMICS_REPO_ROOT (used by tests)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def data(self) -> Path:
        return self.root / "data"

    @property
    def raw(self) -> Path:
        return self.data / "raw"

    @property
    def raw_sources(self) -> dict[str, Path]:
        return {"sensortower": self.raw / "sensortower", "genesis": self.raw / "genesis"}

    @property
    def raw_duplicates(self) -> Path:
        return self.raw / "_duplicates"

    @property
    def catalog(self) -> Path:
        return self.data / "catalog"

    @property
    def registry_csv(self) -> Path:
        return self.catalog / "registry.csv"

    @property
    def apps_catalog_json(self) -> Path:
        return self.catalog / "apps_catalog.json"

    @property
    def source_config(self) -> Path:
        return self.catalog / "source_config.json"

    @property
    def processed(self) -> Path:
        return self.data / "processed"

    @property
    def web_data(self) -> Path:
        return self.root / "web" / "public" / "data"

    @property
    def web_icons(self) -> Path:
        return self.web_data / "icons"


def get_paths() -> Paths:
    env = os.environ.get("COMICS_REPO_ROOT")
    return Paths(Path(env) if env else Path(__file__).resolve().parents[2])
