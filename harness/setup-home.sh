#!/bin/bash
# Builds a throwaway HOME + workspace. $1 = goalCheckpointTimeoutSeconds (default 8).
set -euo pipefail
source /root/git/h11576/env.sh
TMO=${1:-8}
rm -rf "$HOME_T" "$WS"
mkdir -p "$QWEN_HOME" "$WS"
cat > "$QWEN_HOME/settings.json" <<JSON
{
  "general": { "enableAutoUpdate": false, "checkpointing": { "enabled": false } },
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "mock-model", "goalCheckpointTimeoutSeconds": $TMO },
  "ui": { "theme": "Default" },
  "privacy": { "usageStatisticsEnabled": false },
  "telemetry": { "enabled": false }
}
JSON
cat > "$WS/QWEN.md" <<'MD'
Test workspace for PR 11576 verification.
MD
git -C "$WS" init -q 2>/dev/null || true
echo "HOME_T=$HOME_T WS=$WS timeout=${TMO}s"
