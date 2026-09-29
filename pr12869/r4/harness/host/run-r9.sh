#!/bin/bash
# host side. R9: power cut at the given jar; the next boot first runs with the option OFF, then with a foreign machine-id, then for real.
# usage: run-r9.sh <label> <jar> <db>
set -u
LABEL=$1; JAR=$2; DB=$3
P=pr12869; RIG=/rig; OUT=$RIG/out
vm() { colima ssh -p $P -- bash -c "$1"; }
vm "sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd $RIG/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='"
vm "cd $RIG/vm; /opt/qwen/node s2-prepare.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-170; /opt/qwen/node s2b-prepared.mjs $LABEL 130 | head -1; /opt/qwen/node s2d-live-and-kill.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-220; /opt/qwen/node s2e-revoke.mjs $LABEL 2>&1 | cut -c1-220; /opt/qwen/node s2f-startup-and-fresh.mjs $LABEL 2>&1 | cut -c1-220; /opt/qwen/node s2i-second-session.mjs $LABEL 2>&1 | cut -c1-260"
vm "sudo sed -i 's/^TRUSTED=.*/TRUSTED=false/; s/^STORAGES=.*/STORAGES=\"a b d e f\"/' /etc/qwen-w0e3.env; cd $RIG/vm; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-pre-crash.txt 2>&1; /opt/qwen/node s2g-last-second.mjs $LABEL 2>&1 | cut -c1-200; date -u +%FT%T.%3NZ | tee $OUT/$LABEL-last-guest-time.txt"
echo "host: power cut issued $(date -u +%FT%T)Z" | tee $OUT/$LABEL-power-cut.txt
colima stop --force -p $P >/dev/null 2>&1
sleep 3
colima start -p $P --activate=false >/dev/null 2>&1
echo "host: VM started $(date -u +%FT%T)Z" | tee -a $OUT/$LABEL-power-cut.txt
echo "=== control 1: option OFF"
vm "cd $RIG/vm; grep -a '^=== ' /var/log/qwen-w0e3/server.log | tail -1 | cut -c1-200; /opt/qwen/node s3-observe.mjs 45 2>&1 | tee $OUT/$LABEL-observe-option-off.txt | cut -c1-420; /opt/qwen/node s5-blocked.mjs $LABEL option-off 2>&1 | tee $OUT/$LABEL-blocked-option-off.txt | cut -c1-300"
echo "=== control 2: foreign machine-id, option ON"
vm "set -e; cd $RIG/vm; sudo systemctl stop qwen-w0e3.service; sudo cp /etc/machine-id /etc/machine-id.rig-orig; echo 0123456789abcdef0123456789abcdef | sudo tee /etc/machine-id >/dev/null; sudo sed -i 's/^TRUSTED=.*/TRUSTED=true/' /etc/qwen-w0e3.env; sudo systemctl reset-failed qwen-w0e3.service || true; sudo systemctl start qwen-w0e3.service; sleep 6; grep -a '^=== ' /var/log/qwen-w0e3/server.log | tail -1 | cut -c1-200; /opt/qwen/node s3-observe.mjs 40 2>&1 | tee $OUT/$LABEL-observe-foreign-host.txt | cut -c1-420; /opt/qwen/node s5-blocked.mjs $LABEL foreign-machine-id 2>&1 | tee $OUT/$LABEL-blocked-foreign-host.txt | cut -c1-300"
echo "=== recovery: original machine-id, option ON"
vm "set -e; cd $RIG/vm; sudo systemctl stop qwen-w0e3.service; sudo cp /etc/machine-id.rig-orig /etc/machine-id; cat /etc/machine-id; sudo systemctl reset-failed qwen-w0e3.service || true; date -u +%FT%T.%3NZ; sudo systemctl start qwen-w0e3.service; /opt/qwen/node s3-observe.mjs 120 2>&1 | tee $OUT/$LABEL-observe.txt | cut -c1-560; grep -a '^=== ' /var/log/qwen-w0e3/server.log | tail -1 | cut -c1-200; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-post-crash.txt 2>&1; grep -a -E '^## |RELEASED|READY|LOST|BLOCKED|alive|last=' $OUT/$LABEL-post-crash.txt | cut -c1-200; /opt/qwen/node s4-after.mjs $LABEL 2>&1 | tee $OUT/$LABEL-after.txt | grep -v 'raw evidence' | cut -c1-300"
echo R9-DONE
