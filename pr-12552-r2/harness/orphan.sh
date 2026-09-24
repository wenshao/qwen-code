#!/bin/bash
MOD=$1; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9574b81d-84d7-47eb-8973-25c7fe90cb49/scratchpad
CP=$MOD/target/classes:$HOME/.m2/repository/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
OUT=$(mktemp -d $S/r2/out.XXXX); javac -nowarn -d $OUT -cp $CP $S/r2/src/*.java 2>&1 | grep -v ^Note
cd $S/r2; rm -f orphan.out
java -cp $OUT:$CP com.alibaba.qwen.code.runtimebroker.OrphanChild $S/bundle/dist/cli.js > orphan.out 2>/dev/null &
JPID=$!
for i in $(seq 50); do grep -q PORT orphan.out && break; sleep 0.2; done
PORT=$(awk '/PORT/{print $2}' orphan.out)
WPID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t | head -1)
echo "broker jvm=$JPID worker pid=$WPID port=$PORT ppid=$(ps -o ppid= -p $WPID | tr -d ' ')"
kill -9 $JPID; wait $JPID 2>/dev/null; sleep 5
echo "5s after kill -9 of the Broker JVM:"; ps -o pid,ppid,etime,command -p $WPID | sed 's|/private/tmp/[^ ]*/bundle/||' | cat
lsof -nP -iTCP:$PORT -sTCP:LISTEN | awk 'NR>1{print "still listening on",$9}'
kill $WPID 2>/dev/null; rm -rf $OUT
