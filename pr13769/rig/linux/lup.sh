#!/bin/bash
# usage (in container): lup.sh <arm> <db> <springPort> — Spring (Flyway) + rig DB setup + Harness
ARM="$1"; DB="$2"; P="$3"; cd /rig
node lstack.mjs init $ARM $DB $P $((P+1)) $((P+2)) || exit 1
for i in $(seq 180); do curl -s -o /dev/null -w '%{http_code}' --noproxy '*' http://127.0.0.1:$P/actuator/health | grep -q 200 && { echo "$DB spring up ${i}s"; break; }; sleep 1; done
bash lsetup-db.sh $DB | tail -1 && node lstack.mjs harness $DB && sleep 6 && tail -1 /work/$DB/harness.log | cut -c1-160
