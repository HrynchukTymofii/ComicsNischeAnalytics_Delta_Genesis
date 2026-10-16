# comics-market-dashboard

Comics / webtoon / manga app market: Sensor Tower exports → Python pipeline → static Next.js dashboard
(Ukrainian UI) and an MCP server for Claude. Data rules: [CLAUDE.md](CLAUDE.md). Plan/progress: [tasks.md](tasks.md).

## Setup (Windows, Git Bash)

```sh
python -m venv .venv                 # Python 3.11+
make install                         # pip install pipeline[dev] + mcp; npm install in web/
```

No `make`? `winget install ezwinports.make`, or run the Makefile commands directly
(`cd pipeline && ../.venv/Scripts/python -m comics_pipeline <command>`).

## Data flow

| step | command | output |
|---|---|---|
| 1. Google Sheet exports (longlist + shortlist) in `data/catalog/` | `make registry` | `data/catalog/registry.csv` |
| 2. Sensor Tower exports in `data/raw/sensortower/` | `make audit` | `data/audit_report.{csv,md}` (read-only report + proposed plan) |
| 3. after the plan is approved | `… audit --apply-plan --confirmed` | duplicates → `data/raw/_duplicates/`, files renamed, `data/raw/_rename_log.csv` |
| 4. app catalog (+ Apple iTunes Lookup, icons) | `make catalog` | `data/catalog/apps_catalog.json`, `web/public/data/apps.json`, `web/public/icons/` |
| 5. data + metrics | `make build-data` | `data/processed/*.parquet`, `web/public/data/*.json` |
| 5b. other sources (AppKittie, Google Play reviews, free-services workbook in `data/raw/genesis/0X_*`) | `make intel` (also run by build-data; needs ffmpeg for resizing creatives) | `web/public/data/intel/*.json`, `market_signals.json`, `web/public/creatives/`, `data/processed/intel.json` |
| 6. dashboard | `make web` → http://localhost:3000 | |
| 7. checks | `make test`, `make check-deploy` | |

Raw files are never deleted. Files to ignore go in `exclude_files` in `data/catalog/source_config.json` (by MD5).

## Deploy to Vercel

The site is fully static (`output: "export"`); it only reads `web/public/data`, which is committed.

1. Rebuild and check: `make build-data && make web-build && make check-deploy`
   (fails if any raw CSV/xlsx/parquet would be committed, or `web/public/data` ≥ 20 MB).
2. Commit and push.
3. Deploy:

   ```sh
   npm i -g vercel
   vercel login
   cd web
   vercel link        # first time: create/link the project; Root Directory = web, framework Next.js
   vercel --prod
   ```

   Or connect the Git repo in the Vercel dashboard with **Root Directory = `web`** (build command `next build`, defaults otherwise).

## MCP server

See [mcp/README.md](mcp/README.md).
