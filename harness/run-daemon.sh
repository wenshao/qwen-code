#!/bin/bash
# run-daemon.sh <arm: pr|base> <scenario-name>   (env toggles below)
set -uo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
ARM="$1"; SCEN="$2"
WT="/root/git/pr10893-$ARM"
RUN="$H/runs/$SCEN"
rm -rf "$RUN"; mkdir -p "$RUN/home" "$RUN/ws"
export QWEN_HOME="$RUN/home"
CARDS="${CARDS:-false}"
BLOCK="${BLOCK_STREAMING:-off}"
cat > "$RUN/home/settings.json" <<JSON
{
  "general": { "language": "en" },
  "tools": { "approvalMode": "yolo" },
  "security": { "auth": { "selectedType": "openai" }, "folderTrust": { "enabled": false } },
  "privacy": { "usageStatisticsEnabled": false },
  "telemetry": { "enabled": false },
  "channels": {
    "dingtalk": {
      "type": "dingtalk",
      "approvalMode": "yolo",
      "clientId": "harnessClientId",
      "clientSecret": "harnessClientSecret",
      "useConnectionManager": false,
      "senderPolicy": "open",
      "groupPolicy": "${GROUP_POLICY:-open}",
      "blockStreaming": "$BLOCK",
      "cwd": "$RUN/ws",
      "webhooks": { "sources": { "harness": { "secret": "harness-webhook-secret", "targets": {
        "g1": { "chatId": "cidGroup1", "senderId": "owner-1", "isGroup": true },
        "d1": { "chatId": "owner-1", "senderId": "owner-1", "isGroup": false }
      } } } },
      "interactiveCards": { "enabled": $CARDS, "statusCard": { "enabled": $CARDS }, "questionCard": { "enabled": false }, "permissionCard": { "enabled": false } }
    }
  }
}
JSON
cd "$RUN/ws" && git init -q . 2>/dev/null; echo "harness" > "$RUN/ws/README.md"
export NODE_EXTRA_CA_CERTS="$H/certs/ca.pem"
export OPENAI_BASE_URL="http://127.0.0.1:${MODEL_PORT:-4499}/v1"
export OPENAI_API_KEY="harness-key"
export OPENAI_MODEL="harness-model"
export QWEN_DEFAULT_AUTH_TYPE=openai
export NO_COLOR=1
cd "$WT"
nohup node dist/cli.js serve --port ${DAEMON_PORT:-4477} --token HARNESSTOKEN --workspace "$RUN/ws" --channel dingtalk \
  > "$RUN/daemon.log" 2>&1 &
echo $! > "$RUN/daemon.pid"
echo "$RUN"
