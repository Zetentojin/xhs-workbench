#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd python3
need_cmd npm
need_cmd xhs

if [ ! -x "$ROOT_DIR/backend/.venv/bin/python" ]; then
  echo "Backend dependencies are not ready. Run ./scripts/bootstrap-local.sh first." >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "Frontend dependencies are not ready. Run ./scripts/bootstrap-local.sh first." >&2
  exit 1
fi

if ! xhs status >/dev/null 2>&1; then
  echo "xhs is not logged in yet. Run this first on your host machine:" >&2
  echo >&2
  echo "  xhs login" >&2
  echo >&2
  exit 1
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting backend on http://127.0.0.1:8000 ..."
cd "$ROOT_DIR/backend"
PUBLIC_ACCESS_ENABLED=1 \
BACKEND_CORS_ORIGINS="http://127.0.0.1:3000,http://localhost:3000" \
"$ROOT_DIR/backend/.venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Starting frontend on http://127.0.0.1:3000 ..."
cd "$ROOT_DIR/frontend"
NEXT_PUBLIC_PUBLIC_ACCESS=1 \
BACKEND_URL="http://127.0.0.1:8000" \
npm run dev
