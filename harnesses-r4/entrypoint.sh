#!/bin/bash
set -eu
CERTDIR=/rig/certs
mkdir -p "$CERTDIR" /work /root/.qwen /out
if [ ! -f "$CERTDIR/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
    -keyout "$CERTDIR/key.pem" -out "$CERTDIR/cert.pem" \
    -subj "/CN=api.dingtalk.com" \
    -addext "subjectAltName=DNS:api.dingtalk.com,DNS:oapi.dingtalk.com,IP:127.0.0.1" \
    >/dev/null 2>&1
fi
export NODE_EXTRA_CA_CERTS="$CERTDIR/cert.pem"

LANGUAGE="${LANGUAGE:-}"
PERM_CARD="${PERM_CARD:-true}"
QUESTION_CARD="${QUESTION_CARD:-true}"
PERM_TIMEOUT_MS="${PERM_TIMEOUT_MS:-60000}"
SESSION_SCOPE="${SESSION_SCOPE:-user}"
APPROVAL_MODE="${APPROVAL_MODE:-}"
if [ -n "$APPROVAL_MODE" ]; then APPROVAL_LINE="\"approvalMode\": \"$APPROVAL_MODE\","; else APPROVAL_LINE=""; fi

if [ -n "$LANGUAGE" ]; then
  GENERAL="\"general\": { \"language\": \"$LANGUAGE\" },"
else
  GENERAL=""
fi

cat > /root/.qwen/settings.json <<JSON
{
  $GENERAL
  "security": {
    "auth": { "selectedType": "openai" },
    "folderTrust": { "enabled": false }
  },
  "privacy": { "usageStatisticsEnabled": false },
  "channels": {
    "dt": {
      "type": "dingtalk",
      $APPROVAL_LINE
      "clientId": "probe-appkey",
      "clientSecret": "probe-appsecret",
      "senderPolicy": "open",
      "groupPolicy": "open",
      "sessionScope": "$SESSION_SCOPE",
      "cwd": "/work",
      "model": "fake-model",
      "useConnectionManager": true,
      "interactiveCards": {
        "enabled": true,
        "statusCard": { "enabled": true },
        "questionCard": { "enabled": $QUESTION_CARD, "timeoutMs": 60000 },
        "permissionCard": { "enabled": $PERM_CARD, "timeoutMs": $PERM_TIMEOUT_MS }
      }
    }
  }
}
JSON

echo "settings:"; cat /root/.qwen/settings.json
echo "hosts:"; getent hosts api.dingtalk.com oapi.dingtalk.com || true
exec node /rig/rig.mjs "$@"
