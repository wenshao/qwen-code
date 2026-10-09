#!/bin/bash
# usage: lbg7.sh <arm> <db> <basePort> — inside the container. Tool publication on (fake OSS), shell-profile
# Sessions: B1 = a user Turn that starts a BACKGROUND run_shell_command (control), B2 = a manual run whose wake
# turn starts one: the /grants reserve the review's P1-1 says the Java store refuses.
cd /rig; ARM=$1; DB=$2; B=$3; source mk4.sh; D=runs/$DB
PUB=1 ./linit7.sh $ARM $DB $B shell | tail -1
L=$D/actions.log
mks $DB B1 >/dev/null 2>&1; mks $DB B2 >/dev/null 2>&1; sleep 8
mysql -h127.0.0.1 -uroot -N -e "select substr(session_id,1,8), tool_profile from managed_agent_session" $DB | tee -a $L
echo "$(date -u +%T) B1 user Turn: SHELLBG:: (control)" >> $L
node lclient6.mjs $DB send $(cat $D/B1) "USER::b1-bg SHELLBG:: print the beacon" | grep -E '"turn_id"' | head -1 >> $L
sleep 25
node lclient6.mjs $DB acreate "$(mk $(cat $D/B2) 'manual bg shell run' "MANUAL::$DB SHELLBG:: print the beacon" skip '0 0 1 1 *')" key-B2 | tee $D/b2-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('$D/b2-create.json')).json.id)" > $D/b2.id
echo "$(date -u +%T) B2 manual run: the wake turn starts a background run_shell_command" >> $L
node lclient6.mjs $DB arun $(cat $D/b2.id) key-b2-run | short
echo "armed $(date -u +%T)"
