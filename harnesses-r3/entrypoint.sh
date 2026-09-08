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

LOCALE="${LOCALE:-en}"
PERMCARD="${PERMCARD:-true}"

if [ "$LOCALE" = "__default__" ]; then GENERAL=""; else GENERAL="\"general\": { \"language\": \"${LOCALE}\" },"; fi
cat > /root/.qwen/settings.json <<JSON
{
  ${GENERAL}
  "security": {
    "auth": { "selectedType": "openai" },
    "folderTrust": { "enabled": false }
  },
  "privacy": { "usageStatisticsEnabled": false },
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
      "interactiveCards": {
        "enabled": true,
        "permissionCard": { "enabled": ${PERMCARD}, "timeoutMs": 600000 }
      }
    }
  }
}
JSON
echo "settings.json:"; cat /root/.qwen/settings.json
echo "hosts:"; getent hosts api.dingtalk.com oapi.dingtalk.com || true
rm -f /work/PERMIT_10457.txt
exec node /rig/rig10457.mjs "$@"
