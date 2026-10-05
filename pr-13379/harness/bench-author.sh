#!/bin/bash
# Author's benchmark, unchanged, both arms interleaved; tmpfs (/tmp) and ext4 (tmpdisk) fixture roots.
R=/root/verify/pr13379
for loc in tmpfs ext4; do
  if [ $loc = tmpfs ]; then T=/tmp; else T=$R/tmpdisk; fi
  for round in 1 2 3; do
    for arm in base head; do
      cd $R/$arm
      TMPDIR=$T npx tsx packages/core/scripts/bench-extension-load.ts --runs 10 > $R/out/bench/author-$loc-$arm-r$round.txt 2>&1
      echo "$loc $arm r$round exit=$? $(grep median $R/out/bench/author-$loc-$arm-r$round.txt)"
    done
  done
done
echo BENCH_DONE
