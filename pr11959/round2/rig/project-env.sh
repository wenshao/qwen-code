#!/bin/bash
# A repository .env sets QWEN_CODE_MODELS_DEV_URL; does it leak into the
# global cache that every other project then reads?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
PR=${CLI:-/Users/wenshao/git/qwen-11959/dist/cli.js}
D=$R/projenv${SUFFIX:-}; rm -rf $D; mkdir -p $D/repo-a $D/repo-b
[ -f $R/modelsdev/api.json ] || { echo "missing $R/modelsdev/api.json" >&2; exit 1; }
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
PORT=$(cat $D/port)
echo "QWEN_CODE_MODELS_DEV_URL=http://127.0.0.1:$PORT/evil.json" > $D/repo-a/.env
HOME_DIR=$D/home
cache() { node -e 'try{const c=require(process.argv[1]);console.log("  global cache: source="+c.source.replace(/127\.0\.0\.1:\d+/,"attacker")+" models="+Object.keys(c.models).length+" qwen3-coder-plus="+JSON.stringify(c.models["qwen3-coder-plus"]))}catch(e){console.log("  global cache: <none>")}' $HOME_DIR/model-registry.json; }
run() { # run <label> <cwd> <model> <prompt> [--env ...]
  local label=$1 cwd=$2 model=$3 prompt=$4; shift 4
  (cd $RIG && npx tsx run-cli.ts --cli $PR --home $HOME_DIR --cwd $cwd --model $model --prompt "$prompt" "$@" --out $D/$label.json >/dev/null 2>&1)
  sleep 1
  node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log("== "+process.argv[2]+": window="+(m?m[1]:"n/a")+" wire max_tokens="+(s.requests.map(r=>r.max_tokens).join("/")||"n/a"))' $D/$label.json $label
  cache; echo "  attacker-host requests: $(grep -c evil.json $D/mirror.log 2>/dev/null || echo 0)"
}
run 0-repo-b-before /$D/repo-b qwen3-coder-plus "/context -d" --env QWEN_CODE_MODELS_DEV_REFRESH=off
run 1-open-repo-a $D/repo-a qwen3-coder-plus "say hi"
run 2-repo-b-offline $D/repo-b qwen3-coder-plus "/context -d" --env QWEN_CODE_MODELS_DEV_REFRESH=off
run 3-repo-b-offline-turn $D/repo-b qwen3-coder-plus "say hi" --env QWEN_CODE_MODELS_DEV_REFRESH=off
kill $MPID
