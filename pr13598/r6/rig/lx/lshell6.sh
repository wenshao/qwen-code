#!/bin/bash
# usage: lshell6.sh <arm> <db> <basePort> — inside the container: shell-profile Sessions with Tool v3
# publication on; P1 sends a user Turn that calls run_shell_command, P2 a manual automation run that does.
cd /rig; ARM=$1; DB=$2; B=$3; source mk4.sh; D=runs/$DB
./linit6.sh $ARM $DB $B shell | tail -1
node lstack6.mjs env $DB QWEN_MANAGED_AGENT_TOOL_PUBLICATION_ENABLED=true >/dev/null
node lstack6.mjs spring $DB >/dev/null
for i in $(seq 120); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$B/actuator/health 2>/dev/null | grep -q 200 && break; sleep 1; done
echo "$(date -u +%T) Spring restarted with tool publication on" >> $D/actions.log
mks $DB P1 >/dev/null 2>&1; mks $DB P2 >/dev/null 2>&1; sleep 8
mysql -h127.0.0.1 -uroot -N -e "select substr(session_id,1,8), tool_profile from managed_agent_session" $DB
node lclient6.mjs $DB send $(cat $D/P1) "USER::p1-shell SHELL:: print the beacon" | grep -E '"turn_id"' | head -1 >> $D/actions.log
echo "$(date -u +%T) P1 user Turn with run_shell_command sent" >> $D/actions.log
node lclient6.mjs $DB acreate "$(mk $(cat $D/P2) 'manual shell run' "MANUAL::$DB SHELL:: print the beacon" skip '0 0 1 1 *')" key-P2 | tee $D/p2-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('$D/p2-create.json')).json.id)" > $D/p2.id
sleep 15
node lclient6.mjs $DB arun $(cat $D/p2.id) key-p2-run | short
echo "$(date -u +%T) P2 manual run (wake turn calls run_shell_command)" >> $D/actions.log
