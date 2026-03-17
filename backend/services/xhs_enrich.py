from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PACKAGED_SCRIPT_PATH = PROJECT_ROOT / "external" / "xhs_enrich.py"
LEGACY_LOCAL_SCRIPT_PATH = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/macmini/xhs_enrich.py"
LEGACY_LOCAL_OUTPUT_DIR = Path.home() / "xhs_exports"
DEFAULT_XHS_BIN = Path.home() / ".local" / "bin" / "xhs"


def _resolve_script_path() -> Path:
    configured = os.environ.get("XHS_ENRICH_SCRIPT")
    if configured:
        return Path(configured).expanduser()
    if LEGACY_LOCAL_SCRIPT_PATH.exists():
        return LEGACY_LOCAL_SCRIPT_PATH.expanduser()
    return PACKAGED_SCRIPT_PATH


def _script_is_placeholder(path: Path) -> bool:
    if path != PACKAGED_SCRIPT_PATH or not path.exists():
        return False
    try:
        return "Please replace xhs-workbench/backend/external/xhs_enrich.py" in path.read_text(encoding="utf-8")
    except OSError:
        return False


def _script_is_ready() -> bool:
    return SCRIPT_PATH.exists() and not _script_is_placeholder(SCRIPT_PATH)


def _resolve_output_dir() -> Path:
    configured = os.environ.get("XHS_ENRICH_OUTPUT_DIR")
    if configured:
        return Path(configured).expanduser()
    if LEGACY_LOCAL_OUTPUT_DIR.exists():
        return LEGACY_LOCAL_OUTPUT_DIR.expanduser()
    return PROJECT_ROOT / "exports"


def _resolve_binary(env_key: str, program_name: str, fallback_path: Path | None = None) -> Path | None:
    configured = os.environ.get(env_key)
    if configured:
        return Path(configured).expanduser()
    if fallback_path and fallback_path.exists():
        return fallback_path
    discovered = shutil.which(program_name)
    return Path(discovered) if discovered else None


def _command_output(command: list[str], timeout: int = 8) -> tuple[int, str]:
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except (subprocess.SubprocessError, OSError) as exc:
        return -1, str(exc)
    output = (proc.stdout or proc.stderr or "").strip()
    return proc.returncode, output


def _dependency_status() -> dict[str, Any]:
    xhs_bin = _resolve_binary("XHS_BIN", "xhs", DEFAULT_XHS_BIN)
    openclaw_bin = _resolve_binary("OPENCLAW_BIN", "openclaw")

    xhs_installed = bool(xhs_bin and xhs_bin.exists())
    xhs_logged_in = False
    xhs_status = "未安装 xhs。先执行 `uv tool install xiaohongshu-cli`。"

    if xhs_installed and xhs_bin:
        return_code, output = _command_output([str(xhs_bin), "status"])
        if return_code == 0:
            xhs_logged_in = True
            xhs_status = output or "xhs 已登录，可直接抓取。"
        else:
            lowered = output.lower()
            if "re-login with: xhs login" in lowered or "session expired" in lowered:
                xhs_status = "xhs 未登录或会话已过期。先在宿主机执行 `xhs login`。"
            else:
                xhs_status = output or "xhs 状态检查失败，请先执行 `xhs login`。"

    openclaw_installed = bool(openclaw_bin and openclaw_bin.exists())
    openclaw_status = "已安装，可启用增强重排。" if openclaw_installed else "未安装，运行时会自动回退到启发式模式。"

    blockers: list[str] = []
    if not _script_is_ready():
        blockers.append("缺少可运行的抓取脚本")
    if not xhs_installed:
        blockers.append("未安装 xhs CLI")
    elif not xhs_logged_in:
        blockers.append("xhs 尚未登录")

    return {
        "xhs": {
            "path": str(xhs_bin) if xhs_bin else "",
            "installed": xhs_installed,
            "logged_in": xhs_logged_in,
            "status": xhs_status,
        },
        "openclaw": {
            "path": str(openclaw_bin) if openclaw_bin else "",
            "installed": openclaw_installed,
            "status": openclaw_status,
        },
        "run_ready": not blockers,
        "run_blockers": blockers,
    }


SCRIPT_PATH = _resolve_script_path()
OUTPUT_DIR = _resolve_output_dir()
RUN_LOCK = threading.Lock()
RUN_STATE: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "last_exit_code": None,
    "last_error": None,
    "last_stdout": "",
    "last_stderr": "",
    "last_command": [],
    "last_result_stamp": None,
    "last_config": None,
    "runtime_notes": [],
}

STAMP_RE = re.compile(r"xhs_(?:enriched|brief|founder_deepdive)_(\d{8}_\d{6})\.(?:csv|json|md)$")
BUCKET_ORDER = {
    "priority": 3,
    "watchlist": 2,
    "review": 1,
    "low_signal": 0,
}
TEAM_TERMS = [
    "招技术合伙人", "找技术合伙人", "找产品合伙人", "招产品合伙人", "联创", "寻联创", "招人",
    "招聘", "cto", "技术负责人", "创始人", "联合创始人", "团队", "工程师", "产品经理",
]
SHIPPING_TERMS = [
    "上线", "发布", "内测", "公测", "beta", "waitlist", "mvp", "产品验证", "demo",
    "灰度", "首发", "版本", "迭代",
]
TRACTION_TERMS = [
    "营收", "arr", "mrr", "付费", "客户", "签约", "留存", "复购", "增长", "用户增长",
    "dau", "mau", "转化", "gmv", "pipeline", "回款",
]
FUNDING_TERMS = [
    "融资", "天使轮", "种子轮", "pre-seed", "pre seed", "pre-a", "路演", "investor update",
]
PRODUCT_TERMS = [
    "agent", "workflow", "saas", "b2b", "企业服务", "自动化", "模型", "推理", "api",
    "插件", "平台", "出海", "垂类",
]
STARTUP_CONTEXT_TERMS = [
    "ai", "创业", "初创", "创业者", "创始人", "技术合伙人", "产品合伙人", "产品", "软件",
    "工具", "平台", "企业服务", "saas", "agent", "模型", "自动化", "客户", "营收",
    "融资", "独立开发", "出海", "mvp",
]
NEGATIVE_TERMS = [
    "ai获客", "流量变现", "副业", "变现课", "训练营", "陪跑", "私董会", "闭门会", "社群",
    "圈子", "咨询", "课程", "买课", "报名", "加v", "加我", "私信我", "主页加", "搞钱",
    "引流", "带货", "个人ip", "ip打造", "ip孵化", "收徒", "代理", "招商", "同城交流",
    "资源对接", "直播间", "搞流量", "客户获客", "成交脚本", "小白也能", "一部手机",
]
GENERIC_TERMS = [
    "认知", "思考", "干货", "分享", "心得", "感悟", "趋势判断", "复盘思考", "为什么说",
]
NON_STARTUP_TERMS = [
    "租房", "门店", "showroom", "服饰", "穿搭", "买手", "咖啡", "餐饮", "探店", "婚礼",
    "家居", "装修", "民宿", "美甲", "健身房", "同城找工作", "店员",
]
ANALYSIS_NEWS_TERMS = [
    "马斯克", "都有谁", "盘点", "谁在做", "深度解读", "新闻", "观察", "分析", "快讯",
]
AUTHOR_NEGATIVE_TERMS = [
    "流量变现", "陪跑", "咨询", "教练", "ip", "商业顾问", "训练营", "社群", "副业",
]


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts).isoformat()


def _file_url(stamp: str, kind: str) -> str:
    return f"/api/xhs/enrich/export/{stamp}/{kind}"


def _trim_log(text: str, chunk: str, limit: int = 10000) -> str:
    merged = f"{text}{chunk}"
    return merged[-limit:]


def _group_runs(limit: int = 12) -> list[dict[str, Any]]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    runs: dict[str, dict[str, Any]] = {}
    for path in OUTPUT_DIR.iterdir():
        match = STAMP_RE.match(path.name)
        if not match:
            continue
        stamp = match.group(1)
        record = runs.setdefault(
            stamp,
            {
                "stamp": stamp,
                "created_at": _iso(path.stat().st_mtime),
                "files": {},
            },
        )
        record["created_at"] = max(record["created_at"], _iso(path.stat().st_mtime))
        if path.name.startswith("xhs_enriched_") and path.suffix == ".csv":
            record["files"]["csv"] = {"name": path.name, "url": _file_url(stamp, "csv")}
        elif path.name.startswith("xhs_enriched_") and path.suffix == ".json":
            record["files"]["json"] = {"name": path.name, "url": _file_url(stamp, "json")}
        elif path.name.startswith("xhs_brief_"):
            record["files"]["brief"] = {"name": path.name, "url": _file_url(stamp, "brief")}
        elif path.name.startswith("xhs_founder_deepdive_"):
            record["files"]["deepdive"] = {"name": path.name, "url": _file_url(stamp, "deepdive")}

    return sorted(runs.values(), key=lambda item: item["stamp"], reverse=True)[:limit]


def _latest_run() -> dict[str, Any] | None:
    runs = _group_runs(limit=24)
    if not runs:
        return None
    for run in runs:
        files = run.get("files", {})
        if files.get("json"):
            return run
    return runs[0]


def _result_path(stamp: str, kind: str) -> Path:
    if kind == "csv":
        return OUTPUT_DIR / f"xhs_enriched_{stamp}.csv"
    if kind == "json":
        return OUTPUT_DIR / f"xhs_enriched_{stamp}.json"
    if kind == "brief":
        return OUTPUT_DIR / f"xhs_brief_{stamp}.md"
    if kind == "deepdive":
        return OUTPUT_DIR / f"xhs_founder_deepdive_{stamp}.md"
    raise ValueError(f"Unsupported export kind: {kind}")


def _hits(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term in text]


def _engagement_score(row: dict[str, Any]) -> int:
    values = []
    for key in ("liked_count", "comment_count", "collected_count"):
        raw = str(row.get(key, "0") or "0").replace(",", "").strip()
        try:
            values.append(int(raw))
        except ValueError:
            values.append(0)
    return min(sum(values) // 20, 12)


def _label_score(row: dict[str, Any]) -> int:
    raw = row.get("relevance_score", row.get("rule_score", 0))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _augment_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    author_priority_counts = Counter()
    enriched_rows: list[dict[str, Any]] = []

    for row in rows:
        merged = row.copy()
        text = " ".join(
            str(merged.get(key, "") or "")
            for key in ("keyword", "title", "desc", "summary", "why_it_matters", "founder_signal")
        ).lower()
        author_text = str(merged.get("author", "") or "").lower()

        team_hits = _hits(text, TEAM_TERMS)
        shipping_hits = _hits(text, SHIPPING_TERMS)
        traction_hits = _hits(text, TRACTION_TERMS)
        funding_hits = _hits(text, FUNDING_TERMS)
        product_hits = _hits(text, PRODUCT_TERMS)
        startup_context_hits = _hits(text, STARTUP_CONTEXT_TERMS)
        negative_hits = _hits(text, NEGATIVE_TERMS)
        generic_hits = _hits(text, GENERIC_TERMS)
        non_startup_hits = _hits(text, NON_STARTUP_TERMS)
        analysis_hits = _hits(text, ANALYSIS_NEWS_TERMS)
        author_negative_hits = _hits(author_text, AUTHOR_NEGATIVE_TERMS)

        signal_groups = sum(
            1 for hits in (team_hits, shipping_hits, traction_hits, funding_hits, product_hits) if hits
        )
        base_score = _label_score(merged)
        score = base_score
        score += min(len(team_hits) * 12, 24)
        score += min(len(shipping_hits) * 12, 24)
        score += min(len(traction_hits) * 15, 30)
        score += min(len(funding_hits) * 18, 32)
        score += min(len(product_hits) * 8, 16)
        score += min(len(startup_context_hits) * 8, 16)
        score += _engagement_score(merged)
        score += min(int(merged.get("freshness_score", 0) or 0) // 12, 8)
        score -= min(len(negative_hits) * 18, 72)
        score -= min(len(generic_hits) * 8, 24)
        score -= min(len(non_startup_hits) * 20, 60)
        score -= min(len(analysis_hits) * 12, 36)
        score -= min(len(author_negative_hits) * 16, 32)
        if not (team_hits or shipping_hits or traction_hits or funding_hits):
            score -= 12
        if team_hits and not (startup_context_hits or shipping_hits or traction_hits or funding_hits or product_hits):
            score -= 28
        score = max(0, min(score, 100))

        weak_team_signal = team_hits and not (
            startup_context_hits or shipping_hits or traction_hits or funding_hits or product_hits
        )

        if (negative_hits and signal_groups == 0) or non_startup_hits:
            bucket = "low_signal"
        elif weak_team_signal or analysis_hits:
            bucket = "review" if score >= 60 else "low_signal"
        elif score >= 88 and signal_groups >= 2 and startup_context_hits and not author_negative_hits:
            bucket = "priority"
        elif score >= 74 and signal_groups >= 1 and (startup_context_hits or shipping_hits or traction_hits or funding_hits):
            bucket = "watchlist"
        elif score >= 60 and (signal_groups >= 1 or product_hits):
            bucket = "review"
        else:
            bucket = "low_signal"

        merged["investor_fit_score"] = score
        merged["opportunity_bucket"] = bucket
        merged["signal_summary"] = ", ".join(
            dict.fromkeys(
                team_hits[:2]
                + shipping_hits[:2]
                + traction_hits[:2]
                + funding_hits[:2]
                + product_hits[:2]
                + startup_context_hits[:2]
            )
        )
        merged["risk_flags"] = ", ".join(
            dict.fromkeys(
                negative_hits[:4] + generic_hits[:2] + non_startup_hits[:2] + analysis_hits[:2] + author_negative_hits[:2]
            )
        )
        merged["operator_signal_count"] = signal_groups
        enriched_rows.append(merged)

        if bucket in {"priority", "watchlist"} and merged.get("author"):
            author_priority_counts[str(merged["author"])] += 1

    for row in enriched_rows:
        author_bonus = 0
        author = str(row.get("author", "") or "")
        if author and author_priority_counts[author] >= 2:
            author_bonus = min((author_priority_counts[author] - 1) * 4, 10)
        if author_bonus:
            row["investor_fit_score"] = min(100, int(row["investor_fit_score"]) + author_bonus)
            if row["opportunity_bucket"] == "review" and int(row["investor_fit_score"]) >= 74:
                row["opportunity_bucket"] = "watchlist"

    enriched_rows.sort(
        key=lambda row: (
            BUCKET_ORDER.get(str(row.get("opportunity_bucket", "")), -1),
            int(row.get("investor_fit_score", 0)),
            int(row.get("relevance_score", row.get("rule_score", 0)) or 0),
        ),
        reverse=True,
    )
    return enriched_rows


def _read_result(stamp: str | None = None) -> dict[str, Any] | None:
    run = next((item for item in _group_runs(limit=24) if item["stamp"] == stamp), None) if stamp else _latest_run()
    if not run:
        return None

    json_path = _result_path(run["stamp"], "json")
    rows: list[dict[str, Any]] = []
    if json_path.exists():
        rows = json.loads(json_path.read_text(encoding="utf-8"))
    rows = _augment_rows(rows)

    label_counts = Counter()
    stage_counts = Counter()
    top_authors = Counter()
    opportunity_counts = Counter()
    for row in rows:
        label_counts[row.get("final_label") or row.get("rule_label") or "unknown"] += 1
        if row.get("founder_stage"):
            stage_counts[str(row["founder_stage"])] += 1
        if row.get("author"):
            top_authors[str(row["author"])] += 1
        if row.get("opportunity_bucket"):
            opportunity_counts[str(row["opportunity_bucket"])] += 1

    brief_path = _result_path(run["stamp"], "brief")
    deepdive_path = _result_path(run["stamp"], "deepdive")
    best_score = max((int(row.get("relevance_score", 0)) for row in rows), default=0)
    best_fit = max((int(row.get("investor_fit_score", 0)) for row in rows), default=0)

    return {
        "run": run,
        "summary": {
            "total_results": len(rows),
            "best_score": best_score,
            "best_investor_fit_score": best_fit,
            "label_counts": dict(label_counts),
            "stage_counts": dict(stage_counts),
            "opportunity_counts": dict(opportunity_counts),
            "top_authors": [{"name": name, "count": count} for name, count in top_authors.most_common(8)],
        },
        "rows": rows,
        "brief_markdown": brief_path.read_text(encoding="utf-8") if brief_path.exists() else "",
        "deepdive_markdown": deepdive_path.read_text(encoding="utf-8") if deepdive_path.exists() else "",
    }


def get_status() -> dict[str, Any]:
    latest = _latest_run()
    dependencies = _dependency_status()
    with RUN_LOCK:
        state = dict(RUN_STATE)
    # Keep the reported latest result aligned with what already exists on disk,
    # even when files were produced outside the current FastAPI process.
    if latest and not state.get("running"):
        state["last_result_stamp"] = latest["stamp"]
    return {
        "script_path": str(SCRIPT_PATH),
        "script_exists": _script_is_ready(),
        "output_dir": str(OUTPUT_DIR),
        "state": state,
        "latest_run": latest,
        "recent_runs": _group_runs(),
        "dependencies": {
            "xhs": dependencies["xhs"],
            "openclaw": dependencies["openclaw"],
        },
        "run_ready": dependencies["run_ready"],
        "run_blockers": dependencies["run_blockers"],
    }


def start_run(config: dict[str, Any]) -> dict[str, Any]:
    dependencies = _dependency_status()
    with RUN_LOCK:
        if RUN_STATE["running"]:
            return {"status": "busy", "state": dict(RUN_STATE)}
        if not _script_is_ready():
            return {
                "status": "error",
                "state": dict(RUN_STATE),
                "error": (
                    "XHS enrichment script is not configured. "
                    f"Current path: {SCRIPT_PATH}. Replace backend/external/xhs_enrich.py "
                    "with your real script or set XHS_ENRICH_SCRIPT."
                ),
            }
        if not dependencies["xhs"]["installed"]:
            return {
                "status": "error",
                "state": dict(RUN_STATE),
                "error": "未安装 xhs CLI。先在宿主机执行 `uv tool install xiaohongshu-cli`。",
            }
        if not dependencies["xhs"]["logged_in"]:
            return {
                "status": "error",
                "state": dict(RUN_STATE),
                "error": "xhs 尚未登录。先在宿主机执行 `xhs login`，再回来启动抓取。",
            }

        command = ["python3", str(SCRIPT_PATH)]
        keywords = [str(item).strip() for item in (config.get("keywords") or []) if str(item).strip()]
        mode = str(config.get("mode") or "founder")
        pages = max(1, int(config.get("pages") or 1))
        batch_size = max(1, int(config.get("batch_size") or 8))
        max_results = max(0, int(config.get("max_results") or 0))
        deep_dive_authors = max(0, int(config.get("deep_dive_authors") or 0))
        goal = str(config.get("goal") or "").strip()
        requested_no_openclaw = bool(config.get("no_openclaw"))
        no_openclaw = requested_no_openclaw or not dependencies["openclaw"]["installed"]
        runtime_notes: list[str] = []
        if not requested_no_openclaw and not dependencies["openclaw"]["installed"]:
            runtime_notes.append("OpenClaw 未安装，已自动切换到启发式模式。")

        command.extend(["--mode", mode, "--pages", str(pages), "--batch-size", str(batch_size)])
        if keywords:
            command.extend(["--keywords", *keywords])
        if goal:
            command.extend(["--goal", goal])
        if max_results:
            command.extend(["--max-results", str(max_results)])
        if deep_dive_authors:
            command.extend(["--deep-dive-authors", str(deep_dive_authors)])
        if no_openclaw:
            command.append("--no-openclaw")

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        command.extend(["--outdir", str(OUTPUT_DIR)])

        RUN_STATE.update(
            {
                "running": True,
                "started_at": datetime.utcnow().isoformat() + "Z",
                "finished_at": None,
                "last_exit_code": None,
                "last_error": None,
                "last_stdout": "",
                "last_stderr": "",
                "last_command": command,
                "last_result_stamp": None,
                "last_config": {
                    "keywords": keywords,
                    "mode": mode,
                    "pages": pages,
                    "goal": goal,
                    "batch_size": batch_size,
                    "max_results": max_results,
                    "no_openclaw": no_openclaw,
                    "deep_dive_authors": deep_dive_authors,
                },
                "runtime_notes": runtime_notes,
            }
        )

    def runner() -> None:
        try:
            proc = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=str(Path(__file__).resolve().parents[2]),
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
            stdout_parts: list[str] = []
            stderr_parts: list[str] = []

            def pump(stream: Any, key: str, sink: list[str]) -> None:
                if stream is None:
                    return
                try:
                    for line in iter(stream.readline, ""):
                        sink.append(line)
                        with RUN_LOCK:
                            RUN_STATE[key] = _trim_log(str(RUN_STATE.get(key, "")), line)
                finally:
                    stream.close()

            stdout_thread = threading.Thread(target=pump, args=(proc.stdout, "last_stdout", stdout_parts), daemon=True)
            stderr_thread = threading.Thread(target=pump, args=(proc.stderr, "last_stderr", stderr_parts), daemon=True)
            stdout_thread.start()
            stderr_thread.start()
            return_code = proc.wait()
            stdout_thread.join(timeout=1)
            stderr_thread.join(timeout=1)
            latest = _latest_run()
            final_stdout = "".join(stdout_parts)
            final_stderr = "".join(stderr_parts)
            error_text = final_stderr.strip()
            if return_code and not error_text:
                error_text = f"Process exited with code {return_code}"
            with RUN_LOCK:
                RUN_STATE.update(
                    {
                        "running": False,
                        "finished_at": datetime.utcnow().isoformat() + "Z",
                        "last_exit_code": return_code,
                        "last_error": error_text if return_code else None,
                        "last_stdout": final_stdout[-10000:],
                        "last_stderr": final_stderr[-10000:],
                        "last_result_stamp": latest["stamp"] if latest and return_code == 0 else None,
                    }
                )
        except Exception as exc:
            with RUN_LOCK:
                RUN_STATE.update(
                    {
                        "running": False,
                        "finished_at": datetime.utcnow().isoformat() + "Z",
                        "last_exit_code": -1,
                        "last_error": str(exc),
                        "last_stderr": str(exc),
                    }
                )

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()

    with RUN_LOCK:
        return {"status": "started", "state": dict(RUN_STATE)}


def get_result(stamp: str | None = None) -> dict[str, Any] | None:
    return _read_result(stamp)


def get_export_path(stamp: str, kind: str) -> Path:
    path = _result_path(stamp, kind)
    if not path.exists():
        raise FileNotFoundError(str(path))
    return path
