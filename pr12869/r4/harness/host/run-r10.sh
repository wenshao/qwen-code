#!/bin/bash
# host side. R10: real reboot, then the server is SIGKILLed twice between the committed holder clear and the final retirement.
# usage: run-r10.sh <label> <jar> <db>
set -u
LABEL=$1; JAR=$2; DB=$3
P=pr12869; RIG=/rig; OUT=$RIG/out
vm() { colima ssh -p $P -- bash -c "$1"; }
vm "sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd $RIG/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='"
vm "cd $RIG/vm; /opt/qwen/node s2-prepare.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-170; /opt/qwen/node s2b-prepared.mjs $LABEL 130 | head -1; /opt/qwen/node s10-interrupt.mjs arm $LABEL; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-pre-reboot.txt 2>&1; date -u +%FT%T.%3NZ | tee $OUT/$LABEL-reboot-issued.txt; sync; sudo systemctl reboot"
sleep 15
for i in $(seq 1 40); do colima ssh -p $P -- cat /proc/sys/kernel/random/boot_id 2>/dev/null && break; sleep 3; done
vm "cd $RIG/vm; KILLS=2 /opt/qwen/node s10-interrupt.mjs watch $LABEL 2>&1 | tee $OUT/$LABEL-interrupt.txt | cut -c1-600; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-post-reboot.txt 2>&1; grep -a -E '^## |RELEASED|READY|LOST|alive|last=' $OUT/$LABEL-post-reboot.txt | cut -c1-200; /opt/qwen/node s4-after.mjs $LABEL 2>&1 | tee $OUT/$LABEL-after.txt | grep -v 'raw evidence' | cut -c1-300"
echo R10-DONE
