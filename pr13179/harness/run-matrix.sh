#!/bin/bash
# VERIFICATION RIG ONLY (PR #13179): the worker-containment matrix, harness {normal, bypassed} x worker {main, PR}.
set -u
RIG=/Users/wenshao/pr13179-rig; . $RIG/rig.env; cd $RIG/probe
NORMAL=w1-write-dotdot,w1-read-dotdot,w1-absolute,w1-inside-child,w2-symlink,w2-symlink-read,w3-stale-cache,w3-stale-cache-read
BYPASS=w1-write-dotdot,w1-read-dotdot,w1-edit-dotdot,w1-absolute,w1-inside-parent,w1-inside-child
run() { # label ws st vectors
  DB=ui WS=$2 ST=$3 $NODE w-contain.mjs $1 $4 > $RIG/out/matrix-$1.console 2>&1; echo "== $1: $(grep -c '^ROW' $RIG/out/matrix-$1.console) rows"; }
spring() { $RIG/stop.sh ui spring >/dev/null; DIST=$1 $RIG/spring.sh merge ui absent absent | tail -1; echo "   workers from dist/$1: next sessions"; }
harness() { $RIG/stop.sh ui harness >/dev/null; $RIG/harness.sh ui $1 | tail -1; }
harness merge;          spring merge; run final-pr-normal   ws-b b $NORMAL
                        spring base;  run final-main-normal ws-c c $NORMAL
harness harness-nonorm; spring base;  run final-main-bypass ws-d d $BYPASS
                        spring merge; run final-pr-bypass   ws-b b $BYPASS
harness merge;          spring merge
for l in final-pr-normal final-main-normal final-main-bypass final-pr-bypass; do
  echo "--- $l workers: $(ps -axo ppid,command | awk -v sp=$(cat $RIG/run/ui/spring.pid) '$1==sp' | grep -c managed-runtime-worker)"; done
echo MATRIX-DONE
