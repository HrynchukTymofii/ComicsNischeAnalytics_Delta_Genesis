"""python -m comics_pipeline {registry,audit,catalog,build-data,metrics,intel,check-deploy}"""
from __future__ import annotations

import argparse
import sys

try:  # use the OS certificate store (needed behind TLS-inspecting proxies/antivirus on Windows)
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # pragma: no cover
    pass

from . import audit, build_data, catalog, check_deploy, intel, metrics, registry
from .paths import get_paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="comics_pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit", help="report on raw files (read-only by default)")
    a.add_argument("--move-duplicates", action="store_true", help="move byte-identical duplicates to data/raw/_duplicates")
    a.add_argument("--apply-plan", action="store_true", help="move duplicates AND rename files per the proposed plan")
    a.add_argument("--confirmed", action="store_true", help="the user has confirmed the duplicate list")
    sub.add_parser("registry", help="Google Sheet exports (longlist + shortlist) -> registry.csv")
    sub.add_parser("catalog", help="registry.csv -> apps_catalog.json + icons")
    sub.add_parser("build-data", help="raw exports -> parquet + web JSON")
    sub.add_parser("check-deploy", help="no raw/parquet files in git; web/public/data < 20 MB")
    sub.add_parser("metrics", help="monthly.parquet -> web/public/data/metrics.json")
    sub.add_parser("intel", help="AppKittie, Google Play reviews, free services -> web/public/data/intel/ + market_signals.json")
    args = parser.parse_args(argv)

    paths = get_paths()
    if args.cmd == "audit":
        audit.run(paths, move=args.move_duplicates, confirmed=args.confirmed, apply=args.apply_plan)
    elif args.cmd == "registry":
        registry.run(paths)
    elif args.cmd == "catalog":
        catalog.run(paths)
    elif args.cmd == "build-data":
        build_data.run(paths)
    elif args.cmd == "metrics":
        metrics.run(paths)
    elif args.cmd == "intel":
        intel.run(paths)
    elif args.cmd == "check-deploy":
        return 0 if check_deploy.run(paths) else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
