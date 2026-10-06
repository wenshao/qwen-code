#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): overlapping passive loads vs teardown, for one Harness bundle.  usage: tdo.sh <db> <dist> <tag>
R=/root/v13163/rig; DB=$1; D=$2; TAG=$3; N=/usr/bin/node; . $R/rig.env
RUN=$R/run/$DB; mkdir -p $RUN $R/out/$DB; L=$R/out/$DB/tdo-$TAG.log; : > $L
echo '[]' > $RUN/btap-rules.json
setsid nohup $N $R/probe/tap.mjs 18172 $BROKER_PORT $RUN/btap.jsonl $RUN/btap-rules.json > $RUN/btap.log 2>&1 < /dev/null & echo $! > $RUN/btap.pid
bash $R/aux.sh $DB >> $L 2>&1
BROKER_VIA=18172 bash $R/harness.sh $DB $D >> $L 2>&1
ROLE=store bash $R/spring.sh $D $DB >> $L 2>&1
STORE=b DIST=$D bash $R/spring.sh $D $DB >> $L 2>&1
(cd $R/probe && DB=$DB $N td-race.mjs start ws-to-$TAG c >> $L 2>&1)
bash $R/stop.sh $DB spring >> $L 2>&1; sleep 1; STORE=b DIST=$D bash $R/spring.sh $D $DB >> $L 2>&1
(cd $R/probe && DB=$DB $N td-overlap.mjs ws-to-$TAG c $TAG >> $L 2>&1)
bash $R/stop.sh $DB all >> $L 2>&1
echo "TDO-DONE $(date -u +%T)" >> $L
