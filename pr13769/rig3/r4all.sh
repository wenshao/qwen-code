#!/bin/bash
# usage: r4all.sh — round 3 on head4 (01759f90): every scenario on its own fresh stack, in three batches
cd /Users/wenshao/git/pr13769-rig
J=/Users/wenshao/git/pr13769-head2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
up() { JAR=$J ./up.sh head4 $1 $2 > runs/r4-up-$1.log 2>&1; tail -1 runs/r4-up-$1.log; }
down() { for d in "$@"; do node stack.mjs stop $d > /dev/null 2>&1; done; }
pid_of() { sed -n 's/^   parent \([0-9a-f-]*\)$/\1/p' runs/r4-$1.log | head -1; }
echo "== batch A $(date -u +%T)"
up h4n1 38100; up h4n2 38110; up h4n3 38120; up h4n4 38130
bash probe8.sh h4n1 h4a n1 > runs/r4-h4n1.log 2>&1 &
bash probe8.sh h4n2 h4b n2 > runs/r4-h4n2.log 2>&1 &
bash probe8.sh h4n3 h4c n3 > runs/r4-h4n3.log 2>&1 &
( bash probe8.sh h4n4 h4f n4 > runs/r4-h4n4.log 2>&1; bash probe8b.sh h4n4 h4f "$(pid_of h4n4)" > runs/r4-h4n4b.log 2>&1 ) &
wait; down h4n1 h4n2 h4n3 h4n4
echo "== batch B $(date -u +%T)"
up h4r1 38140; up h4r2 38150; up h4r3 38160; up h4r5 38170
bash probe1b.sh h4r1 h4d > runs/r4-h4r1.log 2>&1 &
bash probe9.sh h4r2 h4e > runs/r4-h4r2.log 2>&1 &
bash probe5.sh h4r3 h4g > runs/r4-h4r3.log 2>&1 &
bash probe7b.sh h4r5 h4i > runs/r4-h4r5.log 2>&1 &
wait; down h4r1 h4r2 h4r3 h4r5
echo "== batch C $(date -u +%T)"
up h4t 38180; up h4r6 38190
bash probe10.sh h4t h4k > runs/r4-h4t.log 2>&1 &
bash probe6.sh h4r6 h4j > runs/r4-h4r6.log 2>&1 &
wait; down h4t h4r6
echo "== r4all DONE $(date -u +%T)"
