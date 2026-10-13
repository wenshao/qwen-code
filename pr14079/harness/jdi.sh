#!/bin/bash
# usage: jdi.sh <arm> <port> <iterations> <pauseMs>
arm=$1; port=$2; n=$3; pause=$4
java /rig/RacePause.java $port $pause > /rig/jdi-$arm.driver.log 2>&1 &
drv=$!
/rig/run-arm.sh $arm ProbeRaceStressTest -Dstress.seconds=900 -Dstress.iterations=$n \
  "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:$port" > /rig/jdi-$arm.log 2>&1
wait $drv
grep -h -E "^RESULT" /rig/jdi-$arm.log; grep -h "JDI" /rig/jdi-$arm.driver.log
echo "JDI-DONE $arm"
