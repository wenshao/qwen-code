#!/bin/bash
# Round-4 figure: real DashScope endpoint, base3 vs r4.
B=${DASHSCOPE_BASE_URL:?}
export OPENAI_API_KEY=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.qwen/settings.json","utf8")).env.DASHSCOPE_KEY)')
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export QWEN_CODE_MODELS_DEV_REFRESH=off QWEN_CODE_SUPPRESS_YOLO_WARNING=1
. /Users/wenshao/git/qwen-11959/pr11959-rig/arms.sh
W=$(mktemp -d ${SCRATCH:-/tmp/pr11959}/fig4r.XXXX); mkdir -p $W/proj; cp /Users/wenshao/git/qwen-11959/pr11959-rig/red.png $W/proj/
cat > $W/settings.json <<'JSON'
{"general":{"enableAutoUpdate":false,"disableAutoUpdate":true},"security":{"folderTrust":{"enabled":false},"auth":{"selectedType":"openai"}},"privacy":{"usageStatisticsEnabled":false},"memory":{"enableManagedAutoMemory":false}}
JSON
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
run() { # run <arm> <model> <budget|-> <prompt>
  local arm=$1 model=$2 budget=$3 prompt=$4 h=$W/home-$1-$2-$3-$RANDOM
  mkdir -p $h; cp $W/settings.json $h/
  local envs=(); [ "$budget" != "-" ] && envs=(QWEN_CODE_MAX_OUTPUT_TOKENS=$budget)
  local out; out=$(cd $W/proj && env "${envs[@]}" QWEN_HOME=$h QWEN_RUNTIME_DIR=$h/rt node $(arm_cli $arm) -p "$prompt" --approval-mode yolo --auth-type openai --openai-base-url $B --model $model --openai-logging --openai-logging-dir $h/logs 2>&1)
  local code=$?
  local sent=$(node -e 'const fs=require("fs"),p=require("path");const d=process.argv[1];try{const f=fs.readdirSync(d).sort()[0];const j=JSON.parse(fs.readFileSync(p.join(d,f)));process.stdout.write(String((j.request??j).max_tokens))}catch{process.stdout.write("?")}' $h/logs)
  out=$(printf '%s' "$out" | grep -v '^[[:space:]]*$' | tail -1 | sed -E 's/.*InvalidParameter: /400: /' | cut -c1-70)
  if [ $code -eq 0 ]; then c='\033[32m'; else c='\033[31m'; fi
  printf "  %-6s %-20s budget=%-6s sent max_tokens=%-6s ${c}exit %s\033[0m  %s\n" "$arm" "$model" "$budget" "$sent" "$code" "$out"
}
hdr "PR #11959 round 4: base3 700620f4 vs r4 4d9bbdef - real CLI bundles, real DashScope (Alibaba Cloud Model Studio) endpoint"
echo
hdr "Nothing configured (catalog defaults)"
for m in kimi-k2-thinking qvq-max; do for arm in base3 r4; do run $arm $m - "Reply with exactly: hello"; done; done
echo
hdr "Explicit QWEN_CODE_MAX_OUTPUT_TOKENS=32768 (passes through, as on main)"
for arm in base3 r4; do run $arm qwq-plus 32768 "Reply with exactly: hello"; done
echo
hdr "Image input: deepseek-v4.1-flash + @red.png"
for arm in base3 r4; do run $arm deepseek-v4.1-flash - "Dominant color of @red.png ? One word, or CANNOT_SEE if no image arrived. No tools."; done
echo
rm -rf $W
echo "[figure complete]"
