#!/bin/bash
# VERIFICATION RIG ONLY (PR #13194 round 2): F1 on the fixed head a1c205021f. DB q4.
set -u
R=/Users/wenshao/pr13135-rig; L=$R/lxx.sh; cd $R/p94
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export DB=q4 BASE=http://127.0.0.1:18136 RUNDIR=$R/run/lx-q4
$L "$R/lx/aux.sh q4" | tail -1
$L "DIST=p94head $R/lx/spring.sh p94h2 q4" | tail -1; $L "$R/lx/harness.sh q4 p94head" | tail -1
node p5-mixed.mjs admit ws-mxc c 2>&1 | grep -E "^(PASS|FAIL)"
$L "DIST=p94head $R/lx/spring.sh p94h2 q4" | tail -1
ARCHIVE=1 node p5-mixed.mjs admit ws-mxd d 2>&1 | grep -E "^(PASS|FAIL)"
echo "--- older coordinator without Runtime close support"
$L "DIST=p94head DURABLE=false $R/lx/spring.sh p94base q4" | tail -1
node p5-mixed.mjs observe ws-mxc base-norun 150 2>&1 | grep NOTE | head -1 | cut -c1-260
node p5-mixed.mjs observe ws-mxd base-norun 150 2>&1 | grep NOTE | head -1 | cut -c1-260
$L "$R/lx/stop.sh q4 spring" | grep -v worker-left
echo "--- fixed head only"
$L "DIST=p94head $R/lx/spring.sh p94h2 q4" | tail -1
KEEP_GENLOG=1 TAG=h2 node p5-heal.mjs ws-mxc 120 2>&1 | grep -E "^(PASS|FAIL|NOTE)" | cut -c1-300 &
TAG=h2 node p5-heal.mjs ws-mxd 120 2>&1 | grep -E "^(PASS|FAIL|NOTE)" | cut -c1-300
wait
echo F1-RECHECK-DONE
