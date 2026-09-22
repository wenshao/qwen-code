#!/usr/bin/env bash
R=/root/verify/pr12441; H=/root/verify/pr12441-head; export NODE_PATH=$H/node_modules
S1="$R/ws/demo-project"; S2="$R/ws/demo-project $R/ws/second-project"
run_open() { # arm topo rep
  local arm=$1 topo=$2 rep=$3; local ws; [ $topo = s1 ] && ws=$S1 || ws=$S2
  $R/rig/arm.sh $arm $topo-$arm-r$rep 41441 $ws
  (cd $H && TAG=$topo-$arm-r$rep timeout 150 node $R/rig/open-live.cjs > $R/shots/$topo-$arm-r$rep.out 2>&1); echo "open $topo-$arm-r$rep exit=$?"
}
for rep in 1 2 3; do run_open base s1 $rep; run_open head s1 $rep; done
run_open base s2 1; run_open head s2 1
# mutating probes last
$R/rig/arm.sh head s1-head-continue 41441 $S1; (cd $H && TAG=s1-head timeout 120 node $R/rig/continue-live.cjs > $R/shots/s1-head-continue.out 2>&1); echo "continue exit=$?"
$R/rig/arm.sh head s1-head-prompt 41441 $S1; (cd $H && TAG=s1-head timeout 120 node $R/rig/prompt-live.cjs > $R/shots/s1-head-prompt.out 2>&1); echo "prompt s1-head exit=$?"
$R/rig/arm.sh base s2-base-prompt 41441 $S2; (cd $H && TAG=s2-base MSG='Typed follow-up on the two-project control.' timeout 120 node $R/rig/prompt-live.cjs > $R/shots/s2-base-prompt.out 2>&1); echo "prompt s2-base exit=$?"
echo MATRIX_DONE
