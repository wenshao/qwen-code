#!/bin/bash
# usage: cwd.sh <arm> <port> <iterations> <kill|observe>
arm=$1; port=$2; n=$3; mode=$4; tag=$arm-$mode
java /rig/CwdKill.java $port /rig/cwd-$tag.pid $mode > /rig/out/cwd-$tag.driver.log 2>&1 & drv=$!
/rig/run-arm.sh $arm CwdRaceTest -Dstress.iterations=$n -Dcwd.pidfile=/rig/cwd-$tag.pid \
  "-Dmaven.surefire.debug=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:$port" > /rig/out/cwd-$tag.log 2>&1
wait $drv
echo "== cwd $tag"; grep -h -E "^CWDRESULT|^CWDSAMPLE" /rig/out/cwd-$tag.log; grep -h "JDI RESULT" /rig/out/cwd-$tag.driver.log
grep -c "procGone=true" /rig/out/cwd-$tag.driver.log | sed "s/^/procGoneTrue=/"
