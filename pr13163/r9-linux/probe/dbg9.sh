#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): debug arm (second port set) — why does a revoked-then-restored approval never deliver?
R=/root/v13163/rigd; N=/usr/bin/node; DB=${DB:-dbg9}; JAR=${JAR:-h9}; D=${D:-h9}; L=$R/out/$DB.log; mkdir -p $R/out; : > $L
export SPRING_EXTRA="--logging.level.com.alibaba.qwen.code.managedagent.service.ActionResponseCoordinator=DEBUG"
bash $R/stop.sh $DB all >> $L 2>&1; bash $R/aux.sh $DB > /dev/null 2>&1; bash $R/harness.sh $DB $D 2>&1 | tail -1 >> $L
ROLE=store bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L; STORE=b APPROVAL=default DIST=$D bash $R/spring.sh $JAR $DB 2>&1 | tail -1 >> $L
for spec in "${@:-ws-d1 a revoke restore}"; do echo "### $spec" >> $L; (cd $R/probe && env DB=$DB $N c23-approve-retry.mjs $spec >> $L 2>&1); done
grep -h "Action response" $(ls -t $R/run/$DB/spring-*.log | head -1) | sed -E "s/^.{0,40}(DEBUG|WARN)/\1/" | cut -c1-400 | sort | uniq -c | sort -rn | head -20 >> $L
bash $R/stop.sh $DB all >> $L 2>&1
sleep 2; W=$(ps -eo pid,args | awk "\$2==\"/usr/bin/node\" && index(\$3, \"/root/v13163/rigd/dist/\")==1 {print \$1}"); [ -n "$W" ] && kill $W 2>/dev/null
echo "DBG9-DONE $(date -u +%T)" >> $L
