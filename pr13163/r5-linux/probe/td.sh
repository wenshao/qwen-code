#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): teardown-vs-passive-adoption race for one Harness bundle.  usage: td.sh <db> <dist> <tag>
R=/root/v13163/rig; DB=$1; D=$2; TAG=$3; N=/usr/bin/node; . $R/rig.env
RUN=$R/run/$DB; mkdir -p $RUN $R/out/$DB; L=$R/out/$DB/td-$TAG.log; : > $L
echo '[]' > $RUN/btap-rules.json
setsid nohup $N $R/probe/tap.mjs 18172 $BROKER_PORT $RUN/btap.jsonl $RUN/btap-rules.json > $RUN/btap.log 2>&1 < /dev/null & echo $! > $RUN/btap.pid
bash $R/aux.sh $DB >> $L 2>&1
BROKER_VIA=18172 bash $R/harness.sh $DB $D >> $L 2>&1
ROLE=store bash $R/spring.sh head $DB >> $L 2>&1
STORE=b DIST=$D bash $R/spring.sh head $DB >> $L 2>&1
(cd $R/probe && DB=$DB $N td-race.mjs start ws-td-$TAG c >> $L 2>&1)
bash $R/stop.sh $DB spring >> $L 2>&1; sleep 1; STORE=b DIST=$D bash $R/spring.sh head $DB >> $L 2>&1
(cd $R/probe && DB=$DB GRANT_BEFORE_CANCEL=${GRANTED:-0} $N td-race.mjs race ws-td-$TAG c $TAG >> $L 2>&1)
bash $R/stop.sh $DB all >> $L 2>&1; bash $R/stop.sh $DB btap >> $L 2>&1
echo "TD-DONE $(date -u +%T)" >> $L
