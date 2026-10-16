PY ?= $(firstword $(wildcard $(CURDIR)/.venv/Scripts/python.exe $(CURDIR)/.venv/bin/python) python)
PIPELINE = cd pipeline && $(PY) -m comics_pipeline

.PHONY: install registry audit catalog build-data metrics intel check-deploy mcp-smoke mcp-deploy web web-build mcp test all

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

## raw CSVs -> data/processed/*.parquet + web/public/data/*.json (+ intel from the other sources)
build-data:
	$(PIPELINE) build-data
	$(PIPELINE) metrics
	$(PIPELINE) intel
	cd web && npm run flags

## monthly.parquet -> web/public/data/metrics.json (also run by build-data)
metrics:
	$(PIPELINE) metrics

## AppKittie, Google Play reviews, free-services workbook -> web/public/data/intel/, market_signals.json,
## web/public/creatives/ (also run by build-data). Never adds anything to the Sensor Tower numbers.
intel:
	$(PIPELINE) intel

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

## copy the data into mcp/data and deploy the MCP server to Vercel (needs MCP_TOKEN set there)
mcp-deploy:
	$(PY) mcp/scripts/stage_data.py
	cd mcp && npx --yes vercel deploy --prod

test:
	cd pipeline && $(PY) -m pytest -q

all: registry audit catalog build-data
