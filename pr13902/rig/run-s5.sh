#!/bin/bash
# usage: run-s5.sh <mode> <arm> <runName>   (raw ACP host, own fake on 43920)
MODE=${1:?mode}; ARM=${2:?arm}; NAME=${3:?run name}
R=/Users/wenshao/git/pr13902-arms/runs/$NAME; rm -rf "${R:?}"; mkdir -p "$R/ws"
if lsof -nP -iTCP:43920 -sTCP:LISTEN >/dev/null 2>&1; then echo "port 43920 busy"; exit 1; fi
(cd "$R"; FAKE_PORT=43920 FAKE_LEDGER=$R/fake-ledger.jsonl FAKE_WS=$R/ws FAKE_TM_SLOW_MS=7000 nohup node /Users/wenshao/git/pr13902-arms/rig/fake-openai.mjs > $R/fake.log 2>&1 & echo $! > $R/fake.pid)
sleep 0.5
node /Users/wenshao/git/pr13902-arms/rig/s5-acp.mjs "$R" /Users/wenshao/git/pr13902-arms/$ARM 43920 "$MODE" > "$R/driver.log" 2>&1
P=$(cat "$R/fake.pid"); kill "$P"; for i in $(seq 1 40); do kill -0 "$P" 2>/dev/null || break; sleep 0.25; done
grep -E "PASS|FAIL|RESULT" "$R/driver.log"
