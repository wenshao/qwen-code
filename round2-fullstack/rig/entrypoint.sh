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

cat > /root/.qwen/settings.json <<'JSON'
{
  "security": {
    "auth": { "selectedType": "openai" },
    "folderTrust": { "enabled": false }
  },
  "privacy": { "usageStatisticsEnabled": false },
  "tools": { "approvalMode": "yolo" },
  "channels": {
    "dt": {
      "type": "dingtalk",
      "clientId": "probe-appkey",
      "clientSecret": "probe-appsecret",
      "senderPolicy": "open",
      "sessionScope": "user",
      "cwd": "/work",
      "model": "fake-model",
      "useConnectionManager": true,
      "interactiveCards": { "enabled": true }
    }
  }
}
JSON

echo "hosts:"; getent hosts api.dingtalk.com oapi.dingtalk.com || true
exec node /rig/rig.mjs "$@"
