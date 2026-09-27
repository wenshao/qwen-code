#!/bin/bash
# A 200 whose projection is non-empty but tiny: accepted as the whole catalog?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/partial; rm -rf $D; mkdir -p $D
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
M=http://127.0.0.1:$(cat $D/port)
step() { # step <label> <path>
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli r2) --home $D/home --cwd $D/proj --model claude-fable-5 --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_URL=$M$2 --out $D/$1.json >/dev/null 2>&1); sleep 1
  local w=$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log(m?m[1]:"?")' $D/$1.json)
  local c=$(node -e 'try{const c=require(process.argv[1]);console.log("models="+Object.keys(c.models).length+" source="+c.source.replace(/127\.0\.0\.1:\d+/,"mirror"))}catch{console.log("<none>")}' $D/home/model-registry.json)
  echo "== $1 [r2] ($2): claude-fable-5 window this run = $w; cache $c"
}
step p1-good /api.json
step p2-partial-200 /partial
step p3-next-start /partial
kill $MPID
