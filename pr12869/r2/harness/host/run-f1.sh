#!/bin/bash
# host side. F1 at the given head: Hosted chain + healthy turns with the option on / off / candidate.
# usage: run-f1.sh <tag> <head-jar> <cand-jar> <db>
set -u
TAG=$1; JAR=$2; CAND=$3; DB=$4
P=pr12869; RIG=/rig; OUT=$RIG/out
vm() { colima ssh -p $P -- bash -c "$1"; }
vm "for pid in \$(pgrep -x node); do if tr '\0' ' ' < /proc/\$pid/cmdline | grep -q 'serve --profile hosted-harness\|s2c-poll'; then kill \$pid; fi; done; sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd $RIG/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='; sudo mkdir -p /var/lib/qwen-rt/hosted-run; sudo chown wenshao:wenshao /var/lib/qwen-rt/hosted-run"
vm "cd $RIG/vm; /opt/qwen/node s7-hosted-turns.mjs $TAG b align 2>&1 | tee $OUT/$TAG-s7-hosted-head.txt | cut -c1-420"
vm "cd $RIG/vm; /opt/qwen/node s0-smoke.mjs ws-a st-a 2>&1 | grep -E '^session ' | tee $OUT/$TAG-f1-session.txt"
SID=$(awk '{print $2}' $OUT/$TAG-f1-session.txt)
RS=rs-${SID: -8}
vm "cd $RIG/vm; /opt/qwen/node -e \"import('$RIG/vm/drive.mjs').then(async d=>{console.log('release smoke session', (await d.release('$SID','$RS')).status)})\""
vm "cd $RIG/vm; /opt/qwen/node s6-acquire-cycles.mjs x sid:$SID 180 $TAG-option-on 2>&1 | tee $OUT/$TAG-s6-option-on.json | head -24"
vm "cd $RIG/vm; bash restart-service.sh false $JAR | cut -c1-170; /opt/qwen/node s6-acquire-cycles.mjs x sid:$SID 180 $TAG-option-off 2>&1 | tee $OUT/$TAG-s6-option-off.json | head -24"
vm "cd $RIG/vm; bash restart-service.sh true $CAND | cut -c1-170; /opt/qwen/node s7-hosted-turns.mjs $TAG-candidate d align 2>&1 | tee $OUT/$TAG-s7-hosted-candidate.txt | grep -E 'turn [123]:|proxy:|Broker side|harness status|Workspace Session' | cut -c1-330; /opt/qwen/node s6-acquire-cycles.mjs x sid:$SID 180 $TAG-candidate 2>&1 | tee $OUT/$TAG-s6-candidate.json | head -24"
echo F1-DONE
