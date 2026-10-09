#!/bin/bash
# Round 7 real-model regression (qwen3.8-max via gw7) on the r7 arm (build 9f809670c7; 66af9bc185 changes only a test):
#   A1 every-minute allow read_file automation, the Harness SIGKILLed once mid read_file;
#   U1 a manual read_file run crashed mid tool, then a user Turn 10 s after the restart.
cd /Users/wenshao/git/pr13598-rig; source mk4.sh
DB=m7; B=36300; L=runs/$DB/actions.log
CLI=/Users/wenshao/git/pr13598-rig/arms/r7/dist/cli.js JAR=/Users/wenshao/git/pr13598-rig/arms/r7/server.jar ./init6.sh $DB $B | tail -1
mks $DB A1 >/dev/null 2>&1; mks $DB U1 >/dev/null 2>&1; sleep 12
node client.mjs $DB acreate "$(mk $(cat runs/$DB/A1) 'tool crash allow' "AUTO::a1 $TOOLP" allow '* * * * *')" key-A1 | tee runs/$DB/a1-create.json | short
curl -s -XPOST localhost:$((B+6))/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'; echo
./crash5.sh $DB "A1 mid read_file"
sleep 200
echo "$(date -u +%T) A1 observed for 200 s after the restart" >> $L
node client.mjs $DB acreate "$(mk $(cat runs/$DB/U1) 'manual tool run U1' "MANUAL::u1 $TOOLP" skip '0 0 1 1 *')" key-U1 | tee runs/$DB/u1-create.json | short
node -e "console.log(JSON.parse(require('fs').readFileSync('runs/$DB/u1-create.json')).json.id)" > runs/$DB/u1.id
curl -s -XPOST localhost:$((B+6))/rule -d '{"pathRe":"executions/[^:?/]+\\?","action":"delay","ms":150000,"count":1}'; echo
before=$(grep -c "restarted" $L)
nohup ./crash5.sh $DB "U1 manual run mid read_file" >/dev/null 2>&1 &
sleep 1
node client.mjs $DB arun $(cat runs/$DB/u1.id) key-u1-run | short
echo "$(date -u +%T) manual run of U1" >> $L
until [ "$(grep -c "restarted" $L)" -gt "$before" ]; do sleep 0.5; done
sleep 10
echo "$(date -u +%T) U1 user Turn, 10 s after the restart" >> $L
node client.mjs $DB send $(cat runs/$DB/U1) "USER::u1-user Reply with exactly: PONG" | grep -E '"turn_id"' | head -1 >> $L
sleep 150
echo "$(date -u +%T) m7 done" >> $L
