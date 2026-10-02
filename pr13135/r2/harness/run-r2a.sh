#!/bin/bash
# PR #13135 round 2 (head2 d7c5c5e50e): core real-stack matrix on DB l2.
R=/Users/wenshao/pr13135-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export DB=l2 BASE=http://127.0.0.1:18136 ARM=head2 RUNDIR=$R/run/lx-l2 STATE=broker
$R/lxx.sh "$R/lx/stop.sh r41b all | grep -v worker-left; HOLD_MS=25000 $R/lx/aux.sh l2 >/dev/null; DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1; $R/lx/harness.sh l2 head2 | tail -1"
cd $R/probe
for s in "s1-close.mjs public ws-a a" "s1-close.mjs web ws-b b" "s2v2-active.mjs ws-c c" "s3-shared.mjs ws-d d" "s4-warm-race.mjs ws-e e 8 0" "s4-warm-race.mjs ws-e e 5 300"; do
  echo "=== $s $(date -u +%T)"; $N $s 2>&1 | grep -E "^(FAIL|==)"
done
echo "=== F1 worker kill $(date -u +%T)"
$N prep.mjs k1 wsk f
P=$(node -e "console.log(require('$R/out/l2/prep-k1.json')[0].pid)"); $R/lxx.sh "kill -9 $P; sleep 1; [ -d /proc/$P ] && echo still || echo gone"
$N closeall.mjs k1 F1-worker-killed 60000 completed 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-200
echo RUN-R2A-DONE $(date -u +%T)
