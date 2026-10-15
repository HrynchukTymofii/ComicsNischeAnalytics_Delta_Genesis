PY ?= $(firstword $(wildcard $(CURDIR)/.venv/Scripts/python.exe $(CURDIR)/.venv/bin/python) python)
PIPELINE = cd pipeline && $(PY) -m comics_pipeline

.PHONY: install registry audit catalog build-data metrics check-deploy mcp-smoke web web-build mcp test all

install:
	$(PY) -m pip install -e "./pipeline[dev]" -e ./mcp
	cd web && npm install

## Google Sheet exports (longlist + shortlist) in data/catalog -> registry.csv
registry:
	$(PIPELINE) registry

## Report on raw files: duplicates, columns, granularity, overlaps. Never moves or deletes.
audit:
	$(PIPELINE) audit

## registry.csv (or the Google Sheet if REGISTRY_SHEET_CSV_URL is set) -> apps_catalog.json + icons
catalog:
	$(PIPELINE) catalog

## raw CSVs -> data/processed/*.parquet + web/public/data/*.json
build-data:
	$(PIPELINE) build-data
	$(PIPELINE) metrics
	cd web && npm run flags

## monthly.parquet -> web/public/data/metrics.json (also run by build-data)
metrics:
	$(PIPELINE) metrics

web:
	cd web && npm run dev

web-build:
	cd web && npm run build

## no raw CSV/xlsx/parquet in git, web/public/data < 20 MB
check-deploy:
	$(PIPELINE) check-deploy

mcp:
	cd mcp && $(PY) -m comics_mcp.server

## start the MCP server over stdio and call every tool once
mcp-smoke:
	$(PY) mcp/scripts/smoke.py

test:
	cd pipeline && $(PY) -m pytest -q

all: registry audit catalog build-data
