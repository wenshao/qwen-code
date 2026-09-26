#!/bin/bash
# Figure 2: the real CLI (base vs PR bundle) against a real DashScope endpoint.
B=${DASHSCOPE_BASE_URL:?}
export OPENAI_API_KEY=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.qwen/settings.json","utf8")).env.DASHSCOPE_KEY)')
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export QWEN_CODE_MODELS_DEV_REFRESH=off QWEN_CODE_SUPPRESS_YOLO_WARNING=1
W=$(mktemp -d ${SCRATCH:-/tmp/pr11959}/fig2.XXXX); mkdir -p $W/proj; cp /Users/wenshao/git/qwen-11959/pr11959-rig/red.png $W/proj/
cat > $W/settings.json <<'JSON'
{"general":{"enableAutoUpdate":false,"disableAutoUpdate":true},"security":{"folderTrust":{"enabled":false},"auth":{"selectedType":"openai"}},"privacy":{"usageStatisticsEnabled":false},"memory":{"enableManagedAutoMemory":false}}
JSON
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
run() { # run <arm> <model> <prompt>
  local arm=$1 model=$2 prompt=$3 cli
  [ $arm = base ] && cli=/Users/wenshao/git/qwen-11959-base/dist/cli.js || cli=/Users/wenshao/git/qwen-11959/dist/cli.js
  local h=$W/home-$arm-$model; mkdir -p $h; cp $W/settings.json $h/
  printf '\033[2m$ [%s] qwen -p "%s" --model %s\033[0m\n' "$arm" "$prompt" "$model"
  local out
  out=$(cd $W/proj && QWEN_HOME=$h QWEN_RUNTIME_DIR=$h/rt node $cli -p "$prompt" --approval-mode yolo --auth-type openai --openai-base-url $B --model $model 2>&1)
  local code=$?
  out=$(printf '%s' "$out" | grep -v '^\s*$' | tail -3)
  if [ $code -eq 0 ]; then printf '  \033[32mexit 0\033[0m  %s\n' "$out"; else printf '  \033[31mexit %s\033[0m  %s\n' "$code" "$out"; fi
}
hdr "PR #11959 @ f5ba51ff vs base 1dbb3786 - real CLI bundle, real DashScope (Alibaba Cloud Model Studio) endpoint"
hdr "No output setting configured: the CLI picks max_tokens itself"
echo
for m in kimi-k2-thinking qvq-max; do
  run base $m "Reply with exactly: hello"
  run pr   $m "Reply with exactly: hello"
  echo
done
hdr "Image input: deepseek-v4.1-flash (catalog adds image modality)"
P="Dominant color of @red.png ? One word, or CANNOT_SEE if no image arrived. No tools."
run base deepseek-v4.1-flash "$P"
run pr   deepseek-v4.1-flash "$P"
echo
rm -rf $W
echo "[figure complete]"
