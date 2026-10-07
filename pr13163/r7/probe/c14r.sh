#!/bin/bash
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
DB=h11r; JAR=n11; D=n11; L=$R/out/h11r.log; : > $L
for st in b c; do
  bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/start9.sh $DB $JAR $D 2>&1 | tail -1 >> $L
  echo "### c14 revoke st-$st" >> $L
  (cd $R/probe && DB=$DB $N c14-cold-cache.mjs start ws-kr$st $st revoke >> $L 2>&1)
  bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L
  (cd $R/probe && DB=$DB $N c14-cold-cache.mjs cancel ws-kr$st $st revoke >> $L 2>&1)
  echo "latch lines: $(/usr/bin/grep -c 'session log writes stopped' $(ls -t $R/run/$DB/harness-*.log | head -1))" >> $L
done
bash $R/stop.sh $DB all >> $L 2>&1
echo C14R-DONE >> $L
