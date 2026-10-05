#!/bin/bash
# VERIFICATION RIG ONLY (PR #13354): regression suite for one arm on one fresh DB.  usage: suite.sh <arm> <db>
R=/Users/wenshao/pr13354-rig; A=$1; D=$2
down() { $R/lxx.sh "$R/lx/stop.sh $D all" | grep -v worker-left | tr '\n' ' '; $R/lxx.sh "kill \$(cat /var/rig/hookrec.pid 2>/dev/null) \$(ps -eo pid=,args= | awk -v d=$R/dist/ 'index(\$0, d) && \$0 !~ /awk/ {print \$1}') 2>/dev/null; sleep 1; ps -eo pid,args | grep -v grep | grep -cE 'node|java'"; }
n=$($R/lxx.sh "ps -eo pid,args | grep -v grep | grep -cE 'node|java'"); [ "$n" = "0" ] || { echo "ABORT: $n node/java processes already running"; exit 3; }
mkdir -p $R/results/$D
$R/lxx.sh "mkdir -p $R/run/$D && cd $R/probe && DB=$D WSS=ws-h $R/lx/node/bin/node manifest.mjs >/dev/null && $R/lx/aux.sh $D > /dev/null && (nohup $R/lx/node/bin/node $R/probe/hookrec.mjs 19154 $R/run/$D/hooks-rec.jsonl > $R/run/$D/hookrec.log 2>&1 & echo \$! > /var/rig/hookrec.pid) && sleep 1"
$R/lxx.sh "HOOKS=$R/run/$D/hooks.json $R/lx/spring.sh $A $D" | tail -1; $R/lxx.sh "$R/lx/harness.sh $D $A" | tail -1
for p in "p1-delete.mjs 2" "p2-edges.mjs" "p5-hooks.mjs basic" "p3-restart.mjs TERM" "p4-crash.mjs A,B,C"; do
  $R/lxx.sh "cd $R/probe && DB=$D ARM=$A $R/lx/node/bin/node $p" 2>&1 | grep -E "^(FAIL|==)|Error" | cut -c1-260
done
$R/lxx.sh "$R/lx/stop.sh $D spring TERM" > /dev/null; $R/lxx.sh "MODE=default HOOKS=$R/run/$D/hooks.json $R/lx/spring.sh $A $D" | tail -1
$R/lxx.sh "cd $R/probe && DB=$D ARM=$A $R/lx/node/bin/node p9-approval.mjs" 2>&1 | grep -E "^(FAIL|==)|Error" | cut -c1-260
down
