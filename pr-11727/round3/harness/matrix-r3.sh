#!/usr/bin/env bash
# Round 3: head fd61c750b0 vs merge base ee1ebcc167, plus in-build mutant arms
# nohalfcap (== c2d3c24df8) and noclamp (== 8ac6e4d602).
set -uo pipefail
H=/root/git/h11727
cd $H
R=r3
echo "== default config"
for s in s1-ok-window s2-fail-window s3-small s4-far-over s5-timeout-window s5b-timeout-far-over s6-below-gate s7-slow-band s7b-slow-fits s8-slow-oneline-band; do
  for arm in base head; do ./run.sh $arm $s $R-$arm-$s; done
done
for arm in base head; do ./run.sh $arm s2-fail-window $R-$arm-s2-t25k ov-t25k.json; done
for arm in base head; do ./run.sh $arm s2-fail-window $R-$arm-s2-hook ov-hook.json; done
for arm in base head; do ./run.sh $arm s5-timeout-window $R-$arm-s5-hookbig ov-hookbig.json; done
echo "== critical"
for s in c1-t100-slow-fail c2-t100-slow-ok c3-t100-fast-fail; do
  for arm in base noclamp head; do ./run.sh $arm $s $R-$arm-$s ov-t100.json; done
done
for arm in base noclamp nohalfcap head; do ./run.sh $arm c4-t600-slow-fail $R-$arm-c4-t600-slow-fail ov-t600.json; done
echo "== sweep"
for T in 300 600 700 800 1000 1300 2000 4000; do
  [ -f ov-t$T.json ] || echo "{\"tools\":{\"truncateToolOutputThreshold\":$T}}" > ov-t$T.json
  for arm in base head; do ./run.sh $arm c4-t600-slow-fail $R-sw-$arm-slow-t$T ov-t$T.json; done
done
for T in 300 800; do ./run.sh nohalfcap c4-t600-slow-fail $R-sw-nohalfcap-slow-t$T ov-t$T.json; done
for T in 600 1000; do
  for arm in base head; do ./run.sh $arm c3-t100-fast-fail $R-sw-$arm-fast-t$T ov-t$T.json; done
done
echo "== repeats"
./run.sh head s2-fail-window r3b-head-s2-fail-window
./run.sh head s7-slow-band r3b-head-s7-slow-band
./run.sh head c4-t600-slow-fail r3b-head-c4-t600-slow-fail ov-t600.json
echo "half-cap intact: $(grep -cE 'Math\.min\(appendedMetadataChars,\s*Math\.floor\(outputThreshold / 2\)\)' /root/git/pr11727/packages/core/dist/src/tools/shell.js)"
echo MATRIX-R3-DONE
