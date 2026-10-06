#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R6): run the round-6 batches one after another (they share the rig ports).
R=/root/v13163/rig; L=$R/out/seq6.log; : > $L
echo "SEQ6-START $(date -u +%T)" >> $L
bash $R/batch6h3.sh; echo "batch6h3 rc=$? $(date -u +%T)" >> $L
bash $R/batch6b.sh; echo "batch6b rc=$? $(date -u +%T)" >> $L
bash $R/tdo.sh to3 head3 head3; echo "tdo head3 rc=$? $(date -u +%T)" >> $L
bash $R/tdo.sh to3b head3 head3b; echo "tdo head3b rc=$? $(date -u +%T)" >> $L
echo "SEQ6-DONE $(date -u +%T)" >> $L
