#!/bin/bash
# Wall time of a real `qwen -p` when the catalog peer accepts and never answers.
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/hang; rm -rf $D; mkdir -p $D
node $RIG/mirror.mjs $R/modelsdev/api.json $D/mirror.log $D/port &
MPID=$!
for i in $(seq 1 50); do [ -s $D/port ] && break; sleep 0.1; done
M=http://127.0.0.1:$(cat $D/port)
cell() { # cell <label> <arm> <prompt> [--env ...]
  local label=$1 arm=$2 prompt=$3; shift 3
  local t0=$(node -e 'process.stdout.write(String(Date.now()))')
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $arm) --home $D/home-$label --cwd $D/proj --model qwen3-coder-plus --prompt "$prompt" "$@" --out $D/$label.json >/dev/null 2>&1)
  local t1=$(node -e 'process.stdout.write(String(Date.now()))')
  node -e 'const s=require(process.argv[1]); console.log(process.argv[2].padEnd(34), "exit="+s.code, "wall="+process.argv[3]+"ms", "model requests="+s.requests.length)' $D/$label.json $label $((t1-t0))
}
for p in "say hi" "/context -d"; do
  tag=${p//[^a-z]/}
  cell base3-$tag base3 "$p"
  cell r3-refresh-off-$tag r3 "$p" --env QWEN_CODE_MODELS_DEV_REFRESH=off
  cell r3-blackhole-peer-$tag r3 "$p" --env QWEN_CODE_MODELS_DEV_URL=$M/hang
done
echo "peer saw $(grep -c hang $D/mirror.log) hanging catalog requests"
kill $MPID
