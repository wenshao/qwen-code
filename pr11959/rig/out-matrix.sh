#!/bin/bash
# Wire max_tokens per model x arm: one real "say hi" turn against the fake server.
# usage: out-matrix.sh <tag> [--env K=V ...]
R=${R:?}
TAG=$1; shift
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
BASE=/Users/wenshao/git/qwen-11959-base/dist/cli.js
PR=/Users/wenshao/git/qwen-11959/dist/cli.js
CAND=/Users/wenshao/git/qwen-11959-cand/dist/cli.js
ARMS=(${ARMS:-base pr off})
MODELS=(${MODELS:-glm-4.7 qwq-32b Qwen/QwQ-32B kimi-k2-thinking qvq-max deepseek-v3 deepseek-v3-0324 qwen-vl-max qwen-flash gpt-4 qwen-math-plus})
printf "%-20s" model; for a in "${ARMS[@]}"; do printf " %-22s" $a; done; echo
for m in "${MODELS[@]}"; do
  row=()
  for arm in "${ARMS[@]}"; do
    case $arm in base) cli=$BASE; extra=();; pr) cli=$PR; extra=();; cand) cli=$CAND; extra=();; off) cli=$PR; extra=(--env QWEN_CODE_MODELS_DEV=off);; esac
    d=$R/out-$TAG/$arm-${m//\//_}
    rm -rf $d
    (cd $RIG && npx tsx run-cli.ts --cli $cli --home $d/home --cwd $d/proj --model "$m" --prompt "say hi" --env QWEN_CODE_MODELS_DEV_REFRESH=off "${extra[@]}" "$@" --out $d/summary.json >/dev/null 2>&1)
    v=$(node -e 'const s=require(process.argv[1]); const r=s.requests; console.log(r.length? r.map(x=>x.max_tokens??"none").join("/")+" (n="+r.length+")" : "no-request exit="+s.code)' $d/summary.json)
    row+=("$v")
  done
  printf "%-20s" "$m"; for v in "${row[@]}"; do printf " %-22s" "$v"; done; echo
done
