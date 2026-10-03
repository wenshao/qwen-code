#!/bin/bash
# usage: run-headless.sh <arm> <scenario> <outdir> [extra cli args...]
ARM=$1; SCEN=$2; OUT=$(realpath -m "$3"); shift 3
H=/root/verify/pr10916/r3/harness
mkdir -p "$OUT"; rm -rf "$OUT"/*
export WS="$OUT/ws"; mkdir -p "$WS" "$OUT/home"
printf '# demo project\nNot a git checkout.\n' > "$WS/README.md"
[ -f "$H/$SCEN.setup.sh" ] && bash "$H/$SCEN.setup.sh" "$WS" "$OUT"
# optional per-scenario user settings
[ -f "$H/$SCEN.settings.json" ] && mkdir -p "$OUT/home/.qwen" && cp "$H/$SCEN.settings.json" "$OUT/home/.qwen/settings.json"
node "$H/fake-model.mjs" "$H/$SCEN.mjs" "$OUT/requests.jsonl" > "$OUT/fake.out" 2>&1 &
FPID=$!
for i in $(seq 1 50); do grep -q FAKE_SERVER_READY "$OUT/fake.out" && break; sleep 0.1; done
URL=$(awk '/FAKE_SERVER_READY/{print $2}' "$OUT/fake.out")
cd "$WS"
env -i PATH="$PATH" HOME="$OUT/home" USERPROFILE="$OUT/home" TERM=xterm-256color WS="$WS" \
  QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 QWEN_CODE_SUPPRESS_YOLO_WARNING=1 GIT_CEILING_DIRECTORIES="$(dirname "$WS")" \
  $EXTRA_ENV timeout 300 node /root/verify/pr10916/$ARM/scripts/cli-entry.js \
  --auth-type openai --openai-api-key dummy --openai-base-url "$URL" --model fake-model \
  "$@" > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
echo $? > "$OUT/exit_code"
kill $FPID 2>/dev/null; wait $FPID 2>/dev/null
echo "arm=$ARM scen=$SCEN exit=$(cat $OUT/exit_code) requests=$(wc -l < $OUT/requests.jsonl) main=$(grep -c '"kind":"main"' $OUT/requests.jsonl)"
