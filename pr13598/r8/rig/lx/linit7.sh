#!/bin/bash
# usage: linit6.sh <arm r5|r6> <db> <basePort> [files|shell]  — inside the container
set -u
cd /rig; ARM=$1; DB=$2; B=$3; MODE=${4:-files}
node lstack7.mjs init $ARM $DB $B $((B+1)) $((B+2)) $((B+3)) $((B+4)) || exit 1
node lstack7.mjs btap $DB $((B+5)) || exit 1
for i in $(seq 180); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$B/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
./lsetup-db7.sh $DB $MODE | tail -1
node lstack7.mjs harness $DB
for i in $(seq 60); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$((B+1))/health 2>/dev/null | grep -q 401 && break; sleep 1; done
mkdir -p runs/$DB/workspace-mount/notes && printf 'BEACON-%s-%s\nsecond line\n' $DB $RANDOM > runs/$DB/workspace-mount/notes/status.txt
echo "INIT-DONE $DB $(date -u +%T)"
