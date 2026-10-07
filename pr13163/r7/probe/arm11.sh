#!/bin/bash
# VERIFICATION RIG ONLY: round-7 arms.  usage: arm11.sh <head|x|base>
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
case $1 in head) DB=h11; JAR=n11; D=n11;; x) DB=x11; JAR=x11; D=x11;; base) DB=b11; JAR=b11; D=b11;; esac
L=$R/out/$DB/arm-$1.log; mkdir -p $(dirname $L); : > $L
fresh() { bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L; DIST=$D bash $R/spring.sh $JAR $DB ${1:-absent} absent 2>&1 | tail -1 >> $L; }
restart() { bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L; }
run() { echo "### [$DB] $*" >> $L; (cd $R/probe && DB=$DB $N "$@" >> $L 2>&1); }
c14() { echo "### [$DB] c14 $1" >> $L; (cd $R/probe && DB=$DB $N c14-cold-cache.mjs start ws-k$1-$DB $2 $1 >> $L 2>&1); restart; run c14-cold-cache.mjs cancel ws-k$1-$DB $2 $1; }
fresh
if [ $1 = head ]; then
  bash $R/batch-n4.sh $DB arm
  run c16-page-caps.mjs ws-p1 b ws-p0 c regen
  run f4b-sql-state.mjs ws-f4b d
  for k in bound unbound; do run c19-rename-race.mjs $k ws-c19-$k e; run c21-boundary-moved.mjs $k ws-c21-$k e; done
fi
if [ $1 = base ]; then
  for k in bound unbound; do run c19-rename-race.mjs $k ws-c19-$k e; run c21-boundary-moved.mjs $k ws-c21-$k e; done
fi
fresh; c14 revoke a; fresh; c14 none g
if [ $1 != x ]; then fresh default; run c22-approve-refused.mjs ws-c22 f; fi
bash $R/stop.sh $DB all >> $L 2>&1
echo "ARM11-DONE $1 $(date -u +%T)" >> $L
