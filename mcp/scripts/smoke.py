"""Start the MCP server over stdio (like Claude does) and call every tool once.

Usage (repo root):  .venv/Scripts/python mcp/scripts/smoke.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CALLS = [
    ("list_apps", {"segment": "webtoon_platform"}),
    ("app_profile", {"app": "webtoon"}),
    ("timeseries", {"app": "Shonen Jump", "metric": "revenue", "start": "2026-01", "end": "2026-09"}),
    ("total_market", {"by": "segment", "period": "2025"}),
    ("compare_apps", {"apps": ["webtoon", "tapas", "manta"], "basis": "gross"}),
    ("top_countries", {"app": "webtoon", "limit": 5}),
    ("growth_table", {"region": "us"}),
    ("us_snapshot_ranking", {}),
    ("app_intel", {"app": "manta"}),
    ("reviews", {"app": "tapas", "topic": "shutdown", "limit": 3}),
    ("ads", {"app": "shonen jump"}),
    ("market_signals", {"section": "google_trends"}),
]


async def main() -> int:
    server = StdioServerParameters(command=sys.executable, args=["-m", "comics_mcp.server"],
                                   cwd=str(Path(__file__).resolve().parents[1]))
    failures = 0
    async with stdio_client(server) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = {t.name for t in (await session.list_tools()).tools}
        missing = {name for name, _ in CALLS} - tools
        print(f"tools: {sorted(tools)}" + (f"  MISSING: {missing}" if missing else ""))
        for name, args in CALLS:
            res = await session.call_tool(name, args)
            text = res.content[0].text if res.content else ""
            if res.isError:
                failures += 1
                print(f"✗ {name}: {text[:300]}")
                continue
            data = json.loads(text)
            labels = all(k in data for k in ("period", "region", "revenue_basis"))
            failures += not labels
            print(f"{'✓' if labels else '✗ (missing labels)'} {name}: period={data.get('period')!r} "
                  f"region={data.get('region')!r} · {len(text):,} chars")
    return 1 if failures or missing else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
