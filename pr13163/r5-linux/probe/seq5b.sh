#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): the R6-2 rename race on both arms, after seq5.
R=/root/v13163/rig; S=$R/out/seq5b.log; : > $S; N=/usr/bin/node
say() { echo "$(date -u +%T) $*" >> $S; }
say "wait seq5"; until grep -q SEQ-DONE $R/out/seq5.log; do sleep 10; done
for arm in head base; do
  DB=r62${arm:0:1}
  say "r62 $arm"; bash $R/aux.sh $DB >> $S 2>&1; bash $R/harness.sh $DB $arm >> $S 2>&1; DIST=$arm bash $R/spring.sh $arm $DB >> $S 2>&1
  for k in bound unbound; do (cd $R/probe && DB=$DB $N r62-rename-race.mjs $k ws-r62 b >> $R/out/r62-$arm.log 2>&1); done
  bash $R/stop.sh $DB all >> $S 2>&1
done
say "SEQB-DONE"
