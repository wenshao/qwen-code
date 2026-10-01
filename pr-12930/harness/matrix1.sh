#!/bin/bash
# E0 natural (20x each, interleaved) + E1 delay sweep + E3 diagnostics
H=/root/verify/pr12930/harness/run-arm.sh
for i in $(seq -w 1 20); do $H base none e0-base-$i; $H head none e0-head-$i; done
for d in 5 10 20 50 100 250; do for i in 1 2 3 4 5; do $H base delay:$d e1-base-d$d-$i; done; done
for d in 250 1000 3000; do for i in 1 2 3 4 5; do $H head delay:$d e1-head-d$d-$i; done; done
for m in 404 cut eof; do for i in 1 2; do $H base $m e3-base-$m-$i; $H head $m e3-head-$m-$i; done; done
echo MATRIX1_DONE
