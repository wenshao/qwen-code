#!/usr/bin/env bash
# One end-to-end arm: seed a real daemon session whose in-session cron fires,
# stop the daemon, restart it cold, screenshot the Web Shell replay, then send
# a follow-up and record what the model receives.
#   run.sh <arm: base|head> <scenario: ok|fail>
set -euo pipefail
ARM=$1
SCEN=$2
WT=/root/verify/pr8838/head
H=/root/verify/pr8838/harness
RUN=/root/verify/pr8838/runs/$ARM-$SCEN
DIST=$WT/dist-$ARM
case "$ARM-$SCEN" in base-ok) PORT=4838;; head-ok) PORT=4839;; base-fail) PORT=4840;; head-fail) PORT=4841;; base-retry) PORT=4842;; head-retry) PORT=4843;; esac
TOKEN=verify-8838-token
rm -rf "$RUN"
mkdir -p "$RUN"/{qwen-home,home,ws,out}
echo "# workspace" > "$RUN/ws/README.md"
cat > "$RUN/qwen-home/settings.json" <<'EOF'
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"fake-model"},"tools":{"approvalMode":"yolo"}}
EOF
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_COLOR
export HOME=$RUN/home QWEN_HOME=$RUN/qwen-home OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false

export HEAL_FILE=$RUN/out/heal
node "$H/fake-model.mjs" "$RUN/out/model-requests.jsonl" > "$RUN/out/fake.log" 2>&1 &
FAKE=$!
for _ in $(seq 50); do command grep -q FAKE_SERVER_READY "$RUN/out/fake.log" && break; sleep 0.2; done
export OPENAI_BASE_URL=$(awk '/FAKE_SERVER_READY/{print $2}' "$RUN/out/fake.log")

start_daemon() {
  setsid node "$DIST/cli.js" serve --port $PORT --token $TOKEN --workspace "$RUN/ws" > "$RUN/out/daemon-$1.log" 2>&1 &
  DPID=$!
}
stop_daemon() {
  kill -TERM -- -$DPID 2>/dev/null || true
  for _ in $(seq 50); do kill -0 $DPID 2>/dev/null || break; sleep 0.2; done
  kill -KILL -- -$DPID 2>/dev/null || true
}
trap 'stop_daemon; kill $FAKE 2>/dev/null || true' EXIT

start_daemon live
node "$H/drive.mjs" seed "http://127.0.0.1:$PORT" $TOKEN "$RUN/ws" "$RUN/out" "$SCEN" 2>&1 | tee "$RUN/out/drive-seed.log"
SID=$(node -p "require('$RUN/out/session.json').sessionId")
PWENV="PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright NODE_PATH=$WT/node_modules"
if [ "$SCEN" = fail ]; then
  env $PWENV node "$H/shot.cjs" "http://127.0.0.1:$PORT" $TOKEN "$SID" "$RUN/out/webshell-live.png" "FAILING-TASK" 2>&1 | tail -30 || true
fi
stop_daemon
touch "$RUN/out/heal"
echo "daemon stopped (cold restart next) sid=$SID"

start_daemon cold
WAIT=$([ "$SCEN" = ok ] && echo NIGHTLY-REPORT-RESULT || echo "Scheduled. It will run")
PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright NODE_PATH=$WT/node_modules node "$H/shot.cjs" "http://127.0.0.1:$PORT" $TOKEN "$SID" "$RUN/out/webshell-cold.png" "$WAIT" 2>&1 | tail -30 || true
if [ "$SCEN" = fail ]; then
  env $PWENV node "$H/cont.cjs" "http://127.0.0.1:$PORT" $TOKEN "$SID" "$RUN/out/webshell-continue.png" 2>&1 | tail -30 || true
fi
node "$H/drive.mjs" cold "http://127.0.0.1:$PORT" $TOKEN "$RUN/ws" "$SID" "$RUN/out" "$([ "$SCEN" = fail ] && echo none || echo send)" 2>&1 | tee "$RUN/out/drive-cold.log"
stop_daemon
cp "$RUN"/qwen-home/projects/*/chats/"$SID".jsonl "$RUN/out/transcript.jsonl" 2>/dev/null || find "$RUN/qwen-home" -name "$SID*.jsonl" | head
echo "RUN_DONE $ARM $SCEN $SID"
