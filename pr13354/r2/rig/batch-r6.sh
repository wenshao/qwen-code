#!/bin/bash
# VERIFICATION RIG ONLY (PR #13354): round 6 — head 2c4036c5ea (h6) vs current main 8505479d87 (main6).
R=/Users/wenshao/pr13354-rig
down() { $R/lxx.sh "$R/lx/stop.sh $1 all" | grep -v worker-left | tr '\n' ' '; $R/lxx.sh "kill \$(cat /var/rig/hookrec.pid 2>/dev/null) \$(ps -eo pid=,args= | awk -v d=$R/dist/ 'index(\$0, d) && \$0 !~ /awk/ {print \$1}') 2>/dev/null; sleep 1; ps -eo pid,args | grep -v grep | grep -cE 'node|java'"; true; }
clean() { n=$($R/lxx.sh "ps -eo pid,args | grep -v grep | grep -cE 'node|java'"); [ "$n" = "0" ] || { echo "ABORT: $n processes"; exit 3; }; }
hooked() { D=$1; A=$2; mkdir -p $R/results/$D; $R/lxx.sh "mkdir -p $R/run/$D && cd $R/probe && DB=$D WSS=ws-ha,ws-hb $R/lx/node/bin/node manifest.mjs >/dev/null && $R/lx/aux.sh $D > /dev/null && (nohup $R/lx/node/bin/node $R/probe/hookrec.mjs 19154 $R/run/$D/hooks-rec.jsonl > $R/run/$D/hookrec.log 2>&1 & echo \$! > /var/rig/hookrec.pid) && sleep 1"; $R/lxx.sh "HOOKS=$R/run/$D/hooks.json $R/lx/spring.sh $A $D" | tail -1; $R/lxx.sh "$R/lx/harness.sh $D $A" | tail -1; }
plain() { D=$1; SA=$2; HA=$3; mkdir -p $R/results/$D; $R/lxx.sh "$R/lx/aux.sh $D" > /dev/null; $R/lxx.sh "$R/lx/harness.sh $D $HA" | tail -1; $R/lxx.sh "$R/lx/spring.sh $SA $D" | tail -1; }
run() { D=$1; A=$2; shift 2; $R/lxx.sh "cd $R/probe && DB=$D ARM=$A $* " 2>&1 | grep -E "^(PASS|FAIL|NOTE  \[|==)|Error|private session" | cut -c1-420; }
echo "#### 1 suite h6"; clean; $R/suite.sh h6 t6 | grep -vE "^(spring|harness) pid"
echo "#### 2 F1 hooked + Spring TERM"; clean; hooked f6a h6; run f6a h6 "LABEL=h6 SIG=TERM $R/lx/node/bin/node p5c-cand.mjs"; down f6a
echo "#### 3 F1 hooked + Spring KILL"; clean; hooked f6b h6; run f6b h6 "LABEL=h6 SIG=KILL $R/lx/node/bin/node p5c-cand.mjs"; down f6b
echo "#### 4 hooked + Harness TERM"; clean; hooked f6c h6; run f6c h6 "LABEL=h6 RESTART=harness $R/lx/node/bin/node p5c-cand.mjs"; down f6c
echo "#### 5 G3 Harness restart"; clean; plain g6 h6 h6; run g6 h6 "$R/lx/node/bin/node p10-harness-restart.mjs"; down g6
echo "#### 6 Harness-first main6 Spring + h6 Harness"; clean; plain x7 main6 h6; run x7 main6 "$R/lx/node/bin/node p7b-harness-first.mjs"; run x7 main6 "$R/lx/node/bin/node q-private.mjs"; down x7
echo "#### 7 Spring-first h6 Spring + main6 Harness"; clean; plain x8 h6 main6; run x8 h6 "$R/lx/node/bin/node p7-mixed.mjs"; down x8
echo "#### 8 upgrade main6 -> h6"; clean; plain u6 main6 main6; run u6 main6 "$R/lx/node/bin/node p6-upgrade.mjs prep"; $R/lxx.sh "$R/lx/stop.sh u6 all" > /dev/null; $R/lxx.sh "$R/lx/aux.sh u6" > /dev/null; run u6 h6 "UP=h6 EXPECT_V=48 $R/lx/node/bin/node p6-upgrade.mjs upgrade"; down u6
echo "#### 9 contention"; clean; N=8 ROUNDS=3 $R/p8-series.sh main6:q8m h6:q8h; N=16 ROUNDS=2 $R/p8-series.sh main6:q16m h6:q16h
echo BATCH-R6-DONE
