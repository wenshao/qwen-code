#!/bin/bash
/rig/cwd.sh base 15131 50 observe > /rig/out/phase-cwd-base-observe.out 2>&1 & a=$!
/rig/cwd.sh base 15132 50 kill > /rig/out/phase-cwd-base-kill.out 2>&1 & b=$!
wait $a $b
/rig/cwd.sh pr 15133 50 observe > /rig/out/phase-cwd-pr-observe.out 2>&1 & a=$!
/rig/cwd.sh pr 15134 50 kill > /rig/out/phase-cwd-pr-kill.out 2>&1 & b=$!
wait $a $b
/rig/cwd.sh m4 15135 50 kill > /rig/out/phase-cwd-m4-kill.out 2>&1
cat /rig/out/phase-cwd-*.out
echo PHASE3-DONE
