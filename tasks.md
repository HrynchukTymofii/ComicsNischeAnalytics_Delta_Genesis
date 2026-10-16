# Tasks

Work through these in order. Tick a box only when the step is done and verified.
Steps marked ⏸ need the user's explicit OK before continuing.

## Status

- [x] 0. Registry: merge longlist + shortlist → `data/catalog/registry.csv` (`make registry`)
- [x] 1. Audit both raw folders — report `data/audit_report.{csv,md}`; user OK'd the plan.
      MangaFox (wrong export) excluded by MD5 in source_config.json.
      ⚠ The move/rename itself was blocked by the tool permission check — the user has to run
      `cd pipeline && ../.venv/Scripts/python -m comics_pipeline audit --apply-plan --confirmed`.
      (Pipeline selects files by MD5, so nothing downstream depends on it.)
- [x] 2. App catalog — 37 apps (18 with ST data), iTunes metadata + 20 icons; all ST apps matched the registry
- [x] 3. Data pipeline — tests: WEBTOON $547.8M (−0.3% vs 549.5), Shonen Jump 2026-09 iOS $1.97M, K MANGA dup
- [x] 4. Metrics — `web/public/data/metrics.json`; `make build-data` runs metrics too
- [x] 5. Dashboard — 6 pages, static export (26 pages); checked in the browser (data/labels), not yet on a phone-size screen
- [x] 6. Deploy prep — `make check-deploy` OK (public/data 0.36 MB + icons 1.8 MB); README has Vercel steps. Not deployed (needs `vercel login`)
- [x] 7. MCP server — 8 tools, `make mcp-smoke` passes over stdio; setup in mcp/README.md
- [x] 8. New sources (2026-10-16): `make intel` — AppKittie (search, cards/IAP, ads+creatives, keywords, creators,
      paywalls), Google Play reviews (Manta, Tapas, WEBTOON), free-services workbook (Similarweb, AppMagic, US stores,
      Meta Ad Library, Google Trends, WEBTOON SEC, deals, AlternativeTo, gaps). App page sections + new page
      «Ринкові сигнали»; catalog +8 apps (extra_apps.csv); MCP +4 tools; 13 new tests. Checked in the browser
      (desktop + 390 px). Sensor Tower JSON unchanged (verified number by number).
- [ ] 9. Follow-ups: AppMagic net/gross (ask/verify); more AppKittie cards (IAP) and reviews for other apps;
      pre-existing hydration warning — country names from Intl.DisplayNames differ Node vs Chrome (e.g. Hong Kong)

## Notes / deviations agreed or to confirm

- Repo code lives in the `pipeline/comics_pipeline/` package; "pipeline/audit.py" etc. in the prompts
  map to `pipeline/comics_pipeline/audit.py`, run via `make audit` / `python -m comics_pipeline audit`.
- Prompt 3 sets granularity priority **monthly > weekly > daily** (done; CLAUDE.md updated).
- Week → month: weeks are split across months by days (user chose this over whole weeks, which
  made 5-week months +25%). WEBTOON 2026-01 = 4/7 of the 2025-12-29 week + the January weeks.
- WEBTOON test: $547.8M vs $549.5M target (−0.3%, within ±1%). The raw file sum double-counts
  Dec 29–31 2025 (in both the Dec monthly row and the first weekly row) and includes Oct 1–4 2026.
- Video formats (short_drama: ReelShort, DramaBox; ai_comic_drama: MoboDrama) are OFF by default in the
  dashboard («Відео-формати» toggle) and in MCP total_market (include_video=False) — user request.
- Dashboard follow-ups (user, 2026-10-15): colour markers in all tooltips; Overview app chart defaults to
  separate lines (stacked is optional — stacking hid each app's own trend), optional log scale; period
  presets + drag slider; Catalog rows expand into a quick view (chart + key figures).
- Don't run `next build` while the user's `npm run dev` is running — both use web/.next and the dev
  server breaks ("Cannot find module './24.js'"). Type-check with `npx tsc --noEmit` instead.
- Region switch has World / US / Tier-1 (20 countries, `data/catalog/regions.json`).
- Open questions for the user (asked 2026-10-15): latest-month dip — (a) per-day switch, (b) mark latest
  month preliminary, (c) newer export overrides older; US Sep 2026 page — (a) add monthly×12 ranking for
  all apps, (b) user exports Shonen Jump US daily 13–30.09.
- "Core" market = webtoon_platform + manga + western_comics; shares are given of dataset and of core.
- Dataset totals are dominated by short drama (DramaBox + ReelShort ≈ $1.8B of all revenue);
  the dashboard should make the segment filter prominent.
- Raw folder also contains `.xlsx` exports (US 13–30.09.2026 snapshots); audit reads them too.
- Gross figures exist only as an estimated range (net/0.85 … net/0.70) and are always labelled as such.

---

## Original prompts (verbatim from the user)

### Промпт 1 — аудит обох папок

Write pipeline/audit.py scanning data/raw/sensortower AND data/raw/genesis recursively.
Files are Sensor Tower exports: UTF-16 LE, TAB-separated (fallback: try utf-8 / comma if parsing fails).
Columns: Unified Name, Unified ID, Publisher Name, Publisher ID, Developer Name, Developer ID, App Name, App ID,
Date, Country / Region, Platform, Device, Downloads, Revenue ($), RPD ($), optional ARPDAU ($).
Per file: source folder, MD5, rows, unified app name(s), App IDs, min/max date,
granularity (daily / weekly-Monday / monthly-day-01) detected from date spacing,
region coverage (single country like US vs. many countries), totals of downloads and revenue.
Detect: exact duplicates (same MD5 — "Revenue" and "Downloads" exports are often identical),
overlapping files (same app + granularity + overlapping dates, e.g. WEBTOON monthly 2015–2025 vs weekly 2026).
Output data/audit_report.csv + markdown table. Do NOT move or rename anything; propose a plan:
duplicates → data/raw/_duplicates, rename to "<App>_<granularity>_<region>_<start>_<end>.csv". Wait for my OK.

### Промпт 2 — каталог застосунків

Write pipeline/catalog.py producing data/catalog/apps_catalog.json and web/public/data/apps.json.
1. Collect every unique App ID per Unified app from all raw files.
   Numeric App ID = iOS; reverse-domain (com.x.y) = Google Play package.
2. For iOS IDs call Apple iTunes Lookup API (https://itunes.apple.com/lookup?id=<id>&country=us),
   take: trackName, sellerName, primaryGenreName (official category), artworkUrl512 (icon), trackViewUrl,
   averageUserRating, userRatingCount, releaseDate. Cache responses in data/catalog/cache/. Download icons to web/public/icons/.
3. Google Play link = https://play.google.com/store/apps/details?id=<package> (no scraping).
4. Merge data/catalog/registry.csv (our longlist: company, parent group, segment, markets, monetization, status,
   website, sources) by fuzzy app name match; print unmatched names for me to fix manually.
5. Our segment taxonomy: webtoon_platform, manga, western_comics, webnovel (adjacent), short_drama (substitute),
   ai_comic_drama, piracy (reference). Status: active, declining, closing, closed, newcomer.
Fields per app: slug, display_name, unified_id, ios_ids[], android_packages[], developer, publisher, company, parent,
segment, ios_category, status, website, app_store_url, google_play_url, icon_path, rating, rating_count, release_date,
data_coverage {granularity, start, end, regions}.

### Промпт 3 — пайплайн даних

Write pipeline/build_data.py:
1. Load all non-duplicate files from audit_report, normalize to one long table:
   app_slug, app_id, platform, device, country, date, granularity, source_file, downloads, revenue_net.
2. Drop duplicate rows across files (same app_id, country, device, date, granularity).
3. MONTHLY table: monthly rows as-is; weekly/daily rows aggregated to month by date with flag from_weekly/from_daily.
   For each app+month prefer monthly > weekly > daily (never add them together).
   Special case: WEBTOON = monthly 2015-01..2025-12 + weekly 2026; the week starting 2025-12-29 goes to 2026-01.
4. Keep the US daily 13–30.09.2026 files as a separate table `us_snapshot_sep2026` (run-rate = sum × 365/18).
5. Add revenue_gross_low = net/0.85, revenue_gross_high = net/0.70.
6. Save data/processed/monthly.parquet and us_snapshot.parquet.
7. Export JSON to web/public/data/: monthly_by_app.json (world + US), totals_monthly.json (sum of all apps and by segment,
   world + US), totals_yearly.json, by_country_{slug}.json (top 20, all-time and L12M), platform_split.json, us_snapshot.json.
Tests (pytest): WEBTOON global app 2015-01..2026-09 ≈ $549.5M net (±1%);
Shonen Jump 2026-09 App Store ≈ $1.97M; K MANGA "Revenue" and "Downloads" files flagged as identical.

### Промпт 4 — метрики

Write pipeline/metrics.py producing web/public/data/metrics.json per app and region (world, US):
L12M revenue & downloads, YoY by calendar year (mark partial years), MoM, CAGR (first→last full year),
RPD, share of total revenue in the dataset and within its segment, peak month and drawdown from peak,
months since launch, "reached $10M ARR within 36 months?" (ARR = monthly net revenue × 12),
status: Growing (> +5% YoY L12M), Stable (−5..+5%), Declining (< −5%).
Also totals: dataset total revenue by month/year, by segment, top-5 concentration (share of top 1, top 2, top 5).

### Промпт 5 — дашборд

Build the Next.js dashboard reading only /public/data (static, no backend). Ukrainian UI labels, $M with 1 decimal.
Global controls: Net / Gross (low–high range), Region World / US, segment filter.
Pages:
1. «Огляд»: KPI cards (total dataset revenue L12M, YoY, number of apps, leader);
   stacked area chart of TOTAL monthly revenue by app (top 8 + "інші"); total revenue by year (bar) with YoY labels;
   revenue by segment over time; concentration chart (share of #1, #2, top-5).
2. «Каталог»: grid/table of all apps — icon, name, segment badge, status badge (colored), developer, iOS category,
   App Store / Google Play / website links, rating, data coverage period; search + filters.
3. «Застосунок» /apps/[slug]: header with icon and links; monthly revenue & downloads; YoY bars; platform split;
   top countries table + bar; RPD trend; status and L12M KPIs.
4. «Порівняння»: pick 2–6 apps, overlay revenue (absolute or indexed to 100), "0 → $10M ARR за 3 роки" chart
   (X = months since launch, horizontal line at $10M ARR).
5. «США, вересень 2026»: run-rate ranking from us_snapshot.
6. «Про дані»: sources, net vs gross, granularity caveats, audit summary.

### Промпт 6 — деплой

Prepare /web for Vercel: root directory = web, `next build`, all data static in public/. README with
`vercel login`, `vercel link`, `vercel --prod`. Verify no raw CSV/parquet is committed and total public/data < 20 MB.

### Промпт 7 — MCP-сервер

Build /mcp with the official Python `mcp` SDK (FastMCP), reading data/processed/*.parquet and apps_catalog.json via duckdb.
Tools: list_apps(segment?, status?) with links and icons; app_profile(app) (catalog + L12M KPIs);
timeseries(app, metric, region, start, end, granularity="month"); total_market(region, by="app"|"segment", period);
compare_apps(apps, metric, region, period); top_countries(app, metric, period, limit);
growth_table(region); us_snapshot_ranking().
Every response includes period, region and net/gross label. Add setup instructions for Claude Desktop
(claude_desktop_config.json) and Claude Code (`claude mcp add`), plus a script that calls every tool once.

### Промпт 8 — (потім) нові джерела, AppKittie тощо

Add a source adapter layer: pipeline/sources/{sensortower,appkittie}.py, each returning the same normalized schema
plus a `source` column. Never merge revenue from different sources into one number — show them side by side
with labels. Update catalog coverage and the «Про дані» page.
