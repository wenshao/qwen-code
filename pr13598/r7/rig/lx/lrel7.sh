#!/bin/bash
# usage: lrel7.sh <arm> <db> <basePort> — inside the container. R1 runs read_file every minute (allow); the Harness
# alone is SIGKILLed mid tool call; right after its restart this stack's runtime workers (children of its Spring)
# are SIGSTOPped, so the aftermath's release times out at the Broker->worker transport (30 s) and the Runtime
# Session stays RELEASING; after HOLD seconds the workers get SIGCONT. R2 probes the Workspace afterwards.
cd /rig; ARM=$1; DB=$2; B=$3; HOLD=${4:-150}; source mk4.sh; D=runs/$DB; L=$D/actions.log
./linit7.sh $ARM $DB $B files | tail -1
mks $DB R1 >/dev/null 2>&1; mks $DB R2 >/dev/null 2>&1; sleep 6
node lclient6.mjs $DB acreate "$(mk $(cat $D/R1) 'release fault' "AUTO::${DB}r TOOL:: read the status file" allow '* * * * *')" key-R1 | tee $D/r1-create.json | short
curl -s -XPOST localhost:$((B+6))/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}' >/dev/null
./lcrash7.sh $DB "R1 mid read_file, Harness only" harness
SPID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("runs/'$DB'/state.json")).pids.spring)')
W=$(pgrep -P $SPID -f managed-runtime-worker | tr '\n' ' ')
kill -STOP $W
echo "$(date -u +%T) SIGSTOP this stack's runtime workers: $W (children of Spring $SPID)" >> $L
sleep $HOLD
kill -CONT $W
echo "$(date -u +%T) SIGCONT runtime workers: $W" >> $L
sleep 75
echo "$(date -u +%T) R2 read_file Turn (probe the Workspace)" >> $L
node lclient6.mjs $DB send $(cat $D/R2) "USER::r2-tool TOOL:: read the status file" | grep -E '"turn_id"' | head -1 >> $L
echo "$(date -u +%T) lrel7 done" >> $L
