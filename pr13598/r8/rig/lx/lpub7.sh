#!/bin/bash
# usage: lpub7.sh <arm> <db> <basePort> — inside the container. Tool publication on (fake OSS), shell-profile
# Sessions: P1 = a user Turn that calls run_shell_command (control), P2 = a manual automation run whose wake
# turn calls run_shell_command (the 09:51 review's P1-1 path).
cd /rig; ARM=$1; DB=$2; B=$3; source mk4.sh; D=runs/$DB
PUB=1 ./linit7.sh $ARM $DB $B shell | tail -1
L=$D/actions.log
mks $DB P1 >/dev/null 2>&1; mks $DB P2 >/dev/null 2>&1; sleep 8
mysql -h127.0.0.1 -uroot -N -e "select substr(session_id,1,8), tool_profile from managed_agent_session" $DB | tee -a $L
echo "$(date -u +%T) P1 user Turn: SHELL:: (control)" >> $L
node lclient6.mjs $DB send $(cat $D/P1) "USER::p1-shell SHELL:: print the beacon" | grep -E '"turn_id"' | head -1 >> $L
sleep 25
node lclient6.mjs $DB acreate "$(mk $(cat $D/P2) 'manual shell run' "MANUAL::$DB SHELL:: print the beacon" skip '0 0 1 1 *')" key-P2 | tee $D/p2-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('$D/p2-create.json')).json.id)" > $D/p2.id
echo "$(date -u +%T) P2 manual run: the wake turn calls run_shell_command" >> $L
node lclient6.mjs $DB arun $(cat $D/p2.id) key-p2-run | short
echo "armed $(date -u +%T)"
