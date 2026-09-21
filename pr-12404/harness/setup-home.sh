#!/bin/bash
# Fresh isolated HOME + runtime; trusted workspace; openai auth to the mock.
set -euo pipefail
source /root/git/h12404-e2e/env.sh
rm -rf "$HOME_QWEN" "$QWEN_RUNTIME_DIR"
mkdir -p "$HOME_QWEN/.qwen" "$QWEN_RUNTIME_DIR"
cat > "$HOME_QWEN/.qwen/settings.json" <<JSON
{ "security": { "folderTrust": { "enabled": true }, "auth": { "selectedType": "openai" } },
  "model": { "name": "mock-model" } }
JSON
cat > "$HOME_QWEN/.qwen/trustedFolders.json" <<JSON
{ "$WS": "TRUST_FOLDER" }
JSON
# Link the probe extension with the PR build's CLI (same code path on both arms).
HOME="$HOME_QWEN" node "$WT/.arm-pr/cli.js" extensions link "$H/ext-src/browser-kit" <<< "y" 2>&1 | tail -3 || true
ls -la "$HOME_QWEN/.qwen/extensions" 2>/dev/null || true
echo setup-home done
