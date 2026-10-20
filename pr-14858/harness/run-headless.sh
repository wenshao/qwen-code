#!/bin/bash
# usage: run-headless.sh <arm:head|base> <scen> <tag> '<settings model json>' [extra cli args...]
# Runs one headless -p turn against the fake model in an isolated HOME and
# writes stdout/stderr/exit/telemetry under runs/<arm>/<tag>/.
ARM=$1; SCEN=$2; TAG=$3; MODEL_JSON=$4; shift 4
R=/root/verify/pr14858
OUT=$R/runs/$ARM/$TAG
rm -rf "$OUT"; mkdir -p "$OUT/home/.qwen"
cat > "$OUT/home/.qwen/settings.json" <<EOF
{"security":{"auth":{"selectedType":"openai"}},"model":$MODEL_JSON,"privacy":{"usageStatisticsEnabled":false}}
EOF
URL=$(cat $R/fake-url)
L0=$(wc -l < $R/fake.log 2>/dev/null || echo 0)
cd $R/ws
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy -u NO_COLOR -u QWEN_HOME \
  HOME="$OUT/home" USERPROFILE="$OUT/home" QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 \
  OPENAI_API_KEY=dummy OPENAI_BASE_URL="$URL" OPENAI_MODEL=fake \
  timeout 600 node $R/wt-$ARM/dist/cli.js -p "SCEN=$SCEN go" --approval-mode yolo \
  --auth-type openai --openai-api-key dummy --openai-base-url "$URL" --model fake \
  --telemetry --telemetry-target local --telemetry-outfile "$OUT/telemetry.jsonl" "$@" \
  > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
echo $? > "$OUT/exit"
tail -n +$((L0+1)) $R/fake.log > "$OUT/fake.jsonl"
echo "$ARM $TAG exit=$(cat $OUT/exit)"
