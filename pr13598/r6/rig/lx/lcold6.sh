#!/bin/bash
# usage: lcold6.sh <db> <basePort>  — inside the container: Sessions X2 (crashed wake read_file, allow, every
# minute) and X3 (another Session on the Workspace), tap delay on the first execution poll, cold crash.
cd /rig; DB=$1; B=$2; source mk4.sh; D=runs/$DB; P=$(echo $DB | tr 'a-z' 'A-Z' | cut -c1)
mks $DB ${P}2 >/dev/null 2>&1; mks $DB ${P}3 >/dev/null 2>&1; sleep 6
node lclient6.mjs $DB acreate "$(mk $(cat $D/${P}2) 'cold broker crash' "AUTO::${DB}c TOOL:: read the status file" allow '* * * * *')" key-${P}2 | tee $D/c2-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('$D/c2-create.json')).json.id)" > $D/c2.id
curl -s -XPOST localhost:$((B+6))/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'; echo
setsid nohup ./lcrash6.sh $DB "${P}2 mid read_file, cold Broker" cold >/dev/null 2>&1 < /dev/null &
echo "armed $(date -u +%T)"
