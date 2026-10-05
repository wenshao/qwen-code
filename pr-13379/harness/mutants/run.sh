#!/bin/bash
# Run every mutant against the full extensionManager.test.ts in the head arm, then restore.
set -u
R=/root/verify/pr13379
T=$R/head/packages/core/src/extension/extensionManager.ts
cd $R/head/packages/core
for m in $R/harness/mutants/m*.ts; do
  k=$(basename $m .ts)
  cp $m $T.tmp && mv $T.tmp $T
  npx vitest run src/extension/extensionManager.test.ts --reporter=json --outputFile=$R/out/mut-$k.json > $R/out/mut-$k.log 2>&1
  echo "$k exit=$?"
done
cp $R/out/extensionManager.pristine.ts $T.tmp && mv $T.tmp $T
git -C $R/head status --porcelain
git -C $R/head diff --stat
echo RESTORED
