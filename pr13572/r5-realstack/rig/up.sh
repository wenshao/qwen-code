#!/bin/bash
# usage: up.sh <arm> <db> <springPort>   — Spring (Flyway) + rig DB setup + Harness
ARM="$1"; DB="$2"; P="$3"; [[ "$P" =~ ^[0-9]+$ && "$DB" =~ ^[a-z0-9]+$ ]] || { echo "bad args"; exit 2; }; cd /Users/wenshao/git/pr13572-rig
node stack.mjs init $ARM $DB $P $((P+1)) $((P+2)) || exit 1
for i in $(seq 120); do curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:$P/actuator/health | grep -q 200 && { echo "$DB spring up ${i}s"; break; }; sleep 1; done
./setup-db.sh $DB | tail -1 && node stack.mjs harness $DB && sleep 4 && tail -1 runs/$DB/harness.log | cut -c1-160
