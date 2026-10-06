#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): teardown race with can_create restored before the cancel, head vs H1.
R=/root/v13163/rig; S=$R/out/seq5e.log; : > $S
say() { echo "$(date -u +%T) $*" >> $S; }
say "wait seq5d"; until grep -q SEQD-DONE $R/out/seq5d.log; do sleep 10; done
say "td2 head"; GRANTED=1 bash $R/td.sh tg6h head head; bash $R/stop.sh tg6h all >> $S 2>&1
say "td2 h1"; GRANTED=1 bash $R/td.sh tg6m h1 h1; bash $R/stop.sh tg6m all >> $S 2>&1
say "SEQE-DONE"
