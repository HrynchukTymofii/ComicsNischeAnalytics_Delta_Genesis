# comics-market MCP server

FastMCP server (official `mcp` Python SDK, 1.x) over `data/processed/*.parquet` and
`data/catalog/apps_catalog.json`, queried with duckdb. Build the data first: `make catalog && make build-data`.

Every result includes `period`, `region` and `revenue_basis`. Revenue is Sensor Tower **net**;
pass `basis="gross"` to add the estimated gross range (net/0.85 … net/0.70).

| tool | what it returns |
|---|---|
| `list_apps(segment?, status?)` | apps with segment, status, store links, website, icon path |
| `app_profile(app, region, basis)` | catalog entry + L12M revenue, downloads, YoY, growth status, RPD |
| `timeseries(app, metric, region, start, end, granularity="month")` | revenue / downloads / rpd by month or year |
| `total_market(region, by="app"\|"segment", period, segments?)` | dataset total, breakdown, top-1/2/5 concentration |
| `compare_apps(apps, metric, region, period)` | side-by-side, with YoY for L12M |
| `top_countries(app, metric, period, limit)` | top countries (world data) |
| `growth_table(region)` | every app: L12M vs previous 12 months, status |
| `us_snapshot_ranking()` | US run-rate ranking from the 13–30.09.2026 daily snapshot |

`app` accepts a slug (`webtoon`) or a name (`Shonen Jump`). `period`: `l12m`, `all`, `2025`, `2026-09`, `2025-01..2026-09`.

## Install

```sh
.venv/Scripts/python -m pip install -e ./mcp     # from the repo root (make install does this)
```

## Claude Code

The repo ships `.mcp.json`, so opening Claude Code in the repo root offers the server automatically.
To add it by hand (project scope):

```sh
claude mcp add comics-market -- "C:/Users/tim20/Desktop/Genesis/ComicsAnalytics/comics-market-dashboard/.venv/Scripts/python.exe" -m comics_mcp.server
```

## Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "comics-market": {
      "command": "C:\\Users\\tim20\\Desktop\\Genesis\\ComicsAnalytics\\comics-market-dashboard\\.venv\\Scripts\\python.exe",
      "args": ["-m", "comics_mcp.server"]
    }
  }
}
```

## Check it

```sh
make mcp-smoke        # starts the server over stdio and calls every tool once
```

Windows note: the server imports pandas on startup on purpose. duckdb imports it lazily, and doing
that on the server's worker thread deadlocks on Windows.
