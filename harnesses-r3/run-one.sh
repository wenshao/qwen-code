#!/bin/bash
# usage: run-one.sh <arm:merged|main> <scenario> [locale] [permcard]
set -u
ARM="$1"; SCENARIO="$2"; LOCALE="${3:-en}"; PERMCARD="${4:-true}"
DIST="/Users/wenshao/git/rig-10457-r3/trees/$ARM/dist"
RIG="/Users/wenshao/git/rig-10457-r3/fullstack"
docker run --rm --network none \
  --add-host api.dingtalk.com:127.0.0.1 \
  --add-host oapi.dingtalk.com:127.0.0.1 \
  -v "$DIST":/app/dist:ro \
  -v "$RIG/out":/out \
  -e SCENARIO="$SCENARIO" -e VARIANT="$ARM" -e LOCALE="$LOCALE" -e PERMCARD="$PERMCARD" \
  -e CLI_PATH=/app/dist/cli.js -e OUT_DIR=/out \
  qwen-10457-rig
