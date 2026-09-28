#!/bin/bash
# R22: real reboot, then the server is SIGKILLed twice between the committed holder clear and the final retirement.
# usage: run-r22.sh <label> <jar> <db>
set -u
. /root/pr12869-r3/rig/host/r3-lib.sh
LABEL=$1; JAR=$2; DB=$3
OUT=/rig/out
vm "sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd /rig/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='"
vm "cd /rig/vm; /opt/qwen/node s2-prepare.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-170; /opt/qwen/node s2b-prepared.mjs $LABEL 130 | head -1; /opt/qwen/node s10-interrupt.mjs arm $LABEL; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-pre-reboot.txt 2>&1; date -u +%FT%T.%3NZ | tee $OUT/$LABEL-reboot-issued.txt; sync; sudo systemctl reboot" || true
sleep 15
wait_ssh 240
sleep 2
vm "cd /rig/vm; KILLS=2 /opt/qwen/node s10-interrupt.mjs watch $LABEL 2>&1 | tee $OUT/$LABEL-interrupt.txt | cut -c1-600; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-post-reboot.txt 2>&1; grep -a -E '^## |RELEASED|READY|LOST|alive|last=' $OUT/$LABEL-post-reboot.txt | cut -c1-200; /opt/qwen/node s4-after.mjs $LABEL 2>&1 | tee $OUT/$LABEL-after.txt | grep -v 'raw evidence' | cut -c1-300"
echo R22-DONE
