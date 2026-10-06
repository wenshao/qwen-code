#!/bin/bash
# VERIFICATION RIG ONLY: round-5 reruns with corrected probes (c19 sync, c14 settle gap).
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
L=$R/out/rerun10.log; : > $L
fresh() { bash $R/stop.sh $1 all >> $L 2>&1; sleep 1; bash $R/start9.sh $1 $2 $3 2>&1 | tail -1 >> $L; }
cd $R/probe
for arm in "h10 n10 n10" "b10 b10 b10"; do
  set -- $arm; DB=$1; JAR=$2; D=$3
  fresh $DB $JAR $D
  for k in bound unbound; do echo "### [$DB] c19 $k" >> $L; DB=$DB $N c19-rename-race.mjs $k ws-c19b-$DB f >> $L 2>&1; done
  if [ $DB = h10 ]; then
    for m in revoke none; do
      echo "### [$DB] c14 $m (settle 3 s)" >> $L; DB=$DB $N c14-cold-cache.mjs start ws-ks$m a $m >> $L 2>&1
      bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L
      DB=$DB $N c14-cold-cache.mjs cancel ws-ks$m a $m >> $L 2>&1
    done
  fi
  bash $R/stop.sh $DB all >> $L 2>&1
done
echo "RERUN10-DONE $(date -u +%T)" >> $L
