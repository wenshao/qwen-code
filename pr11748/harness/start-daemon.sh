#!/usr/bin/env bash
# usage: start-daemon.sh <name> <root-with-packages/cli/dist> <web-shell-dist-dir> <port> [ui-language]
# Runs a real `qwen serve` (loopback, tokenless) with an isolated HOME, a
# trusted throwaway workspace and the fake OpenAI stub on :4898. The Web Shell
# served at / is <web-shell-dist-dir>, linked into <root>/packages/web-shell/dist.
set -euo pipefail
NAME=$1 ROOT=$2 WS=$3 PORT=$4 UILANG=${5:-}
BASE=/root/git/pr11748-harness/run/$NAME
rm -rf "$BASE"
mkdir -p "$BASE/home/.qwen" "$BASE/workspace"
GENERAL=""
[ -n "$UILANG" ] && GENERAL="\"general\": { \"language\": \"$UILANG\" },"
cat > "$BASE/home/.qwen/settings.json" <<JSON
{
  $GENERAL
  "security": { "folderTrust": { "enabled": false }, "auth": { "selectedType": "openai" } },
  "model": { "name": "fake-model" },
  "modelProviders": { "openai": [ { "id": "fake-model", "name": "fake-model", "envKey": "OPENAI_API_KEY", "baseUrl": "http://127.0.0.1:4898/v1" } ] }
}
JSON
echo "# $NAME workspace" > "$BASE/workspace/README.md"
if [ -L "$ROOT/packages/web-shell/dist" ] || [ ! -e "$ROOT/packages/web-shell/dist" ]; then
  rm -f "$ROOT/packages/web-shell/dist"
  ln -s "$WS" "$ROOT/packages/web-shell/dist"
else
  echo "refusing to replace a real dist dir at $ROOT/packages/web-shell/dist" >&2
  exit 1
fi
echo "$NAME root=$ROOT web-shell=$WS ($(cat "$WS/.ARM_SHA" 2>/dev/null)) port=$PORT lang=${UILANG:-default}"
cd "$BASE/workspace"
exec env -u QWEN_SERVER_TOKEN HOME="$BASE/home" OPENAI_API_KEY=fake SHELL=/bin/bash \
  node "$ROOT/packages/cli/dist/index.js" serve --port "$PORT" --workspace "$BASE/workspace" --max-sessions 0
