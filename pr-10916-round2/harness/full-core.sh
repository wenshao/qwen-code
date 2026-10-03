#!/bin/bash
for a in pr main; do
  cd /root/verify/pr10916/r2/$a/packages/core
  s=$(date +%s)
  timeout 2400 npx vitest run --reporter=json --outputFile=/root/verify/pr10916/r2/runs/full-core-$a.json > /root/verify/pr10916/r2/runs/full-core-$a.log 2>&1
  echo "$a exit=$? elapsed=$(( $(date +%s)-s ))s"
done
cd /root/verify/pr10916/r2/pr/packages/cli && s=$(date +%s) && timeout 900 npx vitest run src/nonInteractiveCli.test.ts > /root/verify/pr10916/r2/runs/cli-nonInteractive-pr.log 2>&1; echo "cli exit=$? elapsed=$(( $(date +%s)-s ))s"
echo ALLDONE
