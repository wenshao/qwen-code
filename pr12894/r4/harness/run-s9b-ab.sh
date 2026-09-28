#!/bin/bash
A=/root/git/qwen-code-x3/tmp/pr12894-verify-20260928-205039
cd "$A" || exit 9
sha256sum head/packages/core/src/services/shellExecutionService.ts > results/s9b-integrity.txt
for arm in head control; do
  timeout 550 ./head/node_modules/.bin/tsx harness/s9b-stderr-siblings.mts \
    --tree "./$arm" --json "results/s9b-$arm.json" > "results/s9b-$arm.log" 2>&1
  echo "${arm^^}_EXIT=$?" >> "results/s9b-$arm.log"
done
echo S9B_DONE
