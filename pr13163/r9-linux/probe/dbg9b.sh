#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): single-dispatcher topology (no store-only replica B, whose ActionResponseCoordinator
# also claims ACTION_RESPONSE retries and fails them with "Hosted Actions are unavailable"). Re-runs revoke->restore.
R=/root/v13163/rigd; N=/usr/bin/node; DB=${DB:-dbg9b}; JAR=${JAR:-h9}; D=${D:-h9}; L=$R/out/$DB.log; mkdir -p $R/out; : > $L
export SPRING_EXTRA="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG"
bash $R/stop.sh $DB all >> $L 2>&1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
COLD="bash $R/stop.sh $DB spring > /dev/null; APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB"
run() { echo "### $*" >> $L; (cd $R/probe && env DB=$DB "$@" >> $L 2>&1); }
run $N c23-approve-retry.mjs ws-s1 a revoke restore
run $N c23-approve-retry.mjs ws-s2 b revoke restore
run env HOLD=30000 $N c23-approve-retry.mjs ws-s3 c revoke restore
run env RESTART_CMD="$COLD" $N c23-approve-retry.mjs ws-s4 d revoke restore
echo "latch lines: $(grep -c "session log writes stopped" $(ls -t $R/run/$DB/harness-*.log | head -1))" >> $L
for f in $R/run/$DB/spring-*.log; do grep -h "Action response" $f | sed -E "s/^(.{24}).*operation=([a-z0-9_]{10}).*failure=/\1 \2 /" | cut -c1-200; done >> $L
bash $R/stop.sh $DB all >> $L 2>&1
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rigd/dist/\")==1 {print \$1}"); [ -n "$W" ] && kill $W 2>/dev/null
echo "DBG9B-DONE $(date -u +%T)" >> $L
