#!/bin/bash
# usage: r9all.sh — round 4c on main (9763580b): every scenario on its own fresh stack, in three batches
cd /Users/wenshao/git/pr13769-rig
J=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
modelok() { local u c; u=$(python3 -c "import json; print(json.load(open('runs/$1/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models"); [ "$c" != 000 ] || { echo "MODEL UNREACHABLE for $1 at $u"; exit 9; }; echo "   $1 model $u -> $c"; }
up() { JAR=$J ./up.sh main $1 $2 > runs/r9-up-$1.log 2>&1; tail -1 runs/r9-up-$1.log; modelok $1; }
down() { for d in "$@"; do node stack.mjs stop $d > /dev/null 2>&1; done; }
pid_of() { sed -n 's/^   parent \([0-9a-f-]*\)$/\1/p' runs/r9-$1.log | head -1; }
echo "== batch A $(date -u +%T)"
up m9n1 38200; up m9n2 38210; up m9n3 38220; up m9n4 38230
bash probe8.sh m9n1 m9a n1 > runs/r9-m9n1.log 2>&1 &
bash probe8.sh m9n2 m9b n2 > runs/r9-m9n2.log 2>&1 &
bash probe8.sh m9n3 m9c n3 > runs/r9-m9n3.log 2>&1 &
( bash probe8.sh m9n4 m9f n4 > runs/r9-m9n4.log 2>&1; bash probe8b.sh m9n4 m9f "$(pid_of m9n4)" > runs/r9-m9n4b.log 2>&1 ) &
wait; down m9n1 m9n2 m9n3 m9n4
echo "== batch B $(date -u +%T)"
up m9r1 38240; up m9r2 38250; up m9r3 38260; up m9r5 38270
bash probe1b.sh m9r1 m9d > runs/r9-m9r1.log 2>&1 &
bash probe9.sh m9r2 m9e > runs/r9-m9r2.log 2>&1 &
bash probe5.sh m9r3 m9g > runs/r9-m9r3.log 2>&1 &
bash probe7b.sh m9r5 m9i > runs/r9-m9r5.log 2>&1 &
wait; down m9r1 m9r2 m9r3 m9r5
echo "== batch C $(date -u +%T)"
up m9t 38280; up m9r6 38290
bash probe10.sh m9t m9k > runs/r9-m9t.log 2>&1 &
bash probe6.sh m9r6 m9j > runs/r9-m9r6.log 2>&1 &
wait; down m9t m9r6
echo "== batch D $(date -u +%T)"
up m9x 38300; up m9y 38320; up m9z 38330; up m9q 38390
bash probe11.sh m9x m9x > runs/r9-m9x.log 2>&1 &
bash probe12.sh m9y m9y > runs/r9-m9y.log 2>&1 &
bash probe12c.sh m9z m9z > runs/r9-m9z.log 2>&1 &
bash probe13.sh m9q m9q > runs/r9-m9q.log 2>&1 &
wait; down m9x m9y m9z m9q
echo "== r9all DONE $(date -u +%T)"
