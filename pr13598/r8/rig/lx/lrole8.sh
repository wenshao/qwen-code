#!/bin/bash
# usage: lrole8.sh <arm> <db> <basePort> — inside the container. Actor roles (#13545, merged into the PR at
# e0ec7224e4) x automations on the real stack: the role matrix on the automation routes, a second OPERATOR's
# Turn, then the creator demoted to READER across scheduled slots and restored.
cd /rig; ARM=$1; DB=$2; B=$3; DEMOTE=${4:-200}; RESTORE=${5:-300}; source mk4.sh; D=runs/$DB; L=$D/actions.log
./linit7.sh $ARM $DB $B files | tail -1
mysql -h127.0.0.1 -uroot $DB -e "INSERT IGNORE INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('rig','rig-ws','rig-op2','OPERATOR'),('rig','rig-ws','rig-wsowner','OWNER')"
mysql -h127.0.0.1 -uroot -N -e "select actor_id, role from managed_workspace_access order by actor_id" $DB | sed 's/^/  access /' >> $L
mks $DB S >/dev/null 2>&1; sleep 4; SID=$(cat $D/S)
echo "$(date -u +%T) creator rig-actor (OPERATOR) made Session $SID" >> $L
r(){ printf '%s %-12s %-8s %s\n' "$(date -u +%T)" "$1" "$2" "$(cat | short)" >> $L; }
TURN(){ node -e 'console.log(JSON.stringify({type:"agent.session.input.message",input:[{type:"input_text",text:process.argv[1]}]}))' "$1"; }
node lclient6.mjs $DB acreate "$(mk $SID 'role probe' "AUTO::${DB} Reply with exactly: TICK" skip '* * * * *')" key-A | tee $D/a-create.json | r rig-actor acreate
AID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$D/a-create.json')).json.id)"); echo $AID > $D/a.id
sleep 70
echo "$(date -u +%T) -- role matrix on the automation routes (non-creators)" >> $L
for X in rig-op2 rig-wsowner rig-reader rig-none; do
  node lclient6.mjs $DB aget $AID $X | r $X aget
  node lclient6.mjs $DB aruns $AID $X | r $X aruns
  node lclient6.mjs $DB alist $X | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(JSON.stringify({status:j.status,json:{state:"n="+(j.json.data??[]).length}}))' | r $X alist
  node lclient6.mjs $DB acreate "$(mk $SID "by $X" "AUTO::${DB}-$X Reply with exactly: X" skip '0 0 1 1 *')" key-$X-c $X | r $X acreate
  node lclient6.mjs $DB aupdate $AID "$(mk $SID "upd by $X" "AUTO::${DB} Reply with exactly: TICK" skip '* * * * *')" key-$X-u $X | r $X aupdate
  node lclient6.mjs $DB arun $AID key-$X-r $X | r $X arun
  node lclient6.mjs $DB aretire $AID key-$X-t $X | r $X aretire
  node lclient6.mjs $DB raw POST /v1/agents/sessions/$SID/events "$(TURN "USER::$X-turn Reply with exactly: $X")" key-$X-turn $X | r $X turn
done
sleep 40
echo "$(date -u +%T) -- demote the creator rig-actor OPERATOR -> READER" >> $L
mysql -h127.0.0.1 -uroot $DB -e "UPDATE managed_workspace_access SET role='READER' WHERE actor_id='rig-actor'"
node lclient6.mjs $DB raw POST /v1/agents/sessions/$SID/events "$(TURN "USER::creator-demoted Reply with exactly: C")" key-cd-turn rig-actor | r rig-actor turn
node lclient6.mjs $DB raw POST /v1/agents/sessions/$SID/events "$(TURN "USER::op2-after-demote Reply with exactly: O")" key-od-turn rig-op2 | r rig-op2 turn
node lclient6.mjs $DB arun $AID key-cd-run rig-actor | r rig-actor arun
node lclient6.mjs $DB aget $AID rig-actor | r rig-actor aget
sleep $DEMOTE
echo "$(date -u +%T) -- restore rig-actor READER -> OPERATOR" >> $L
mysql -h127.0.0.1 -uroot $DB -e "UPDATE managed_workspace_access SET role='OPERATOR' WHERE actor_id='rig-actor'"
node lclient6.mjs $DB raw POST /v1/agents/sessions/$SID/events "$(TURN "USER::op2-after-restore Reply with exactly: R")" key-or-turn rig-op2 | r rig-op2 turn
sleep $RESTORE
echo "$(date -u +%T) -- revoke rig-actor (delete the grant row)" >> $L
mysql -h127.0.0.1 -uroot $DB -e "DELETE FROM managed_workspace_access WHERE actor_id='rig-actor'"
node lclient6.mjs $DB aget $AID rig-actor | r rig-actor aget
node lclient6.mjs $DB aretire $AID key-rv-t rig-actor | r rig-actor aretire
sleep 150
echo "$(date -u +%T) lrole8 done" >> $L
