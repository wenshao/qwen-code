#!/bin/bash
# Round-3 figure: explicit output budget on a real DashScope endpoint, base3 / r2 / r3.
B=${DASHSCOPE_BASE_URL:?}
export OPENAI_API_KEY=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.qwen/settings.json","utf8")).env.DASHSCOPE_KEY)')
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export QWEN_CODE_MODELS_DEV_REFRESH=off QWEN_CODE_SUPPRESS_YOLO_WARNING=1
. /Users/wenshao/git/qwen-11959/pr11959-rig/arms.sh
W=$(mktemp -d ${SCRATCH:-/tmp/pr11959}/fig3r.XXXX); mkdir -p $W/proj
cat > $W/settings.json <<'JSON'
{"general":{"enableAutoUpdate":false,"disableAutoUpdate":true},"security":{"folderTrust":{"enabled":false},"auth":{"selectedType":"openai"}},"privacy":{"usageStatisticsEnabled":false},"memory":{"enableManagedAutoMemory":false}}
JSON
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
run() { # run <arm> <model> [budget]
  local arm=$1 model=$2 budget=$3 h=$W/home-$1-$2-${3:-none}
  mkdir -p $h; cp $W/settings.json $h/
  local envs=(); [ -n "$budget" ] && envs=(QWEN_CODE_MAX_OUTPUT_TOKENS=$budget)
  local out; out=$(cd $W/proj && env "${envs[@]}" QWEN_HOME=$h QWEN_RUNTIME_DIR=$h/rt node $(arm_cli $arm) -p "Reply with exactly: hello" --approval-mode yolo --auth-type openai --openai-base-url $B --model $model --openai-logging --openai-logging-dir $h/logs 2>&1)
  local code=$?
  local sent=$(node -e 'const fs=require("fs"),p=require("path");const d=process.argv[1];try{const f=fs.readdirSync(d).sort()[0];const j=JSON.parse(fs.readFileSync(p.join(d,f)));console.log((j.request??j).max_tokens)}catch{console.log("?")}' $h/logs)
  out=$(printf '%s' "$out" | grep -v '^\s*$' | tail -1 | cut -c1-96)
  if [ $code -eq 0 ]; then c='\033[32m'; else c='\033[31m'; fi
  printf "  %-6s %-17s sent max_tokens=%-6s ${c}exit %s\033[0m  %s\n" "$arm" "$model" "$sent" "$code" "$out"
}
hdr "PR #11959 round 3: base3 700620f4 / r2 9088f00b / r3 1bb0e56e - real CLI bundles, real DashScope (Alibaba Cloud Model Studio) endpoint"
echo
hdr "A) user sets an explicit budget: QWEN_CODE_MAX_OUTPUT_TOKENS=32768"
for m in qwq-plus kimi-k2-thinking qvq-max; do for arm in base3 r2 r3; do run $arm $m 32768; done; echo; done
hdr "B) nothing configured: the catalog default still applies on r3"
for m in kimi-k2-thinking qvq-max; do for arm in base3 r3; do run $arm $m; done; done
echo
rm -rf $W
echo "[figure complete]"
