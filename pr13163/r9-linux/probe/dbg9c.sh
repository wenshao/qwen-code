#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): approval-answer A/B with the store-only replica B neutralised
# (scan-delay 3600s, so its ActionResponseCoordinator cannot claim ACTION_RESPONSE retries).  usage: dbg9c.sh <h9|x9|b9>...
R=/root/v13163/rigd; N=/usr/bin/node; L=$R/out/dbg9c.log; mkdir -p $R/out; : > $L
for ARM in "$@"; do
  case $ARM in h9) JAR=h9; D=h9;; x9) JAR=x9; D=h9;; b9) JAR=b9; D=b9;; esac; DB=c$ARM
  bash $R/stop.sh $DB all >> $L 2>&1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
  SPRING_EXTRA="--qwen.managed-agent.dispatch.scan-delay=3600s" ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  export SPRING_EXTRA="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG"
  STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
  COLD="bash $R/stop.sh $DB spring > /dev/null; STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
  run() { echo "### [$ARM $(date -u +%T)] $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); }
  run $N c23-approve-retry.mjs ws-a1 a revoke restore
  run $N c23-approve-retry.mjs ws-a2 b revoke cancel
  run $N c23-approve-retry.mjs ws-a3 c draining restore
  run $N c23-approve-retry.mjs ws-a5 e regen restore
  run env RESTART_CMD="$COLD" $N c23-approve-retry.mjs ws-a7 f revoke restore
  echo "[$ARM] latch lines: $(grep -c "session log writes stopped" $(ls -t $R/run/$DB/harness-*.log | head -1)); B claims: $(grep -c "Action response" $R/run/$DB/springb-*.log | awk -F: "{s+=\$2} END {print s}")" >> $L
  for f in $R/run/$DB/spring-*.log; do grep -h "Action response" $f | sed -E "s/^(.{24}).*operation=([a-z0-9_]{10}).*failure=/[$ARM] \1 \2 /" | cut -c1-210; done >> $L
  unset SPRING_EXTRA
  bash $R/stop.sh $DB all >> $L 2>&1
  sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rigd/dist/\")==1 {print \$1}"); [ -n "$W" ] && kill $W 2>/dev/null
done
echo "DBG9C-DONE $(date -u +%T)" >> $L
