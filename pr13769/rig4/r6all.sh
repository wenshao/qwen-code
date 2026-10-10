#!/bin/bash
# usage: r6all.sh — round 4 on main (df72e2d1): every scenario on its own fresh stack, in three batches
cd /Users/wenshao/git/pr13769-rig
J=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
modelok() { local u c; u=$(python3 -c "import json; print(json.load(open('runs/$1/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models"); [ "$c" != 000 ] || { echo "MODEL UNREACHABLE for $1 at $u"; exit 9; }; echo "   $1 model $u -> $c"; }
up() { JAR=$J ./up.sh main $1 $2 > runs/r6-up-$1.log 2>&1; tail -1 runs/r6-up-$1.log; modelok $1; }
down() { for d in "$@"; do node stack.mjs stop $d > /dev/null 2>&1; done; }
pid_of() { sed -n 's/^   parent \([0-9a-f-]*\)$/\1/p' runs/r6-$1.log | head -1; }
echo "== batch A $(date -u +%T)"
up m6n1 38200; up m6n2 38210; up m6n3 38220; up m6n4 38230
bash probe8.sh m6n1 m6a n1 > runs/r6-m6n1.log 2>&1 &
bash probe8.sh m6n2 m6b n2 > runs/r6-m6n2.log 2>&1 &
bash probe8.sh m6n3 m6c n3 > runs/r6-m6n3.log 2>&1 &
( bash probe8.sh m6n4 m6f n4 > runs/r6-m6n4.log 2>&1; bash probe8b.sh m6n4 m6f "$(pid_of m6n4)" > runs/r6-m6n4b.log 2>&1 ) &
wait; down m6n1 m6n2 m6n3 m6n4
echo "== batch B $(date -u +%T)"
up m6r1 38240; up m6r2 38250; up m6r3 38260; up m6r5 38270
bash probe1b.sh m6r1 m6d > runs/r6-m6r1.log 2>&1 &
bash probe9.sh m6r2 m6e > runs/r6-m6r2.log 2>&1 &
bash probe5.sh m6r3 m6g > runs/r6-m6r3.log 2>&1 &
bash probe7b.sh m6r5 m6i > runs/r6-m6r5.log 2>&1 &
wait; down m6r1 m6r2 m6r3 m6r5
echo "== batch C $(date -u +%T)"
up m6t 38280; up m6r6 38290
bash probe10.sh m6t m6k > runs/r6-m6t.log 2>&1 &
bash probe6.sh m6r6 m6j > runs/r6-m6r6.log 2>&1 &
wait; down m6t m6r6
echo "== batch D $(date -u +%T)"
up m6x 38300; up m6y 38320; JAR=/Users/wenshao/git/pr13769-head2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar ./up.sh head4 h4y 38310 > runs/r6-up-h4y.log 2>&1; tail -1 runs/r6-up-h4y.log; modelok h4y
bash probe11.sh m6x m6x > runs/r6-m6x.log 2>&1 &
bash probe11.sh h4y h4y > runs/r6-h4y.log 2>&1 &
bash probe12.sh m6y m6y > runs/r6-m6y.log 2>&1 &
wait; down m6x h4y m6y
echo "== r6all DONE $(date -u +%T)"
