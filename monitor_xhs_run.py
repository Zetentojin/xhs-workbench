#!/usr/bin/env python3
"""Poll the XHS workbench status endpoint and print concise progress updates."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor XHS enrichment runs from the background.")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8000/api/xhs/enrich/status",
        help="Status endpoint to poll",
    )
    parser.add_argument("--interval", type=int, default=5, help="Polling interval in seconds")
    parser.add_argument(
        "--heartbeat",
        type=int,
        default=60,
        help="Emit a heartbeat line even when nothing changes",
    )
    parser.add_argument(
        "--stall-seconds",
        type=int,
        default=180,
        help="Warn when the last log line has not changed for this many seconds",
    )
    parser.add_argument("--log-file", help="Optional file to append monitor output to")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Fetch once and exit",
    )
    return parser.parse_args()


def fetch_status(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def format_now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def extract_last_line(text: str) -> str:
    for line in reversed(text.splitlines()):
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def format_elapsed(started_at: str | None) -> str:
    started = parse_iso(started_at)
    if not started:
        return "n/a"
    now = datetime.now(timezone.utc)
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    seconds = max(0, int((now - started).total_seconds()))
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{sec:02d}"


def emit(line: str, log_file: Path | None) -> None:
    text = f"[{format_now()}] {line}"
    print(text, flush=True)
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")


def summarize(status: dict[str, Any]) -> str:
    state = status.get("state", {})
    latest = status.get("latest_run") or {}
    latest_stamp = latest.get("stamp") or state.get("last_result_stamp") or "none"
    return (
        f"running={state.get('running')} "
        f"elapsed={format_elapsed(state.get('started_at'))} "
        f"latest={latest_stamp} "
        f"exit={state.get('last_exit_code')}"
    )


def main() -> int:
    args = parse_args()
    log_file = Path(args.log_file).expanduser() if args.log_file else None

    last_running: bool | None = None
    last_log_line = ""
    last_error_line = ""
    last_log_change_at = time.monotonic()
    last_emit_at = 0.0

    while True:
        try:
            status = fetch_status(args.url)
        except URLError as exc:
            emit(f"monitor error: cannot reach {args.url} ({exc})", log_file)
            if args.once:
                return 1
            time.sleep(args.interval)
            continue

        state = status.get("state", {})
        running = bool(state.get("running"))
        stdout_line = extract_last_line(str(state.get("last_stdout") or ""))
        stderr_line = extract_last_line(str(state.get("last_stderr") or ""))
        now_mono = time.monotonic()

        should_emit = False
        lines: list[str] = []

        if last_running is None or running != last_running:
            should_emit = True
            lines.append(f"state changed: {summarize(status)}")

        if stdout_line and stdout_line != last_log_line:
            should_emit = True
            last_log_change_at = now_mono
            lines.append(f"log: {stdout_line}")

        if stderr_line and stderr_line != last_error_line:
            should_emit = True
            lines.append(f"stderr: {stderr_line}")

        if running and stdout_line and now_mono - last_log_change_at >= args.stall_seconds:
            should_emit = True
            last_log_change_at = now_mono
            lines.append(f"warning: no new log line for {args.stall_seconds}s, last='{stdout_line}'")

        if not should_emit and args.heartbeat > 0 and now_mono - last_emit_at >= args.heartbeat:
            should_emit = True
            lines.append(f"heartbeat: {summarize(status)}")

        if should_emit:
            for line in lines:
                emit(line, log_file)
            last_emit_at = now_mono

        last_running = running
        last_log_line = stdout_line or last_log_line
        last_error_line = stderr_line or last_error_line

        if args.once:
            return 0

        if not running and state.get("finished_at"):
            emit(f"completed: {summarize(status)}", log_file)
            return 0

        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
