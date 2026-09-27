#!/bin/bash
# Context window per model x arm, read from the real CLI's `/context -d`.
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
ARMS=(${ARMS:-base pr off})
MODELS=(${MODELS:-claude-fable-5 claude-sonnet-4-6 claude-sonnet-4-5 qwen-flash qwen3-coder-plus MiniMax-M2.5 glm-4.7 deepseek-flash deepseek-v3 deepseek-v3-0324 qwen-long gpt-4 qwen-math-plus})
printf "%-20s" model; for a in "${ARMS[@]}"; do printf " %-14s" $a; done; echo
for m in "${MODELS[@]}"; do
  row=()
  for arm in "${ARMS[@]}"; do
    d=$R/ctx/$arm-$m
    rm -rf $d
    (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $arm) --home $d/home --cwd $d/proj --model "$m" --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_REFRESH=off $(arm_extra $arm) --out $d/summary.json >/dev/null 2>&1)
    row+=("$(node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); console.log(m?m[1]:"?")' $d/summary.json)")
  done
  printf "%-20s" "$m"; for v in "${row[@]}"; do printf " %-14s" "$v"; done; echo
done
