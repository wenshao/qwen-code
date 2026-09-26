#!/bin/bash
# Background refresh lifecycle through the real CLI against a local mirror.
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
PR=${CLI:-/Users/wenshao/git/qwen-11959/dist/cli.js}
D=$R/refresh${SUFFIX:-}; rm -rf $D; mkdir -p $D
[ -f $R/modelsdev/api.json ] || { echo "missing $R/modelsdev/api.json" >&2; exit 1; }
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!; echo $MPID > $D/mirror.pid
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
PORT=$(cat $D/port); M=http://127.0.0.1:$PORT
HOME_DIR=$D/home   # one QWEN_HOME shared by every step, like a real user
cache() { node -e 'try{const c=require(process.argv[1]);console.log("cache: source="+c.source.replace(/127\.0\.0\.1:\d+/,"mirror")+" fetchedAt="+c.fetchedAt+" etag="+(c.etag??"-")+" models="+Object.keys(c.models).length)}catch(e){console.log("cache: <none>")}' $HOME_DIR/model-registry.json; }
reqs() { echo "mirror requests so far: $(wc -l < $D/mirror.log 2>/dev/null || echo 0)"; tail -n ${1:-1} $D/mirror.log 2>/dev/null | sed "s/^/  last: /"; }
step() { # step <label> <url-path> <prompt>
  local label=$1 path=$2 prompt=${3:-/context -d}
  (cd $RIG && npx tsx run-cli.ts --cli $PR --home $HOME_DIR --cwd $D/proj --model claude-fable-5 --prompt "$prompt" --env QWEN_CODE_MODELS_DEV_URL=$M$path --out $D/$label.json >/dev/null 2>&1)
  sleep 1
  local w=$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log(m?m[1]:"?")' $D/$label.json)
  echo "== $label ($path): claude-fable-5 context window in this run = $w"
  cache; reqs
}
step 1-first-run /api.json
step 2-second-run-within-24h /api.json
# Age the cache by 25h to force a conditional re-fetch.
node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f));c.fetchedAt=new Date(Date.now()-25*3600e3).toISOString();require("fs").writeFileSync(f,JSON.stringify(c))' $HOME_DIR/model-registry.json
step 3-after-25h-conditional /api.json
node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f));c.fetchedAt=new Date(Date.now()-25*3600e3).toISOString();require("fs").writeFileSync(f,JSON.stringify(c))' $HOME_DIR/model-registry.json
cp $HOME_DIR/model-registry.json $D/before-500.json
step 4-server-500 /fail500
cmp -s $D/before-500.json $HOME_DIR/model-registry.json && echo "   cache byte-identical after 500: yes" || echo "   cache byte-identical after 500: NO"
step 5-foreign-200-body /foreign
step 6-next-run-after-foreign /foreign
kill $MPID
