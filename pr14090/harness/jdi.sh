#!/bin/bash
# usage: jdi.sh <arm> <port> <iterations> <pauseMs>   -- stress loop of the stock test body under RacePause
arm=$1; port=$2; n=$3; pause=$4
java /rig/RacePause.java $port $pause > /rig/out/jdi-$arm.driver.log 2>&1 &
drv=$!
/rig/run-arm.sh $arm ProbeRaceStressTest -Dstress.seconds=900 -Dstress.iterations=$n \
  "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:$port" > /rig/out/jdi-$arm.log 2>&1
wait $drv
echo "== jdi $arm"; grep -h -E "^RESULT|^SAMPLE" /rig/out/jdi-$arm.log; grep -h "JDI RESULT" /rig/out/jdi-$arm.driver.log
