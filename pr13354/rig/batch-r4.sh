#!/bin/bash
# VERIFICATION RIG ONLY (PR #13354): remaining new-head runs, one stack at a time.
R=/Users/wenshao/pr13354-rig
down() { $R/lxx.sh "$R/lx/stop.sh $1 all" | grep -v worker-left | tr '\n' ' '; $R/lxx.sh "kill \$(cat /var/rig/hookrec.pid 2>/dev/null) \$(ps -eo pid=,args= | awk -v d=$R/dist/ 'index(\$0, d) && \$0 !~ /awk/ {print \$1}') 2>/dev/null; sleep 1; ps -eo pid,args | grep -v grep | grep -cE 'node|java'"; true; }
clean() { n=$($R/lxx.sh "ps -eo pid,args | grep -v grep | grep -cE 'node|java'"); [ "$n" = "0" ] || { echo "ABORT: $n processes"; exit 3; }; }
# 1. R3-1 on merge2
clean; D=r5h; mkdir -p $R/results/$D
$R/lxx.sh "mkdir -p $R/run/$D && cd $R/probe && DB=$D WSS=ws-ha,ws-hb $R/lx/node/bin/node manifest.mjs >/dev/null && $R/lx/aux.sh $D > /dev/null && (nohup $R/lx/node/bin/node $R/probe/hookrec.mjs 19154 $R/run/$D/hooks-rec.jsonl > $R/run/$D/hookrec.log 2>&1 & echo \$! > /var/rig/hookrec.pid) && sleep 1"
$R/lxx.sh "HOOKS=$R/run/$D/hooks.json $R/lx/spring.sh merge2 $D" | tail -1; $R/lxx.sh "$R/lx/harness.sh $D merge2" | tail -1
echo "== R3-1 merge2"; $R/lxx.sh "cd $R/probe && DB=$D ARM=merge2 LABEL=merge2 $R/lx/node/bin/node p5c-cand.mjs" 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-400
grep -c "Hosted Hook requires reconciliation" $R/run/$D/harness-0.log; down $D
# 2. Harness-first: base Spring + r4 Harness
clean; D=x3; $R/lxx.sh "$R/lx/aux.sh $D" > /dev/null; $R/lxx.sh "$R/lx/harness.sh $D r4" | tail -1; $R/lxx.sh "$R/lx/spring.sh base $D" | tail -1
echo "== Harness-first r4"; $R/lxx.sh "cd $R/probe && DB=$D ARM=base $R/lx/node/bin/node p7b-harness-first.mjs" 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-300
$R/lxx.sh "cd $R/probe && DB=$D ARM=base $R/lx/node/bin/node q-private.mjs" 2>&1 | cut -c1-250; down $D
# 3. Spring-first: r4 Spring + base Harness
clean; D=x4; $R/lxx.sh "$R/lx/aux.sh $D" > /dev/null; $R/lxx.sh "$R/lx/harness.sh $D base" | tail -1; $R/lxx.sh "$R/lx/spring.sh r4 $D" | tail -1
echo "== Spring-first r4"; $R/lxx.sh "cd $R/probe && DB=$D ARM=r4 $R/lx/node/bin/node p7-mixed.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)" | cut -c1-300; down $D
# 4. contention
clean; N=8 ROUNDS=2 $R/p8-series.sh r4:pr4a
clean; N=8 ROUNDS=3 $R/p8-series.sh merge2:pm2a
clean; N=16 ROUNDS=2 $R/p8-series.sh merge2:pm2b
echo BATCH-DONE
