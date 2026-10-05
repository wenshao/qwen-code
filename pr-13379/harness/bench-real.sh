#!/bin/bash
# Fresh-process measurements on the on-disk (ext4) bench fixture, arms alternated.
#  probe : one-refresh.mjs = time of refreshCacheWithSnapshot only (built core dist)
#  cli   : wall clock of the real bundled `qwen extensions list`
#  cold  : same, after `sync; echo 3 > /proc/sys/vm/drop_caches`
R=/root/verify/pr13379
H=$R/fx/bench-home
EXT=$H/.qwen/extensions
OUT=$R/out/bench/real.jsonl
: > $OUT
now() { date +%s%N; }
run_cli() { # arm
  local t0=$(now)
  $R/harness/run-cli.sh $1 $H $R/ws -- extensions list > $R/out/bench/cli-$1.last 2>&1
  local rc=$?; local t1=$(now)
  echo "{\"kind\":\"$KIND\",\"arm\":\"$1\",\"rc\":$rc,\"ms\":$(( (t1-t0)/1000000 )),\"lines\":$(wc -l < $R/out/bench/cli-$1.last)}" >> $OUT
}
run_probe() { # arm
  node $R/harness/one-refresh.mjs $1 $EXT | sed "s/^{/{\"kind\":\"$KIND\",/" >> $OUT
}
# warm-up both arms once (not recorded)
for a in base head; do node $R/harness/one-refresh.mjs $a $EXT >/dev/null; $R/harness/run-cli.sh $a $H $R/ws -- extensions list >/dev/null 2>&1; done
for i in $(seq 1 15); do
  for a in base head; do KIND=probe-warm run_probe $a; KIND=cli-warm run_cli $a; done
done
for i in $(seq 1 8); do
  for a in base head; do
    sync; echo 3 > /proc/sys/vm/drop_caches; KIND=probe-cold run_probe $a
    sync; echo 3 > /proc/sys/vm/drop_caches; KIND=cli-cold run_cli $a
  done
done
echo REAL_DONE
