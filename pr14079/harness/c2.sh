#!/bin/bash
for a in head cand2; do
  /rig/run-arm.sh $a ProbeRaceStressTest -Dstress.seconds=120 > /rig/stress-c2-$a.log 2>&1 &
done
wait
grep -h "^RESULT" /rig/stress-c2-head.log /rig/stress-c2-cand2.log
/rig/jdi.sh cand2 15075 200 300
/rig/jdi-stock.sh cand2 15076
grep -h -E "JDI RESULT" /rig/jdistock-cand2.driver.log
grep -h -E "Tests run:.*HostedOperatorRecoveryProbeTest|mvn-exit" /rig/jdistock-cand2.log
echo C2-DONE
