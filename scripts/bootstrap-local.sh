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
need_cmd uv

if ! command -v xhs >/dev/null 2>&1; then
  echo "Installing xhs CLI via uv..."
  uv tool install xiaohongshu-cli
fi

echo "Preparing backend virtualenv..."
cd "$ROOT_DIR/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
"$ROOT_DIR/backend/.venv/bin/python" -m pip install -r requirements.txt

echo "Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install

echo
if xhs status >/dev/null 2>&1; then
  echo "xhs login status: ready"
else
  echo "xhs login status: not ready"
  echo "Run this once on your host machine before starting the app:"
  echo
  echo "  xhs login"
  echo
fi

echo "Next step:"
echo
echo "  $ROOT_DIR/scripts/run-local.sh"
