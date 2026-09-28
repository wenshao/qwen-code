#!/bin/bash
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
cd "$A" || exit 9
for arm in head control; do
  timeout 400 ./head/node_modules/.bin/tsx harness/s9c-cjk.mts \
    --tree "./$arm" --json "results/s9c-$arm.json" > "results/s9c-$arm.log" 2>&1
  echo "${arm^^}_EXIT=$?" >> "results/s9c-$arm.log"
done
echo S9C_DONE
