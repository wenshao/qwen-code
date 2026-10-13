#!/bin/bash
# usage: jdi-stock.sh <arm> <port>   -- the unmodified HostedOperatorRecoveryProbeTest under RacePause (300 ms)
arm=$1; port=$2
java /rig/RacePause.java $port 300 > /rig/out/jdistock-$arm.driver.log 2>&1 &
drv=$!
/rig/run-arm.sh $arm HostedOperatorRecoveryProbeTest \
  "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:$port" > /rig/out/jdistock-$arm.log 2>&1
echo "mvn-exit=$?" >> /rig/out/jdistock-$arm.log
wait $drv
echo "== jdistock $arm"; grep -h "JDI RESULT" /rig/out/jdistock-$arm.driver.log
grep -h -E "Tests run:.*HostedOperatorRecoveryProbeTest|^java\.io\.IOException|^java\.lang\.AssertionError|mvn-exit" /rig/out/jdistock-$arm.log | head -5
