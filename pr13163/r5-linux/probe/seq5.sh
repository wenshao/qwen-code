#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): everything after the head matrix, strictly one rig at a time.
R=/root/v13163/rig; S=$R/out/seq5.log; : > $S
say() { echo "$(date -u +%T) $*" >> $S; }
say "wait head batch"; until grep -q BATCH-DONE $R/out/h5/batch5.log; do sleep 10; done
bash $R/stop.sh h5 all >> $S 2>&1
say "base subset"; bash $R/batch5b.sh b5 base base; bash $R/stop.sh b5 all >> $S 2>&1
say "cold head"; bash $R/cold5.sh h5c head head; bash $R/stop.sh h5c all >> $S 2>&1
say "cold base"; bash $R/cold5.sh b5c base base; bash $R/stop.sh b5c all >> $S 2>&1
say "td head"; bash $R/td.sh tdh head head; bash $R/stop.sh tdh all >> $S 2>&1
say "td h1"; bash $R/td.sh tdm h1 h1; bash $R/stop.sh tdm all >> $S 2>&1
say "ui head"; bash $R/aux.sh u5 >> $S 2>&1; bash $R/harness.sh u5 head >> $S 2>&1; DIST=head bash $R/spring.sh head u5 >> $S 2>&1
bash $R/vite.sh head >> $S 2>&1; bash $R/ui5.sh u5 head; bash $R/stop.sh u5 all >> $S 2>&1
say "ui base"; bash $R/aux.sh u5b >> $S 2>&1; bash $R/harness.sh u5b base >> $S 2>&1; DIST=base bash $R/spring.sh base u5b >> $S 2>&1
bash $R/vite.sh base >> $S 2>&1; bash $R/ui5.sh u5b base; bash $R/stop.sh u5b all >> $S 2>&1
say "SEQ-DONE"
