#!/bin/bash
# A fresh cache from the same URL whose only key is not a normalize() fixed point:
# the read side rejects it (bundled serves), does the refresh side still skip the fetch?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/predicate; rm -rf $D; mkdir -p $D/home
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
URL=http://127.0.0.1:$(cat $D/port)/api.json; touch $D/mirror.log
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({source: process.argv[2], fetchedAt: new Date().toISOString(), etag: "\"old\"", models: {"deepseek-v3": {context: 163840, output: 163840}}}))' $D/home/model-registry.json $URL
for i in 1 2; do
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli ${ARM:-r4}) --home $D/home --cwd $D/proj --model claude-fable-5 --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_URL=$URL --out $D/run$i.json >/dev/null 2>&1); sleep 1
  w=$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); process.stdout.write(m?m[1]:"?")' $D/run$i.json)
  c=$(node -e 'const c=require(process.argv[1]); process.stdout.write("keys="+Object.keys(c.models).join(",")+" etag="+c.etag)' $D/home/model-registry.json)
  echo "start $i [${ARM:-r4}]: claude-fable-5 window=$w; mirror requests=$(wc -l < $D/mirror.log | tr -d ' '); cache $c"
done
kill $MPID
