#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

need_cmd() {
  local cmd="$1"
  local install_hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "" >&2
    echo "❌ Missing required command: $cmd" >&2
    echo "" >&2
    echo "👉 How to install:" >&2
    echo "$install_hint" >&2
    echo "" >&2
    exit 1
  fi
}

need_cmd python3 \
"  macOS:   brew install python   (https://brew.sh)
  Linux:   sudo apt install python3  # or your distro's package manager
  Note:    Python 3.9+ is required"

need_cmd npm \
"  Install Node.js (which includes npm):
  macOS:   brew install node
  Linux:   sudo apt install nodejs npm
  All:     https://nodejs.org/en/download
  Note:    Node.js 18+ is recommended"

need_cmd uv \
"  macOS / Linux (recommended):
    curl -LsSf https://astral.sh/uv/install.sh | sh
  Then restart your terminal (or run: source \$HOME/.local/bin/env)
  Docs:    https://docs.astral.sh/uv/getting-started/installation/"

echo "Ensuring xhs CLI is installed and up to date..."
uv tool install --upgrade --with socksio xiaohongshu-cli

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
echo "xhs version:"
xhs --version || true
echo
xhs_status_output="$(xhs status 2>/dev/null || true)"
if echo "$xhs_status_output" | grep -q "guest: false"; then
  echo "xhs login status: ready"
else
  echo "xhs login status: not ready (guest session or not logged in)"
  echo "Run this once on your host machine before starting the app:"
  echo
  echo "  xhs login"
  echo "  # or, if browser cookie extraction keeps failing:"
  echo "  xhs login --qrcode"
  echo
fi

echo "Next step:"
echo
echo "  $ROOT_DIR/scripts/run-local.sh"
