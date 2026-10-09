#!/bin/bash
# usage: run-arm.sh <label> <java-cp-file> <ts-repo> <worker-entry>
set -u
label=$1; cpfile=$2; tsrepo=$3; worker=$4
R=$HOME/pr13297-rig
export JAVA_HOME=$HOME/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
port=$((34000 + RANDOM % 1000)); token="rig-token-$label"
db="pr13297_${label}_$(date +%s)"
ws=$R/ws-$label; rm -rf "$ws"; mkdir -p "$ws"
curl -s http://127.0.0.1:33299/up > /dev/null
url="jdbc:mysql://127.0.0.1:33298/${db}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false&connectTimeout=3000&socketTimeout=15000"
java -cp "$(cat $cpfile)" com.alibaba.qwen.code.runtimebroker.Pr13297Rig broker $port "$token" "$url" "$worker" "$ws" > $R/runs/broker-$label.log 2>&1 &
bpid=$!
for i in $(seq 1 60); do grep -q RIG_READY $R/runs/broker-$label.log && break; sleep 1; done
grep RIG_READY $R/runs/broker-$label.log || { echo "broker did not start"; tail -20 $R/runs/broker-$label.log; kill $bpid; exit 1; }
node $R/broker/driver.mjs "$tsrepo" $port "$token" 33299 "$ws" > $R/runs/driver-$label.log 2>&1
echo "driver rc=$?"
curl -s http://127.0.0.1:33299/up > /dev/null
kill $bpid; wait $bpid 2>/dev/null
sleep 2
# workers spawned by this broker, by PID from the worker log path
for p in $(pgrep -f "managed-runtime-worker" ); do
  if ps -o ppid= -p $p | grep -q "^ *$bpid$"; then echo "leftover worker $p"; kill $p; fi
done
grep RESULT $R/runs/driver-$label.log
