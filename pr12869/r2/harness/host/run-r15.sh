#!/bin/bash
# host side. Hands-off real reboot (systemctl reboot) with all arms, option on. usage: run-r15.sh <label> <jar> <db>
set -u
LABEL=$1; JAR=$2; DB=$3
P=pr12869; RIG=/rig; OUT=$RIG/out
vm() { colima ssh -p $P -- bash -c "$1"; }
vm "for pid in \$(pgrep -x node); do if tr '\0' ' ' < /proc/\$pid/cmdline | grep -q 'serve --profile hosted-harness\|s2c-poll'; then kill \$pid; fi; done; sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd $RIG/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='"
vm "cd $RIG/vm; /opt/qwen/node s2-prepare.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-170; /opt/qwen/node s2b-prepared.mjs $LABEL 130 | head -1; /opt/qwen/node s2d-live-and-kill.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-220; /opt/qwen/node s2e-revoke.mjs $LABEL 2>&1 | cut -c1-260; /opt/qwen/node s2f-startup-and-fresh.mjs $LABEL 2>&1 | cut -c1-220; /opt/qwen/node s2i-second-session.mjs $LABEL 2>&1 | cut -c1-260"
vm "sudo sed -i 's/^STORAGES=.*/STORAGES=\"a b d e f\"/' /etc/qwen-w0e3.env; cd $RIG/vm; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-pre-reboot.txt 2>&1; /opt/qwen/node s2g-last-second.mjs $LABEL 2>&1 | cut -c1-200; date -u +%FT%T.%3NZ | tee $OUT/$LABEL-reboot-issued.txt; sync; sudo systemctl reboot"
sleep 15
for i in $(seq 1 40); do colima ssh -p $P -- cat /proc/sys/kernel/random/boot_id 2>/dev/null && break; sleep 3; done
sleep 2
for i in 1 2 3; do colima ssh -p $P -- true 2>/dev/null && break; sleep 3; done
vm "cd $RIG/vm; /opt/qwen/node s3-observe.mjs 120 2>&1 | tee $OUT/$LABEL-observe.txt | cut -c1-560; grep -a '^=== ' /var/log/qwen-w0e3/server.log | tail -2 | cut -c1-200; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-post-reboot.txt 2>&1; grep -a -E '^## |RELEASED|READY|LOST|BLOCKED|alive|last=' $OUT/$LABEL-post-reboot.txt | cut -c1-200; /opt/qwen/node s4-after.mjs $LABEL 2>&1 | tee $OUT/$LABEL-after.txt | grep -v 'raw evidence' | cut -c1-300"
echo R15-DONE
