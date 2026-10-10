#!/bin/bash
# usage: rrep.sh <label> <arm:db:port:probe> ... — each entry on a fresh stack behind hproxy (logs >=400 bodies), all in parallel
cd /Users/wenshao/git/pr13769-rig
JM=/Users/wenshao/git/pr13769-main/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
JH=/Users/wenshao/git/pr13769-head2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
L=$1; shift
echo "== $L $(date -u +%T)"
for e in "$@"; do IFS=: read -r arm db port probe <<< "$e"
  J=$JM; [ "$arm" = head4 ] && J=$JH; [ "$arm" = base2 ] && J=/Users/wenshao/git/pr13769-base2/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
  hp=$((port+1)); pp=$((port+9))
  nohup node hproxy.mjs $pp $hp runs/$db-hproxy.jsonl > runs/$db-hproxy.out 2>&1 &
  HPIDS="$HPIDS $!"
  RIG_HARNESS_URL=http://127.0.0.1:$pp JAR=$J ./up.sh $arm $db $port > runs/rr-up-$db.log 2>&1
  u=$(python3 -c "import json; print(json.load(open('runs/$db/state.json'))['modelUrl'])"); c=$(curl -s -m5 --noproxy '*' -o /dev/null -w '%{http_code}' "$u/models")
  [ "$c" != 000 ] || { echo "MODEL UNREACHABLE $db"; exit 9; }; echo "   $db ($arm) up, model -> $c"
done
PIDS=""; for e in "$@"; do IFS=: read -r arm db port probe <<< "$e"; bash $probe $db $db > runs/rr-$db.log 2>&1 & PIDS="$PIDS $!"; done
wait $PIDS   # only the probes: the hproxies never exit
for e in "$@"; do IFS=: read -r arm db port probe <<< "$e"; node stack.mjs stop $db > /dev/null 2>&1; done
kill $HPIDS 2>/dev/null
echo "== $L DONE $(date -u +%T)"
