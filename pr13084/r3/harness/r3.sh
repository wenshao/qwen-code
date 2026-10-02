#!/bin/bash
# Round 3: head 8b0e0175 (F1 guarded read retries + main 47463b79 + V30). Pre-fix arm = f288be92 (same tree minus the F1 fix).
R=$(cd $(dirname $0); pwd); cd $R; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
H=head-8b0e0175; PRE=merge3v30-f288be92; M=main-47463b79
ok() { grep -q "harness via tap: 200" run/last-restart.log || { echo "RESTART FAILED $*"; tail -5 run/last-restart.log; exit 9; }; }
p() { grep -E "^\[" | cut -c1-900; }
./stop.sh oss > /dev/null   # reload the patched OSS double
echo "=== R3-1 smoke + lifecycle (head)"; ./restart.sh $H o41r3a > run/last-restart.log 2>&1; ok a
grep -o "Successfully applied [0-9]* migration[^,]*, now at version v[0-9]* ([^)]*)" ../logs/spring-$H-o41r3a.log | head -1
DB=o41r3a $N s0-smoke.mjs 2>&1 | p; DB=o41r3a LABEL=s1-r3 $N s1-lifecycle.mjs 2>&1 | grep -E "closed\]|archived\]|B\.(retirement|pubs|public-after|content-after|new-writer|restore|resource|oss)" | cut -c1-300
echo "=== R3-2 F1 retries: after the fix (head)"; ./restart.sh $H o41r3f > run/last-restart.log 2>&1; ok f
DB=o41r3f ARM=post-fix ST=st-s30 ST2=st-s31 ST3=st-s34 $N s15-retry.mjs 2>&1 | p
echo "=== R3-3 F1 retries: before the fix (f288be92)"; ./restart.sh $PRE o41r3p > run/last-restart.log 2>&1; ok p
DB=o41r3p ARM=pre-fix ST=st-s35 ST2=st-s36 ST3=st-s37 $N s15-retry.mjs 2>&1 | p
echo "=== R3-4 reads (head)"; ./restart.sh $H o41r3reads > run/last-restart.log 2>&1; ok reads
DB=o41r3reads ARM=head-r3 MODE=expire ST=st-s26 SUFFIX=-2m $N s3-reads.mjs 2>&1 | grep "^\[result" | cut -c1-600
DB=o41r3reads ARM=head-r3 MODE=delete ST=st-s27 $N s3-reads.mjs 2>&1 | grep "^\[result" | cut -c1-600
echo "=== R3-5 upgrade main 47463b79 -> head"; rm -f out/s16-state.json; ./restart.sh $M o41r3up > run/last-restart.log 2>&1; ok up-main
DB=o41r3up PHASE=make $N s16-upgrade.mjs 2>&1 | p
./restart.sh $H o41r3up > run/last-restart.log 2>&1; ok up-head
DB=o41r3up PHASE=check $N s16-upgrade.mjs 2>&1 | p
echo "=== R3-6 cost (head, direct)"; READ_TIMEOUT=10m ./restart.sh $H o41r3cost > run/last-restart.log 2>&1; ok cost
DB=o41r3cost ARM=head-r3 ST=st-s51 $N s6-cost.mjs 2>&1 | grep -E "^\[(full|range)\]" | cut -c1-500
./stop.sh harness spring > /dev/null
echo R3-DONE
