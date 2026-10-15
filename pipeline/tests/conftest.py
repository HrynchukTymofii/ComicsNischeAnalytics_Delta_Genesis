import json
from pathlib import Path

import pytest

from comics_pipeline.paths import Paths


@pytest.fixture
def repo(tmp_path: Path, monkeypatch) -> Paths:
    """A throwaway repo layout so tests never touch real data."""
    paths = Paths(tmp_path)
    for p in (*paths.raw_sources.values(), paths.catalog, paths.processed, paths.web_data):
        p.mkdir(parents=True)
    paths.source_config.write_text(json.dumps({"genesis": {"revenue_basis": None}}))
    monkeypatch.setenv("COMICS_REPO_ROOT", str(tmp_path))
    return paths


def write_csv(path: Path, header: str, rows: list[str]) -> Path:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path
