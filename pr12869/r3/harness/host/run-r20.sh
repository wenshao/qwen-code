#!/bin/bash
# R20: hands-off real reboot (systemctl reboot) with all arms, option on. usage: run-r20.sh <label> <jar> <db>
set -u
. /root/pr12869-r3/rig/host/r3-lib.sh
LABEL=$1; JAR=$2; DB=$3
OUT=/rig/out
vm "for pid in \$(pgrep -x node); do if tr '\0' ' ' < /proc/\$pid/cmdline | grep -q 'serve --profile hosted-harness\|s2c-poll'; then kill \$pid; fi; done; sudo sed -i 's/^JAR=.*/JAR=$JAR/' /etc/qwen-w0e3.env; cd /rig/vm; bash reset-db.sh $DB true 'a b c d e f' 2>&1 | grep -E 'status|JAR=|TRUSTED=|DB='"
vm "cd /rig/vm; /opt/qwen/node s2-prepare.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-170; /opt/qwen/node s2b-prepared.mjs $LABEL 130 | head -1; /opt/qwen/node s2d-live-and-kill.mjs $LABEL 2>&1 | grep ' arm ' | cut -c1-220; /opt/qwen/node s2e-revoke.mjs $LABEL 2>&1 | cut -c1-260; /opt/qwen/node s2f-startup-and-fresh.mjs $LABEL 2>&1 | cut -c1-220; /opt/qwen/node s2i-second-session.mjs $LABEL 2>&1 | cut -c1-260"
OLD_BOOT=$(vm_boot_id)
echo "host: old boot_id $OLD_BOOT"
vm "sudo sed -i 's/^STORAGES=.*/STORAGES=\"a b d e f\"/' /etc/qwen-w0e3.env; cd /rig/vm; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-pre-reboot.txt 2>&1; /opt/qwen/node s2g-last-second.mjs $LABEL 2>&1 | cut -c1-200; date -u +%FT%T.%3NZ | tee $OUT/$LABEL-reboot-issued.txt; sync; sudo systemctl reboot" || true
wait_new_boot "$OLD_BOOT" 240
sleep 2
vm "cd /rig/vm; /opt/qwen/node s3-observe.mjs 150 2>&1 | tee $OUT/$LABEL-observe.txt | cut -c1-560; grep -a '^=== ' /var/log/qwen-w0e3/server.log | tail -2 | cut -c1-200; /opt/qwen/node snap.mjs $LABEL > $OUT/$LABEL-post-reboot.txt 2>&1; grep -a -E '^## |RELEASED|READY|LOST|BLOCKED|alive|last=' $OUT/$LABEL-post-reboot.txt | cut -c1-200; /opt/qwen/node s4-after.mjs $LABEL 2>&1 | tee $OUT/$LABEL-after.txt | grep -v 'raw evidence' | cut -c1-300"
echo R20-DONE
