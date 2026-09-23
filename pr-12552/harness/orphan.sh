#!/bin/bash
MOD=${1:-/root/verify/pr12552/packages/sdk-java/runtime-broker}
H=/root/verify/pr12552-harness
CP=$H/out:$MOD/target/classes:$HOME/.m2/repository/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
cd $H; java -cp $CP com.alibaba.qwen.code.runtimebroker.OrphanChild /root/verify/pr12522/dist/cli.js > orphan.out 2>/dev/null &
JPID=$!
for i in $(seq 50); do grep -q PORT orphan.out && break; sleep 0.2; done
PORT=$(awk '/PORT/{print $2}' orphan.out)
WPID=$(ss -ltnpH "sport = :$PORT" | grep -o 'pid=[0-9]*' | cut -d= -f2)
echo "broker jvm=$JPID worker pid=$WPID port=$PORT ppid=$(ps -o ppid= -p $WPID)"
kill -9 $JPID; sleep 5
echo "5s after kill -9 of the Broker JVM:"; ps -o pid,ppid,etime,cmd -p $WPID | cat
ss -ltnH "sport = :$PORT" | awk '{print "still listening on",$4}'
kill $WPID 2>/dev/null
