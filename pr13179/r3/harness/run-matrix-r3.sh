#!/bin/bash
# VERIFICATION RIG ONLY (PR #13179 round 3): PR-worker columns of the containment matrix on the round-2 trial merge.
set -u
RIG=/Users/wenshao/pr13179-rig; . $RIG/rig.env; cd $RIG/probe
NORMAL=w1-write-dotdot,w1-read-dotdot,w1-absolute,w1-inside-child,w2-symlink,w2-symlink-read,w3-stale-cache,w3-stale-cache-read
BYPASS=w1-write-dotdot,w1-read-dotdot,w1-edit-dotdot,w1-absolute,w1-inside-parent,w1-inside-child
run() { DB=ui WS=$2 ST=$3 $NODE w-contain.mjs $1 $4 > $RIG/out/matrix-$1.console 2>&1; echo "== $1: $(grep -c '^ROW' $RIG/out/matrix-$1.console) rows"; }
spring() { $RIG/stop.sh ui spring >/dev/null; DIST=$1 $RIG/spring.sh merge ui absent absent | tail -1; }
harness() { $RIG/stop.sh ui harness >/dev/null; $RIG/harness.sh ui $1 | tail -1; }
run r3-pr-normal ws-b b $NORMAL
harness harness-nonorm; spring merge; run r3-pr-bypass ws-c c $BYPASS
harness merge; spring merge
echo MATRIX-DONE
