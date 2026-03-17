from __future__ import annotations

import json
import os
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import AuthenticatedUser, require_current_user
from services.xhs_enrich import get_export_path, get_result, get_status, start_run


app = FastAPI(title="XHS Workbench API")


def _allowed_origins() -> list[str]:
    raw = os.environ.get("BACKEND_CORS_ORIGINS", "").strip()
    if not raw:
        return [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class XhsEnrichRunRequest(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    mode: Literal["founder", "general"] = "founder"
    pages: int = Field(default=1, ge=1)
    goal: str = ""
    batch_size: int = Field(default=8, ge=1)
    max_results: int = Field(default=0, ge=0)
    no_openclaw: bool = False
    deep_dive_authors: int = Field(default=0, ge=0)


@app.get("/api/health")
async def api_health():
    status = get_status()
    return {
        "status": "ok",
        "script_exists": status["script_exists"],
        "running": status["state"]["running"],
        "latest_run": status["latest_run"]["stamp"] if status["latest_run"] else None,
    }


@app.get("/api/xhs/enrich/status")
async def api_xhs_enrich_status(_user: AuthenticatedUser = Depends(require_current_user)):
    return get_status()


@app.post("/api/xhs/enrich/run")
async def api_xhs_enrich_run(
    body: XhsEnrichRunRequest,
    _user: AuthenticatedUser = Depends(require_current_user),
):
    result = start_run(body.model_dump())
    if result.get("status") == "busy":
        return Response(content=json.dumps(result), media_type="application/json", status_code=409)
    if result.get("status") == "error":
        return Response(content=json.dumps(result), media_type="application/json", status_code=400)
    return result


@app.get("/api/xhs/enrich/result")
async def api_xhs_enrich_result(
    stamp: Optional[str] = None,
    _user: AuthenticatedUser = Depends(require_current_user),
):
    result = get_result(stamp)
    if not result:
        raise HTTPException(status_code=404, detail="No XHS enrichment result found")
    return result


@app.get("/api/xhs/enrich/export/{stamp}/{kind}")
async def api_xhs_enrich_export(
    stamp: str,
    kind: str,
    _user: AuthenticatedUser = Depends(require_current_user),
):
    try:
        path = get_export_path(stamp, kind)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media_type = {
        "csv": "text/csv",
        "json": "application/json",
        "brief": "text/markdown",
        "deepdive": "text/markdown",
    }.get(kind, "application/octet-stream")
    return FileResponse(path=str(path), filename=path.name, media_type=media_type)
