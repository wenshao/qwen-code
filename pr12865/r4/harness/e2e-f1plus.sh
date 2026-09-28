#!/bin/bash
# usage: e2e-f1plus.sh <label> <jar> <db> <dist-tree>
L=$1; JAR=$2; DB=$3; TREE=$4
cd /Users/wenshao/pr12865-rig
MID=$(cat machine-id.txt)
docker exec pr12865-db mysql -uroot -prootpw -e "CREATE DATABASE $DB" 2>/dev/null
docker rm -f pr12865-srv >/dev/null 2>&1
docker run -d --init --name pr12865-srv --network pr12865net --memory=700m -v /Users/wenshao/pr12865-rig:/rig pr12865-linux sleep infinity >/dev/null
docker exec pr12865-srv sh -c "printf '%s\n' $MID > /etc/machine-id; mkdir -p /opt/qwen && cp -a /rig/$TREE/dist /opt/qwen/dist"
wait_up() { sleep 1; for i in $(seq 1 60); do sleep 3; grep -q "Started ManagedAgentServerApplication\|APPLICATION FAILED" out/srv-$1.log 2>/dev/null && return; done; }
rm -f out/srv-1.log out/srv-2.log
echo "[$L] jar=$JAR db=$DB"
docker exec -e JAR=$JAR -e NODE_BIN=/nonexistent/node pr12865-srv /rig/srv.sh 1 true $DB > /dev/null; wait_up 1
A=$(docker exec pr12865-srv /rig/e2e.sh session $L-a | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "[$L] server 1 (node path wrong) warm session A: $(docker exec pr12865-srv /rig/e2e.sh warm $A)"
docker exec pr12865-srv sh -c 'kill -9 $(pgrep -f /rig/server/)'; sleep 3; echo "[$L] server 1 killed; java left: $(docker exec pr12865-srv sh -c 'pgrep -f /rig/server/ | wc -l')"
docker exec -e JAR=$JAR pr12865-srv /rig/srv.sh 2 true $DB > /dev/null; wait_up 2; echo "[$L] server 2: $(grep -h -o -E "Started ManagedAgentServerApplication|APPLICATION FAILED|BindException" out/srv-2.log | head -1)"
echo "[$L] server 2 (fixed) warm session A: $(docker exec pr12865-srv /rig/e2e.sh warm $A)"
B=$(docker exec pr12865-srv /rig/e2e.sh session $L-b | sed 's/.*"id":"\([^"]*\)".*/\1/')
echo "[$L] server 2 (fixed) warm session B (same tenant): $(docker exec pr12865-srv /rig/e2e.sh warm $B)"
./bq.sh $DB | sed "s/^/[$L]   /"
docker exec pr12865-srv sh -c 'for f in /var/lib/qwen-rt/*/*.json; do grep -o "\"state\":\"[A-Z]*\",\"pid\":[0-9]*" $f; done' | sed "s/^/[$L]   record /"
docker exec pr12865-srv /rig/e2e.sh workers | sed "s/^/[$L]   /"
