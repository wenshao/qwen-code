#!/bin/bash
# VERIFICATION RIG ONLY (PR #13194 round 2): F1 on the fixed head a1c205021f. DB q5.
set -u
R=/Users/wenshao/pr13135-rig; L=$R/lxx.sh; cd $R/p94
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
export DB=q5 BASE=http://127.0.0.1:18136 RUNDIR=$R/run/lx-q5
$L "$R/lx/aux.sh q5" | tail -1
$L "DIST=p94head $R/lx/spring.sh p94h2 q5" | tail -1; $L "$R/lx/harness.sh q5 p94head" | tail -1
node p5-mixed.mjs admit ws-mxe e 2>&1 | grep -E "^(PASS|FAIL)"
$L "DIST=p94head $R/lx/spring.sh p94h2 q5" | tail -1
ARCHIVE=1 node p5-mixed.mjs admit ws-mxf f 2>&1 | grep -E "^(PASS|FAIL)"
echo "--- older coordinator without Runtime close support"
$L "DIST=p94head DURABLE=false $R/lx/spring.sh p94base q5" | tail -1
node p5-mixed.mjs observe ws-mxe base-norun 150 2>&1 | grep NOTE | head -1 | cut -c1-260
node p5-mixed.mjs observe ws-mxf base-norun 150 2>&1 | grep NOTE | head -1 | cut -c1-260
$L "$R/lx/stop.sh q5 spring" | grep -v worker-left
echo "--- fixed head only"
node p5-genlog.mjs on
$L "DIST=p94head $R/lx/spring.sh p94h2 q5" | tail -1
KEEP_GENLOG=1 TAG=h2 node p5-heal.mjs ws-mxe 120 2>&1 | grep -E "^(PASS|FAIL)" | cut -c1-300
KEEP_GENLOG=1 TAG=h2 node p5-heal.mjs ws-mxf 120 2>&1 | grep -E "^(PASS|FAIL)" | cut -c1-300
node p5-genlog.mjs check ws-mxe ws-mxf; grep -m1 "Started ManagedAgentServerApplication" $R/run/lx-q5/spring-3.log | cut -c1-30
echo F1-RECHECK-DONE
