#!/bin/bash
# Phase 3 (after the lane-a DB OOM): candidate full fork, then class-level mutants and a head repeat, all on lane a.
R=/root/pr14108-rig
$R/run-it3.sh a cand full ALL >> $R/out/queue3.log 2>&1
for x in "mkeep r1" "mkeepc r1" "msealed r1" "m14039 r1" "head r2"; do set -- $x; MEM=6g $R/run-it3.sh a $1 $2; done >> $R/out/queue3.log 2>&1
echo QUEUE3-DONE >> $R/out/queue3.log
