#!/bin/bash
S=$SCRATCH
MY="/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P33642"
J=/Users/wenshao/Install/jdk21/bin/java
cp() { echo $S/rig/bench/out-$1:$(ls -d $S/rig/cp-$1/BOOT-INF/lib/*.jar | tr '\n' ':'); }
url() { echo "jdbc:mysql://127.0.0.1:33642/$1?allowPublicKeyRetrieval=true&useSSL=false"; }
for n in 0 2000 20000; do
  for arm in base head; do
    DB=bench2_${arm}_$n
    $S/rig/boot.sh $S/jars/$arm.jar mysql $DB bench2-$arm-$n SERVER_PORT=18652 BROKER_PORT=18653 > /dev/null
    pid=$(cat $S/rig/logs/bench2-$arm-$n.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done
  done
  t0=$(date +%s); $J -cp "$(cp head)" com.alibaba.qwen.code.runtimebroker.Bench seedreal "$(url bench2_head_$n)" $n 2>/dev/null | sed "s/^/[N=$n] /"; echo "[N=$n] seeding took $(( $(date +%s) - t0 ))s"
  $MY -e "INSERT INTO bench2_base_$n.qwen_runtime_binding SELECT * FROM bench2_head_$n.qwen_runtime_binding" 2>/dev/null
  for arm in base head; do
    $J -cp "$(cp $arm)" com.alibaba.qwen.code.runtimebroker.Bench measure "$(url bench2_${arm}_$n)" 15 "$arm N=$n" 2>&1 | grep -v Commons | head -3
  done
done
