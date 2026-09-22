#!/bin/bash
# Fresh isolated HOME + runtime; trusted workspace; openai auth to the mock; linked probe extension.
set -euo pipefail
source /root/verify/pr12404-r2-e2e/env.sh
rm -rf "$HOME_QWEN" "$QWEN_RUNTIME_DIR"
mkdir -p "$HOME_QWEN/.qwen" "$QWEN_RUNTIME_DIR"
cat > "$HOME_QWEN/.qwen/settings.json" <<JSON
{ "security": { "folderTrust": { "enabled": true }, "auth": { "selectedType": "openai" } },
  "model": { "name": "mock-model" } }
JSON
cat > "$HOME_QWEN/.qwen/trustedFolders.json" <<JSON
{ "$WS": "TRUST_FOLDER" }
JSON
HOME="$HOME_QWEN" node "$WT/.arm-head/cli.js" extensions link "$H/ext-src/browser-kit" <<< "y" 2>&1 | tail -2 || true
ls "$HOME_QWEN/.qwen/extensions" 2>/dev/null || true
echo setup-home done
