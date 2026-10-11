#!/bin/bash
# PR13330 R4 — mutation sweep: baseline, the delta subset (files changed 99f74389..51a87ac9),
# the F1 revert (a09), then a full-suite run for any survivor.
R=/root/pr13330-r4
set -x
$R/mut.sh m00
for id in a09 a05 a01 a02 a03 a04 a06 a07 a08 k01 f01 f02 h01 h02 h03; do
  $R/mut.sh $id
done
python3 $R/probe/collect_mut_r4.py
echo MUTANTS_DONE
