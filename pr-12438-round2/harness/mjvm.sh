#!/bin/bash
# Multi-JVM scenarios on a shared MySQL 8.4 (container pr12438-mysql84).
# usage: mjvm.sh <module-dir> M1|M2|M3|M4
MOD=$1; SC=$2
H=/root/verify/pr12438-r2-harness
OUT=$H/probes/out-mjvm
CP=$MOD/target/classes:/root/.m2/repository/com/mysql/mysql-connector-j/9.7.0/mysql-connector-j-9.7.0.jar
mkdir -p $OUT; javac -nowarn --release 21 -d $OUT -cp $CP $H/probes/src/com/alibaba/qwen/code/runtimebroker/*.java 2>&1 | grep -v '^Note:'
URL="jdbc:mysql://127.0.0.1:34384/broker?user=root&useSSL=false&allowPublicKeyRetrieval=true&connectionTimeZone=UTC"
J="java -cp $OUT:$CP"
sql() { docker exec pr12438-mysql84 mysql -uroot -t broker -e "$1" 2>/dev/null; }
WS="ws-$SC-$(date +%s)"
cy() { printf '\033[1;36m%s\033[0m\n' "$*"; }
case $SC in
M1)
  cy "M1  6 Broker JVMs warm one workspace at the same instant; provisioning 3000 ms, operation lease 1500 ms (renewed every 500 ms against MySQL time)"
  AT=$(( $(date +%s%3N) + 1500 ))
  for i in 1 2 3 4 5 6; do
    $J -DstartAt=$AT -DprovisionMillis=3000 -DleaseMillis=1500 com.alibaba.qwen.code.runtimebroker.BrokerNode broker-$i "$URL" warm-retry $WS 8000 > $H/logs/m1-$i.log 2>&1 &
  done; wait
  sort -k1,1 $H/logs/m1-*.log | grep -v "^$"
  sql "SELECT owner, lease_id FROM probe_provision_log WHERE workspace='$WS'"
  sql "SELECT runtime_generation AS gen, binding_state, runtime_lease_id AS lease, operation_owner, operation_generation AS op_gen, record_version AS ver FROM qwen_runtime_binding WHERE workspace_id='$WS'"
  ;;
M2)
  cy "M2  zombie provisioner: broker-A provisions (6000 ms, lease 2000 ms) and is SIGSTOPped for 5 s; broker-B takes over; A resumes"
  $J -DprovisionMillis=6000 -DleaseMillis=2000 com.alibaba.qwen.code.runtimebroker.BrokerNode broker-A "$URL" warm-retry $WS 1 > $H/logs/m2-A.log 2>&1 &
  APID=$!; sleep 1.5
  echo "$(date +%T.%3N) [harness] SIGSTOP broker-A" > $H/logs/m2-H.log; kill -STOP $APID
  sleep 0.5
  $J -DprovisionMillis=500 -DleaseMillis=2000 com.alibaba.qwen.code.runtimebroker.BrokerNode broker-B "$URL" warm-retry $WS 8000 > $H/logs/m2-B.log 2>&1 &
  BPID=$!; sleep 4.5
  echo "$(date +%T.%3N) [harness] SIGCONT broker-A" >> $H/logs/m2-H.log; kill -CONT $APID
  wait $APID; wait $BPID
  sort -k1,1 $H/logs/m2-A.log $H/logs/m2-B.log $H/logs/m2-H.log
  sql "SELECT owner, lease_id FROM probe_provision_log WHERE workspace='$WS'"
  sql "SELECT runtime_generation AS gen, binding_state, runtime_lease_id AS lease, operation_owner, operation_generation AS op_gen, record_version AS ver FROM qwen_runtime_binding WHERE workspace_id='$WS'"
  ;;
M3)
  cy "M3  broker-A is kill -9'd mid-provision (lease 2000 ms); broker-B retries until it can take over"
  $J -DprovisionMillis=60000 -DleaseMillis=2000 com.alibaba.qwen.code.runtimebroker.BrokerNode broker-A "$URL" warm-retry $WS 1 > $H/logs/m3-A.log 2>&1 &
  APID=$!; sleep 1.5; echo "$(date +%T.%3N) [harness] kill -9 broker-A" > $H/logs/m3-H.log; kill -9 $APID; wait $APID 2>/dev/null
  $J -DprovisionMillis=500 -DleaseMillis=2000 com.alibaba.qwen.code.runtimebroker.BrokerNode broker-B "$URL" warm-retry $WS 8000 > $H/logs/m3-B.log 2>&1
  sort -k1,1 $H/logs/m3-A.log $H/logs/m3-B.log $H/logs/m3-H.log
  sql "SELECT owner, lease_id FROM probe_provision_log WHERE workspace='$WS'"
  sql "SELECT runtime_generation AS gen, binding_state, runtime_lease_id AS lease, operation_owner, operation_generation AS op_gen, record_version AS ver FROM qwen_runtime_binding WHERE workspace_id='$WS'"
  ;;
M4)
  cy "M4  restart: broker-1 provisions + acquires rs-1 and exits; a new process with the SAME owner id starts"
  $J com.alibaba.qwen.code.runtimebroker.BrokerNode broker-1 "$URL" acquire-and-exit $WS
  $J com.alibaba.qwen.code.runtimebroker.BrokerNode broker-1 "$URL" after-restart $WS
  sql "SELECT owner, lease_id FROM probe_provision_log WHERE workspace='$WS'"
  sql "SELECT runtime_session_id, harness_session_id, session_state, runtime_generation FROM qwen_runtime_session WHERE workspace_id='$WS'"
  ;;
esac
