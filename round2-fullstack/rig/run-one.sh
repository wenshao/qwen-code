#!/bin/bash
# usage: run-one.sh <variant:head|base> <scenario> [client-model]
set -u
VARIANT="$1"; SCENARIO="$2"; MODEL="${3:-m2}"
case "$VARIANT" in
  head) DIST=/Users/wenshao/git/qwen-10357/dist ;;
  base) DIST=/Users/wenshao/git/qwen-10357-base/dist ;;
  *) echo "bad variant"; exit 2 ;;
esac
RIG="$(cd "$(dirname "$0")" && pwd)"
docker run --rm --network none \
  --add-host api.dingtalk.com:127.0.0.1 \
  --add-host oapi.dingtalk.com:127.0.0.1 \
  -v "$DIST":/app/dist:ro \
  -v "$RIG/out":/out \
  -e SCENARIO="$SCENARIO" -e VARIANT="$VARIANT" -e CLIENT_MODEL="$MODEL" \
  -e CLI_PATH=/app/dist/cli.js -e OUT_DIR=/out \
  qwen-dingtalk-rig
