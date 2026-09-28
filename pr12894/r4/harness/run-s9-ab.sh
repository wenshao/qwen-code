#!/bin/bash
# Round 4 A/B: identical sweep against head (f415b565) and control (678420df).
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
cd "$A" || exit 9
for arm in head control; do
  timeout 550 ./head/node_modules/.bin/tsx harness/s9-stderr-preview.mts \
    --tree "./$arm" --json "results/s9-$arm.json" > "results/s9-$arm.log" 2>&1
  echo "${arm^^}_EXIT=$?" >> "results/s9-$arm.log"
done
echo AB_DONE
