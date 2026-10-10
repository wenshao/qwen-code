#!/bin/bash
# usage: r7all.sh — round 4b on main (1e1c4a4a): every scenario on its own fresh stack, in three batches
cd /Users/wenshao/git/pr13769-rig
J=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
modelok() { local u c; u=$(python3 -c "import json; print(json.load(open('runs/$1/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models"); [ "$c" != 000 ] || { echo "MODEL UNREACHABLE for $1 at $u"; exit 9; }; echo "   $1 model $u -> $c"; }
up() { JAR=$J ./up.sh main $1 $2 > runs/r7-up-$1.log 2>&1; tail -1 runs/r7-up-$1.log; modelok $1; }
down() { for d in "$@"; do node stack.mjs stop $d > /dev/null 2>&1; done; }
pid_of() { sed -n 's/^   parent \([0-9a-f-]*\)$/\1/p' runs/r7-$1.log | head -1; }
echo "== batch A $(date -u +%T)"
up m7n1 38200; up m7n2 38210; up m7n3 38220; up m7n4 38230
bash probe8.sh m7n1 m7a n1 > runs/r7-m7n1.log 2>&1 &
bash probe8.sh m7n2 m7b n2 > runs/r7-m7n2.log 2>&1 &
bash probe8.sh m7n3 m7c n3 > runs/r7-m7n3.log 2>&1 &
( bash probe8.sh m7n4 m7f n4 > runs/r7-m7n4.log 2>&1; bash probe8b.sh m7n4 m7f "$(pid_of m7n4)" > runs/r7-m7n4b.log 2>&1 ) &
wait; down m7n1 m7n2 m7n3 m7n4
echo "== batch B $(date -u +%T)"
up m7r1 38240; up m7r2 38250; up m7r3 38260; up m7r5 38270
bash probe1b.sh m7r1 m7d > runs/r7-m7r1.log 2>&1 &
bash probe9.sh m7r2 m7e > runs/r7-m7r2.log 2>&1 &
bash probe5.sh m7r3 m7g > runs/r7-m7r3.log 2>&1 &
bash probe7b.sh m7r5 m7i > runs/r7-m7r5.log 2>&1 &
wait; down m7r1 m7r2 m7r3 m7r5
echo "== batch C $(date -u +%T)"
up m7t 38280; up m7r6 38290
bash probe10.sh m7t m7k > runs/r7-m7t.log 2>&1 &
bash probe6.sh m7r6 m7j > runs/r7-m7r6.log 2>&1 &
wait; down m7t m7r6
echo "== batch D $(date -u +%T)"
up m7x 38300; up m7y 38320; up m7z 38330
bash probe11.sh m7x m7x > runs/r7-m7x.log 2>&1 &
bash probe12.sh m7y m7y > runs/r7-m7y.log 2>&1 &
bash probe12c.sh m7z m7z > runs/r7-m7z.log 2>&1 &
wait; down m7x m7y m7z
echo "== r7all DONE $(date -u +%T)"
