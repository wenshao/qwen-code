#!/bin/bash
# round 4c: S14 on main (9763580b) and head4 (01759f90) side by side, plus S13b2 on main
cd /Users/wenshao/git/pr13769-rig
JM=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
JH=/Users/wenshao/git/pr13769-head2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
modelok() { local u c; u=$(python3 -c "import json; print(json.load(open('runs/$1/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models"); [ "$c" != 000 ] || { echo "MODEL UNREACHABLE for $1 at $u"; exit 9; }; echo "   $1 model $u -> $c"; }
echo "== r8x $(date -u +%T)"
JAR=$JM ./up.sh main m8w 38350 > runs/r8-up-m8w.log 2>&1; tail -1 runs/r8-up-m8w.log; modelok m8w
JAR=$JH ./up.sh head4 h4w 38360 > runs/r8-up-h4w.log 2>&1; tail -1 runs/r8-up-h4w.log; modelok h4w
bash probe14.sh m8w m8w s13b > runs/r8-m8w.log 2>&1 &
bash probe14.sh h4w h4w > runs/r8-h4w.log 2>&1 &
wait; for d in m8w h4w; do node stack.mjs stop $d > /dev/null 2>&1; done
echo "== r8x DONE $(date -u +%T)"
