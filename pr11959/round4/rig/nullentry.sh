#!/bin/bash
# One null model entry in an otherwise real payload: does the refresh still land?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/nullentry; rm -rf $D; mkdir -p $D
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
M=http://127.0.0.1:$(cat $D/port)
step() { # step <label> <path>
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli ${ARM:-r3}) --home $D/home-$2 --cwd $D/proj --model claude-fable-5 --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_URL=$M/$2 --out $D/$1.json >/dev/null 2>&1); sleep 1
  local c=$(node -e 'try{const c=require(process.argv[1]);console.log("models="+Object.keys(c.models).length)}catch{console.log("<none>")}' $D/home-$2/model-registry.json)
  echo "== $1 [${ARM:-r3}] (/$2): cache $c; requests to /$2 so far: $(grep -c "\"/$2\"" $D/mirror.log)"
}
step n1-real-payload api.json
step n2-one-null-entry nullentry
step n3-next-start nullentry
kill $MPID
