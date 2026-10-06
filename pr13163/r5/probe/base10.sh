#!/bin/bash
# VERIFICATION RIG ONLY: round-5 base arm (main 43a6e1e5) and the n9 drift arm.
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
DB=b10; JAR=b10; D=b10; L=$R/out/$DB/arm-b10.log; mkdir -p $(dirname $L); : > $L
fresh() { bash $R/stop.sh $1 all >> $L 2>&1; sleep 1; bash $R/start9.sh $1 $2 $3 2>&1 | tail -1 >> $L; }
cd $R/probe
fresh $DB $JAR $D
bash $R/batch-n4.sh $DB b10 quick
for x in "f4b-sql-state.mjs ws-f4b e" "c19-rename-race.mjs bound ws-c19 f" "c19-rename-race.mjs unbound - -" "c16-page-caps.mjs ws-p1 a ws-p0 b regen"; do
  echo "### $x" >> $L; DB=$DB $N $x >> $L 2>&1
done
echo "### c14 revoke" >> $L; DB=$DB $N c14-cold-cache.mjs start ws-krevoke-b10 a revoke >> $L 2>&1
bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L
DB=$DB $N c14-cold-cache.mjs cancel ws-krevoke-b10 a revoke >> $L 2>&1
fresh $DB $JAR $D
echo "### c18 store drift (main)" >> $L; bash $R/c18.sh $DB $JAR $D ws-drift-b10 g >> $L 2>&1
bash $R/stop.sh $DB all >> $L 2>&1
# n9 arm: the store-drift answer before b8f92ced
fresh n9x n9 n9
echo "### c18 store drift (30f092d0)" >> $L; bash $R/c18.sh n9x n9 n9 ws-drift-n9 g >> $L 2>&1
bash $R/stop.sh n9x all >> $L 2>&1
echo "BASE10-DONE $(date -u +%T)" >> $L
