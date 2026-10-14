#!/bin/bash
# usage: up.sh <arm:head|base> <run-name> <daemon-port> <fake-port> [extra settings json fragment]
# Starts a standalone fake provider and a real `qwen serve` daemon (bundled
# dist/cli.js of the arm's worktree) in an isolated HOME/QWEN_HOME. PIDs go to
# the run dir; stop with down.sh <run-dir> (kills by PID only).
set -euo pipefail
ARM=${1:?arm}; RUN=${2:?run}; PORT=${3:?port}; FAKE=${4:?fakeport}; EXTRA=${5:-}
ROOT=/Users/wenshao/git/pr13902-arms
WT=$ROOT/$ARM
R=$ROOT/runs/$RUN-$ARM
rm -rf "${R:?}"; mkdir -p "$R/home" "$R/qwen-home" "$R/runtime" "$R/ws"
TOK=pr13902-$(openssl rand -hex 8)
echo "$TOK" > "$R/token"
cat > "$R/qwen-home/settings.json" <<JSON
{"security":{"auth":{"selectedType":"openai"}},"general":{"enableAutoUpdate":false,"disableUpdateNag":true},"model":{"name":"fake-model"},"experimental":{"agentTeam":true}${EXTRA}}
JSON
echo "# PR 13902 probe workspace ($ARM/$RUN)" > "$R/ws/README.md"
NODE_BIN=$(dirname "$(which node)")
( cd "$R"; FAKE_PORT=$FAKE FAKE_LEDGER="$R/fake-ledger.jsonl" FAKE_WS="$R/ws" nohup node "$ROOT/rig/fake-openai.mjs" > "$R/fake.log" 2>&1 & echo $! > "$R/fake.pid" )
cd "$R/ws"
nohup env -i HOME="$R/home" PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  QWEN_HOME="$R/qwen-home" QWEN_RUNTIME_DIR="$R/runtime" \
  OPENAI_API_KEY=dummy OPENAI_BASE_URL="http://127.0.0.1:$FAKE/v1" OPENAI_MODEL=fake-model \
  QWEN_CODE_ENABLE_AGENT_TEAM=1 QWEN_CODE_NO_RELAUNCH=true NO_COLOR=1 \
  node "$WT/dist/cli.js" serve --port "$PORT" --token "$TOK" --workspace "$R/ws" \
  > "$R/daemon.log" 2>&1 &
echo $! > "$R/daemon.pid"
for i in $(seq 1 120); do
  if curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" "http://127.0.0.1:$PORT/health" | grep -q 200; then
    echo "UP arm=$ARM run=$RUN port=$PORT fake=$FAKE dir=$R daemon_pid=$(cat $R/daemon.pid) fake_pid=$(cat $R/fake.pid)"; exit 0; fi
  sleep 0.5
done
echo "daemon did not come up"; tail -30 "$R/daemon.log"; exit 1
