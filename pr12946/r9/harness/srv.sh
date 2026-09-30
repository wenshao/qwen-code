#!/bin/bash
# srv.sh <run> <stop|start> <name> <transport> <port> [extra...]
RUN=$1; OP=$2; NAME=$3; TR=$4; PORT=$5; shift 5
S=$(cd "$(dirname "$0")/.." && pwd)
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
if [ "$OP" = stop ]; then kill "$(cat "$RUN/srv-$NAME.pid")"; exit 0; fi
RIG_SDK=$(cat "$RUN/sdk-path") $NODE22 "$S/rig/mcp-server.mjs" --transport "$TR" --port "$PORT" --name "$NAME" --ledger "$RUN/ledger.jsonl" "$@" >> "$RUN/srv-$NAME.log" 2>&1 &
echo $! > "$RUN/srv-$NAME.pid"
