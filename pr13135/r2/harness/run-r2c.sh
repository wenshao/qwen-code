#!/bin/bash
# PR #13135 round 2: F6 (new node / fresh state dir) and F4 (container restart) + same-storage control, on DB l2.
R=/Users/wenshao/pr13135-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export DB=l2 BASE=http://127.0.0.1:18136 ARM=head2 RUNDIR=$R/run/lx-l2 STATE=broker
cd $R/probe
echo "=== F6 $(date -u +%T)"
$R/lxx.sh "$R/lx/stop.sh l2 spring TERM | grep -v worker-left; DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1"
$N prep.mjs f6 wsf6 n
$R/lxx.sh "$R/lx/stop.sh l2 spring TERM | grep -v worker-left; STATE=broker-node2 DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1"
$N closeall.mjs f6 F6-new-node-state-dir 90000 blocked 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-330
$N s6-ws-after-block.mjs wsf6-n n f6 wsfree-o o 2>&1 | grep -E "^(PASS|FAIL|NOTE  new|==)"
$R/lxx.sh "$R/lx/stop.sh l2 spring TERM | grep -v worker-left; DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1"
S=$(node -e "console.log(require('$R/out/l2/prep-f6.json')[0].session)")
T0=$(date +%s); for i in $(seq 1 90); do st=$($R/q.sh l2 "select status from managed_agent_session where session_id='$S'" | tail -1); [ "$st" = CLOSED ] && break; sleep 2; done
echo "F6 after restoring the state dir: session=$st after $(( $(date +%s) - T0 ))s"
$N s6-ws-after-block.mjs wsf6-n n f6-after-restore wsfree-o o 2>&1 | grep -E "^(PASS|FAIL|NOTE  new|==)"
echo "=== F4 $(date -u +%T)"
$N prep.mjs f4 wsf4 l,m
$N prep.mjs ctl wsctl q
$R/lxx.sh "readlink /proc/self/ns/pid /proc/self/ns/time" | tr '\n' ' '; echo
docker --context colima-pr13135 restart -t 10 pr13135-lx >/dev/null && echo container-restarted
$R/lxx.sh "readlink /proc/self/ns/pid /proc/self/ns/time; cat /proc/sys/kernel/random/boot_id" | tr '\n' ' '; echo
$R/lxx.sh "HOLD_MS=25000 $R/lx/aux.sh l2 >/dev/null; DIST=head2 $R/lx/spring.sh head2 l2 2>&1 | tail -1; $R/lx/harness.sh l2 head2 | tail -1"
$N closeall.mjs f4 F4-container-restart 120000 any 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-330
$N s6-ws-after-block.mjs wsf4-l l f4 wsfree-p p 2>&1 | grep -E "^(PASS|FAIL|NOTE  new|==)"
$N s6-ws-after-block.mjs wsctl-q q ctl-unclosed-after-container-restart wsfree-t t 2>&1 | grep -E "^(PASS|FAIL|NOTE  new|==)"
$N closeall.mjs ctl F4b-close-after-container-restart 90000 any 2>&1 | grep -E "^(PASS|FAIL|==)" | cut -c1-330
$N s6-ws-after-block.mjs wsctl-q q ctl-after-close wsfree-t t 2>&1 | grep -E "^(PASS|FAIL|NOTE  new|==)"
echo RUN-R2C-DONE $(date -u +%T)
