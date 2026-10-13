#!/bin/bash
/rig/jdi.sh m1 15111 200 300 > /rig/out/phase-jdi-m1.out 2>&1 & p1=$!
/rig/jdi.sh m2 15112 200 300 > /rig/out/phase-jdi-m2.out 2>&1 & p2=$!
wait $p1 $p2
/rig/jdi-stock.sh base 15121 > /rig/out/phase-jdistock-base.out 2>&1 & p3=$!
/rig/jdi-stock.sh pr 15122 > /rig/out/phase-jdistock-pr.out 2>&1 & p4=$!
wait $p3 $p4
cat /rig/out/phase-jdi-m1.out /rig/out/phase-jdi-m2.out /rig/out/phase-jdistock-base.out /rig/out/phase-jdistock-pr.out
echo PHASE2-DONE
