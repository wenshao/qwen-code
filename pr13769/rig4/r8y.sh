#!/bin/bash
# round 4c classification: S15 (Runtime park + pending wake input) on base2 (pre-#13769) and main (9763580b)
cd /Users/wenshao/git/pr13769-rig
JM=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
JB=/Users/wenshao/git/pr13769-base2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
modelok() { local u c; u=$(python3 -c "import json; print(json.load(open('runs/$1/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models"); [ "$c" != 000 ] || { echo "MODEL UNREACHABLE for $1 at $u"; exit 9; }; echo "   $1 model $u -> $c"; }
echo "== r8y $(date -u +%T)"
JAR=$JM ./up.sh main m8v 38370 > runs/r8-up-m8v.log 2>&1; tail -1 runs/r8-up-m8v.log; modelok m8v
JAR=$JB ./up.sh base2 b2v 38380 > runs/r8-up-b2v.log 2>&1; tail -1 runs/r8-up-b2v.log; modelok b2v
bash probe15.sh m8v m8v > runs/r8-m8v.log 2>&1 &
bash probe15.sh b2v b2v > runs/r8-b2v.log 2>&1 &
wait; for d in m8v b2v; do node stack.mjs stop $d > /dev/null 2>&1; done
echo "== r8y DONE $(date -u +%T)"
