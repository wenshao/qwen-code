#!/bin/bash
# Sequential matrix: new round-4 cells (probe4) and x86_64 replication of the
# round-1/3 core cells (probe1), base and head interleaved per cell.
cd /root/verify/pr11071-r4
LOG=logs/run-all.log; mkdir -p logs data/base data/head
P4="gh-loss home home-redirect userscope-guard untrusted drain-0 drain-2 drain-5 drain-10 drain-20 drain-40 drainpre-0 drainpre-1 drainpre-3"
P1="loss stale normal busy busy-loss poison inflight all-reload samename"
echo "START $(date -Is)" > $LOG
for s in $P4; do for arm in base head; do
  timeout 300 node harness/probe4.mjs arms/$arm $s data/$arm/$s.json >> $LOG 2>&1; echo "rc=$? $arm $s" >> $LOG
done; done
for s in $P1; do for arm in base head; do
  timeout 300 node harness/probe1.mjs arms/$arm $s data/$arm/p1-$s.json >> $LOG 2>&1; echo "rc=$? $arm p1-$s" >> $LOG
done; done
# gh-loss repeats for stability
for i in 2 3; do for arm in base head; do
  timeout 300 node harness/probe4.mjs arms/$arm gh-loss data/$arm/gh-loss-r$i.json >> $LOG 2>&1; echo "rc=$? $arm gh-loss-r$i" >> $LOG
done; done
echo "EXIT=done $(date -Is)" >> $LOG
