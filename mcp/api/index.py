"""Vercel entry point: the comics-market MCP server over Streamable HTTP (stateless, JSON responses).

Deployed from mcp/ with `make mcp-deploy`, which first copies the data into mcp/data (gitignored).
Every request needs MCP_TOKEN, as `Authorization: Bearer <token>` or `?key=<token>` (for clients
that can't set headers) — the data is licensed Sensor Tower data, so the server refuses requests
when MCP_TOKEN isn't set.
"""
from __future__ import annotations

import hmac
import json
import os
from pathlib import Path
from urllib.parse import parse_qs

HERE = Path(__file__).resolve().parents[1]
os.environ.setdefault("COMICS_REPO_ROOT", str(HERE))  # data/processed + data/catalog staged next to api/
os.environ.setdefault("HOME", "/tmp")  # duckdb wants a writable home; the function filesystem is read-only

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager  # noqa: E402

from comics_mcp.server import mcp  # noqa: E402


async def _send_json(send, status: int, body: dict) -> None:
    data = json.dumps(body).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]})
    await send({"type": "http.response.body", "body": data})


def _authorized(scope) -> bool:
    token = os.environ.get("MCP_TOKEN", "")
    headers = dict(scope.get("headers") or [])
    given = headers.get(b"authorization", b"").decode()
    given = given[7:] if given.lower().startswith("bearer ") else ""
    if not given:
        given = (parse_qs(scope.get("query_string", b"").decode()).get("key") or [""])[0]
    return bool(token) and hmac.compare_digest(given, token)


async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while (msg := await receive())["type"] != "lifespan.shutdown":
            await send({"type": "lifespan.startup.complete"})
        await send({"type": "lifespan.shutdown.complete"})
        return
    if scope["path"].rstrip("/") != "/mcp":
        return await _send_json(send, 200, {"server": "comics-market", "mcp_endpoint": "/mcp"})
    if not os.environ.get("MCP_TOKEN"):
        return await _send_json(send, 503, {"error": "MCP_TOKEN is not configured on the server"})
    if not _authorized(scope):
        return await _send_json(send, 401, {"error": "missing or wrong token"})
    # Serverless: no shared state between invocations, so a fresh stateless manager per request.
    manager = StreamableHTTPSessionManager(app=mcp._mcp_server, stateless=True, json_response=True)
    async with manager.run():
        await manager.handle_request(scope, receive, send)
