#!/bin/bash
# VERIFICATION RIG ONLY (PR #13194 round 2): regression probes on the fixed head, DB q6.
R=/Users/wenshao/pr13135-rig; L=$R/lxx.sh; cd $R/p94
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export DB=q6 BASE=http://127.0.0.1:18136 RUNDIR=$R/run/lx-q6
$L "$R/lx/stop.sh q5 all" | grep -v worker-left
$L "$R/lx/aux.sh q6" | tail -1; $L "DIST=p94head $R/lx/spring.sh p94h2 q6" | tail -1; $L "$R/lx/harness.sh q6 p94head" | tail -1
node p1-lifecycle.mjs public ws-h2a a ARCHIVED 2>&1 | grep -E "^(FAIL|==)"
node p1-lifecycle.mjs web ws-h2b b CLOSED 2>&1 | grep -E "^(FAIL|==)"
node p2-edges.mjs ws-h2e e 2>&1 | grep -E "^(FAIL|==)"
node p3-race.mjs ws-h2r r 16 2>&1 | grep -E "^(FAIL|==)"
node p3-race.mjs ws-h2s s 32 2>&1 | grep -E "^(FAIL|==)"
node p7-reads.mjs ws-h2v v 2>&1 | grep -E "^(FAIL|==)"
node p4-crash.mjs ws-h2k k p94h2 p94head 2>&1 | grep -E "^(FAIL|==)|takeover"
$L "$R/lx/stop.sh q6 all" | grep -v worker-left
echo REGRESS-DONE
