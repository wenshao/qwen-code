#!/bin/bash
# VERIFICATION RIG ONLY (PR #13163 R9): wait for the builds, then run the arms one after another (shared ports).
R=/root/v13163/rig; L=$R/out/r9/seq9.log; mkdir -p $R/out/r9; : > $L
until grep -q TS-DONE /root/v13163/out/r9/main.log; do sleep 10; done
echo "SEQ9-START $(date -u +%T) $(grep -E "build exit|bundle exit" /root/v13163/out/r9/main.log | tr "\n" " ")" >> $L
for A in ${ARMS:-h9 x9 b9 up9}; do bash $R/arm9.sh $A; echo "$A rc=$? $(date -u +%T)" >> $L; done
echo "SEQ9-DONE $(date -u +%T)" >> $L
