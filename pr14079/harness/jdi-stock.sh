#!/bin/bash
# usage: jdi-stock.sh <arm> <port>
arm=$1; port=$2
java /rig/RacePause.java $port 300 > /rig/jdistock-$arm.driver.log 2>&1 &
drv=$!
/rig/run-arm.sh $arm HostedOperatorRecoveryProbeTest \
  "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:$port" > /rig/jdistock-$arm.log 2>&1
echo "mvn-exit=$?" >> /rig/jdistock-$arm.log
wait $drv
