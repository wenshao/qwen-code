#!/usr/bin/env bash
# usage: start-daemon.sh <armDistDir> <runDir> <port> <fakeBase>
# Fresh isolated QWEN_HOME/HOME; three registered workspaces:
#   primary (trusted), secondary (trusted), untrusted (DO_NOT_TRUST)
set -euo pipefail
ARM=$1; RUN=$2; PORT=$3; FAKE=$4
mkdir -p "$RUN"/{primary,secondary,untrusted,home/.qwen,runtime}
for w in primary secondary untrusted; do echo "# $w workspace" > "$RUN/$w/README.md"; done
P=$(realpath "$RUN/primary"); S=$(realpath "$RUN/secondary"); U=$(realpath "$RUN/untrusted")
cat > "$RUN/home/.qwen/settings.json" <<JSON
{
  "security": { "auth": { "selectedType": "openai" }, "folderTrust": { "enabled": false } },
  "model": { "name": "fake-model" },
  "modelProviders": { "openai": [ { "id": "fake-model", "name": "fake-model", "envKey": "OPENAI_API_KEY", "baseUrl": "$FAKE/v1" } ] },
  "tools": { "approvalMode": "default" },
  "telemetry": { "enabled": false },
  "privacy": { "usageStatisticsEnabled": false },
  "general": { "disableAutoUpdate": true, "disableUpdateNag": true }
}
JSON
cat > "$RUN/home/.qwen/trustedFolders.json" <<JSON
{ "$P": "TRUST_FOLDER", "$S": "TRUST_FOLDER", "$U": "DO_NOT_TRUST" }
JSON
export HOME="$RUN/home" QWEN_HOME="$RUN/home/.qwen" QWEN_RUNTIME_DIR="$RUN/runtime"
export OPENAI_API_KEY=dummy-key OPENAI_BASE_URL="$FAKE/v1" OPENAI_MODEL=fake-model
export NO_PROXY='127.0.0.1,localhost' no_proxy='127.0.0.1,localhost'
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export PATH=/root/verify/pr13468/ssh/bin:$PATH
exec node "$ARM/cli.js" serve --port "$PORT" --token tok13468 --workspace "$P"
