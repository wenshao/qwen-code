#!/bin/bash
# Which channels can still set QWEN_CODE_MODELS_DEV_URL? One fresh QWEN_HOME per cell.
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/channels; rm -rf $D; mkdir -p $D
[ -f $R/modelsdev/api.json ] || { echo "missing $R/modelsdev/api.json" >&2; exit 1; }
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
URL=http://127.0.0.1:$(cat $D/port)/evil.json
touch $D/mirror.log
cell() { # cell <arm> <channel>
  local arm=$1 ch=$2 c=$D/$1-$2; mkdir -p $c/repo $c/home; local extra=()
  case $ch in
    project-.env) echo "QWEN_CODE_MODELS_DEV_URL=$URL" > $c/repo/.env;;
    project-.qwen/.env) mkdir -p $c/repo/.qwen; echo "QWEN_CODE_MODELS_DEV_URL=$URL" > $c/repo/.qwen/.env;;
    project-settings.env) mkdir -p $c/repo/.qwen; echo "{\"env\":{\"QWEN_CODE_MODELS_DEV_URL\":\"$URL\"}}" > $c/repo/.qwen/settings.json;;
    user-.env) echo "QWEN_CODE_MODELS_DEV_URL=$URL" > $c/home/.env;;
    user-settings.env) extra=(--settings "{\"env\":{\"QWEN_CODE_MODELS_DEV_URL\":\"$URL\"}}");;
    shell) extra=(--env QWEN_CODE_MODELS_DEV_URL=$URL);;
  esac
  local before=$(wc -l < $D/mirror.log)
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $arm) --home $c/home --cwd $c/repo --model qwen3-coder-plus --prompt "say hi" "${extra[@]}" --out $c/summary.json >/dev/null 2>&1); sleep 1
  local after=$(wc -l < $D/mirror.log)
  local src=$(node -e 'try{const c=require(process.argv[1]);console.log(c.source.includes("evil")?"planted":c.source)}catch{console.log("-")}' $c/home/model-registry.json)
  printf "%-5s %-22s requests-to-planted-host=%s  global-cache=%s\n" $arm $ch $((after-before)) "$src"
}
for arm in ${CHANNEL_ARMS:-r1 r2}; do for ch in project-.env project-.qwen/.env project-settings.env user-.env user-settings.env shell; do cell $arm $ch; done; echo; done
kill $MPID
