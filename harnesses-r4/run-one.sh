#!/bin/bash
# usage: run-one.sh <variant> <scenario> [env KEY=VAL ...]
# variant maps to a dist directory copied under $HOME (Docker Desktop only
# shares $HOME, so /private/tmp mounts silently come up empty).
set -u
VARIANT="$1"; SCENARIO="$2"; shift 2
DIST="$HOME/git/rig-10457/dists/$VARIANT"
if [ ! -f "$DIST/cli.js" ]; then echo "missing dist for variant $VARIANT ($DIST)"; exit 2; fi
RIG="$(cd "$(dirname "$0")" && pwd)"
ENVARGS=()
for kv in "$@"; do ENVARGS+=(-e "$kv"); done
docker run --rm --network none \
  --add-host api.dingtalk.com:127.0.0.1 \
  --add-host oapi.dingtalk.com:127.0.0.1 \
  -v "$DIST":/app/dist:ro \
  -v "$RIG/out":/out \
  -e SCENARIO="$SCENARIO" -e VARIANT="$VARIANT" \
  -e CLI_PATH=/app/dist/cli.js -e OUT_DIR=/out \
  "${ENVARGS[@]}" \
  qwen-dingtalk-perm-rig
