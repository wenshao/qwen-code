#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R5): rerun the cold-cache batch on the fixed store-replica topology, both arms.
R=/root/v13163/rig; S=$R/out/seq5c.log; : > $S
say() { echo "$(date -u +%T) $*" >> $S; }
say "wait seq5b"; until grep -q SEQB-DONE $R/out/seq5b.log; do sleep 10; done
say "cold head"; bash $R/cold5.sh h5d head head; bash $R/stop.sh h5d all >> $S 2>&1
say "cold base"; bash $R/cold5.sh b5d base base; bash $R/stop.sh b5d all >> $S 2>&1
say "SEQC-DONE"
