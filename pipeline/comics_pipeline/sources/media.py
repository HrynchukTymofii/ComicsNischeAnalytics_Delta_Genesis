"""Ad creatives and screenshots for the web UI (user decision 2026-10-16: download, don't hotlink).

Originals are cached in data/catalog/cache/media/ (gitignored). Web copies go to
web/public/creatives/ and are named by content hash (identical creatives collapse to one file):
images scaled to <= 640 px wide (JPEG), videos to <= 480 px wide H.264 + a poster frame.
Uses ffmpeg when it is on PATH; without it the originals are copied as they are.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

import requests

from ..paths import Paths

WEB_DIR = "creatives"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".webm"}


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _run(args: list[str]) -> bool:
    try:
        subprocess.run(args, check=True, capture_output=True, timeout=300)
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


class Media:
    def __init__(self, paths: Paths):
        self.cache = paths.catalog / "cache" / "media"
        self.web_root = paths.root / "web" / "public"
        self.out = self.web_root / WEB_DIR
        self.cache.mkdir(parents=True, exist_ok=True)
        self.out.mkdir(parents=True, exist_ok=True)
        self.ffmpeg = _ffmpeg()
        self.failed: list[str] = []
        self.written: set[Path] = set()

    def fetch(self, url: str) -> Path | None:
        name = hashlib.md5(url.encode()).hexdigest()[:16] + Path(url.split("?")[0]).suffix.lower()
        dst = self.cache / name
        if not dst.exists():
            try:
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                dst.write_bytes(r.content)
            except requests.RequestException as e:
                self.failed.append(f"{url}: {e}")
                return None
        return dst

    def _web_path(self, p: Path) -> str:
        self.written.add(p)
        return "/" + p.relative_to(self.web_root).as_posix()

    def publish(self, src: Path, subdir: str) -> dict | None:
        """-> {"kind": "image"|"video", "src": "/creatives/…", "poster": "/creatives/…" | None}"""
        ext = src.suffix.lower()
        digest = hashlib.md5(src.read_bytes()).hexdigest()[:12]
        folder = self.out / subdir
        folder.mkdir(parents=True, exist_ok=True)
        if ext in IMAGE_EXT:
            dst = folder / f"{digest}.jpg"
            if not dst.exists():
                ok = self.ffmpeg and _run([self.ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
                                           "-vf", "scale='min(640,iw)':-2", "-q:v", "5", "-frames:v", "1", str(dst)])
                if not ok:
                    dst = folder / f"{digest}{ext}"
                    shutil.copy2(src, dst)
            return {"kind": "image", "src": self._web_path(dst), "poster": None}
        if ext in VIDEO_EXT:
            dst, poster = folder / f"{digest}.mp4", folder / f"{digest}.poster.jpg"
            if not dst.exists():
                ok = self.ffmpeg and _run([self.ffmpeg, "-y", "-loglevel", "error", "-i", str(src),
                                           "-vf", "scale='min(480,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
                                           "-crf", "30", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(dst)])
                if not ok:
                    shutil.copy2(src, dst)
            if not poster.exists() and self.ffmpeg:
                _run([self.ffmpeg, "-y", "-loglevel", "error", "-ss", "1", "-i", str(src), "-frames:v", "1",
                      "-vf", "scale='min(480,iw)':-2", "-q:v", "5", str(poster)])
            return {"kind": "video", "src": self._web_path(dst), "poster": self._web_path(poster) if poster.exists() else None}
        return None

    def publish_url(self, url: str | None, subdir: str) -> dict | None:
        src = self.fetch(url) if url else None
        return self.publish(src, subdir) if src else None

    def publish_bytes(self, data: bytes, name: str, subdir: str) -> dict | None:
        src = self.cache / (hashlib.md5(data).hexdigest()[:16] + Path(name).suffix.lower())
        if not src.exists():
            src.write_bytes(data)
        return self.publish(src, subdir)

    def prune(self) -> list[str]:
        """Remove web copies no longer referenced (generated files only; raw data is never touched)."""
        removed = []
        for p in self.out.rglob("*"):
            if p.is_file() and p not in self.written:
                p.unlink()
                removed.append(p.relative_to(self.web_root).as_posix())
        return removed
