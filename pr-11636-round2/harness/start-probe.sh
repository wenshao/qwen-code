#!/bin/bash
set -euo pipefail
export ARM="${1:-head}"
H="$(cd "$(dirname "$0")" && pwd)"
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
if [ "$ARM" = pre ]; then WT="$H/../wtPRE"; PORT=4657; MOCK_PORT=18657; PROBE_PORT=19657;
else WT="$H/../wtHEAD"; PORT=4656; MOCK_PORT=18656; PROBE_PORT=19656; fi
WT="$(cd "$WT" && pwd)"
WS="$H/pws-$ARM"; HOME_Q="$H/phome-$ARM"; RT="$H/pruntime-$ARM"
TOKEN=T0KEN11636P
mkdir -p "$WS" "$RT" "$HOME_Q/.qwen" "$H/out"
[ -f "$HOME_Q/.qwen/settings.json" ] || cp "$H/settings.json" "$HOME_Q/.qwen/settings.json"
[ -d "$WS/.git" ] || (cd "$WS" && git init -q && echo "# pws $ARM" > README.md && git add . && git -c user.email=h@h -c user.name=h commit -qm init)
if ! curl -fsS -m 1 "http://127.0.0.1:$MOCK_PORT/__log" >/dev/null 2>&1; then
  MOCK_PORT=$MOCK_PORT MOCK_OUT="$H/out/pmock-$ARM" nohup node "$H/mock-llm.mjs" > "$H/out/pmock-$ARM.log" 2>&1 &
  sleep 0.6
fi
cd "$WS"
HOME="$HOME_Q" QWEN_RUNTIME_DIR="$RT" PROBE_PORT=$PROBE_PORT \
OPENAI_API_KEY=mock-key OPENAI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" OPENAI_MODEL=mock-model \
nohup node --import "$H/probe-register.mjs" "$WT/packages/cli/dist/index.js" serve --port "$PORT" --token "$TOKEN" --workspace "$WS" \
  > "$H/out/pdaemon-$ARM.log" 2>&1 &
echo $! > "$H/out/pdaemon-$ARM.pid"
for i in $(seq 1 160); do
  if curl -fsS -m 2 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "probe daemon up port=$PORT probe=$PROBE_PORT arm=$ARM wt=$WT"
    curl -fsS -m 2 "http://127.0.0.1:$PROBE_PORT/" || echo "(probe server not answering)"
    exit 0
  fi
  sleep 0.5
done
echo "probe daemon did NOT come up"; tail -40 "$H/out/pdaemon-$ARM.log"; exit 1
