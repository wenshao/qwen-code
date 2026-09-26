#!/bin/bash
# Context window per model x arm, read from the real CLI's `/context -d`.
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
BASE=/Users/wenshao/git/qwen-11959-base/dist/cli.js
PR=/Users/wenshao/git/qwen-11959/dist/cli.js
MODELS=(claude-fable-5 claude-sonnet-4-6 claude-sonnet-4-5 qwen-flash qwen3-coder-plus MiniMax-M2.5 glm-4.7 deepseek-flash deepseek-v3 deepseek-v3-0324 qwen-long gpt-4 qwen-math-plus)
printf "%-20s %-14s %-14s %-14s\n" model base pr pr-catalog-off
for m in "${MODELS[@]}"; do
  row=()
  for arm in base pr off; do
    case $arm in base) cli=$BASE; extra=();; pr) cli=$PR; extra=();; off) cli=$PR; extra=(--env QWEN_CODE_MODELS_DEV=off);; esac
    d=$R/ctx/$arm-$m
    rm -rf $d
    out=$(cd $RIG && npx tsx run-cli.ts --cli $cli --home $d/home --cwd $d/proj --model "$m" --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_REFRESH=off "${extra[@]}" --out $d/summary.json 2>/dev/null)
    w=$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log(m?m[1]:"?")' $d/summary.json)
    row+=("$w")
  done
  printf "%-20s %-14s %-14s %-14s\n" "$m" "${row[@]}"
done
