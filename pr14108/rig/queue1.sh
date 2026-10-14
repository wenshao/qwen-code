#!/bin/bash
# Phase 1: full Hosted*IT fork, one arm at a time on lane a (cpus 0-3), nothing else running.
R=/root/pr14108-rig
for a in head base cand; do $R/run-it.sh a $a full ALL; done >> $R/out/queue1.log 2>&1
echo QUEUE1-DONE >> $R/out/queue1.log
