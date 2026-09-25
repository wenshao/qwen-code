#!/bin/bash
# Real-model A/B: same task, same executor/advisor pair, base vs head bundle.
# Executor qwen3.8-flash, Advisor qwen3.8-max. The prompt never mentions the Advisor.
set -u
R=/root/verify/pr12688/realmodel
AK=$(jq -r .env.DASHSCOP_REVIEW_AK ~/.qwen/settings.json)
URL=https://llm-1yxl3y53fm8pcr4z.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
PROMPT='Make the tests in this directory pass according to SPEC.md. Run `node --test` to check your work.'
ROUNDS=${ROUNDS:-3}
EXEC=${EXEC:-qwen3.8-flash}
RUNS=${RUNS:-runs}
for i in $(seq 1 "$ROUNDS"); do
  for arm in base head; do
    run=$R/$RUNS/$arm-$i
    rm -rf "$run"; mkdir -p "$run/home/.qwen" "$run/ws"
    cp $R/fixture/* "$run/ws/"
    (cd "$run/ws" && git init -q && git add -A && git -c user.email=v@x -c user.name=v commit -qm fixture)
    cat > "$run/home/.qwen/settings.json" <<EOF
{
  "modelProviders": { "openai": [
    { "id": "qwen3.8-flash", "name": "qwen3.8-flash", "baseUrl": "$URL", "envKey": "DASHSCOP_REVIEW_AK", "generationConfig": { "extra_body": { "enable_thinking": true } } },
    { "id": "qwen3.8-max", "name": "qwen3.8-max", "baseUrl": "$URL", "envKey": "DASHSCOP_REVIEW_AK", "generationConfig": { "extra_body": { "enable_thinking": true } } }
  ] },
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "$EXEC" },
  "telemetry": { "enabled": false },
  "sandbox": false,
  "ui": { "enableFollowupSuggestions": false }
}
EOF
    echo "=== $arm-$i start $(date +%T)"
    start=$(date +%s)
    (cd "$run/ws" && env -u OPENAI_API_KEY -u OPENAI_BASE_URL HOME="$run/home" QWEN_HOME="$run/home/.qwen" QWEN_RUNTIME_DIR="$run/home/.qwen" \
      DASHSCOP_REVIEW_AK="$AK" QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1 QWEN_CODE_SUPPRESS_YOLO_WARNING=1 \
      timeout 900 node /root/verify/pr12688/$arm/dist/cli.js --no-chat-recording --yolo --auth-type openai \
      --model $EXEC --advisor qwen3.8-max -o stream-json -p "$PROMPT" \
      > "$run/stream.jsonl" 2> "$run/stderr.log")
    code=$?
    end=$(date +%s)
    (cd "$run/ws" && node --test > "$run/rerun.txt" 2>&1; echo "RERUN_EXIT=$?" >> "$run/rerun.txt")
    (cd "$run/ws" && git diff --quiet HEAD -- duration.test.js SPEC.md && echo FIXTURES_UNCHANGED || echo FIXTURES_CHANGED) > "$run/fixtures.txt"
    echo "=== $arm-$i exit=$code secs=$((end-start)) $(grep -E '^# (pass|fail)' "$run/rerun.txt" | tr '\n' ' ') $(cat "$run/fixtures.txt")"
  done
done
echo REAL_DONE
