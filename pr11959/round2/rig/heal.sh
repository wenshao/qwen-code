#!/bin/bash
# A cache poisoned by the previous head (R1) while the same URL briefly served
# a gateway error body; the URL then recovers. Does R1 / R2 heal within 24 h?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/heal; rm -rf $D; mkdir -p $D
[ -f $R/modelsdev/api.json ] || { echo "missing $R/modelsdev/api.json" >&2; exit 1; }
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port $D/flip &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
URL=http://127.0.0.1:$(cat $D/port)/flip
cache() { node -e 'try{const c=require(process.argv[1]);console.log("   cache: models="+Object.keys(c.models).length+" etag="+(c.etag??"-")+" fetchedAt="+c.fetchedAt)}catch(e){console.log("   cache: <none>")}' $1/model-registry.json; }
step() { # step <label> <arm> <home>
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $2) --home $3 --cwd $D/proj --model claude-fable-5 --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_URL=$URL --out $D/$1.json >/dev/null 2>&1); sleep 1
  local w=$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log(m?m[1]:"?")' $D/$1.json)
  echo "== $1 [$2] mirror=$(cat $D/flip): claude-fable-5 window this run = $w"
  cache $3; echo "   mirror requests: $(wc -l < $D/mirror.log | tr -d ' ')  last: $(tail -1 $D/mirror.log)"
}
echo bad > $D/flip
step h1-r1-poisons r1 $D/home
echo good > $D/flip
cp -R $D/home $D/home-r2          # the same poisoned cache, for the R2 arm
step h2-r1-same-url-recovered r1 $D/home
step h3-r2-same-url-recovered r2 $D/home-r2
step h4-r2-next-start r2 $D/home-r2
kill $MPID
