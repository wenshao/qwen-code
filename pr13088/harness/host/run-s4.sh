#!/bin/bash
# macOS host: S4 — a real reboot and a real power cut of the dedicated Linux VM with the option on.
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-new"; P=pr12869
step() { echo "=== $(date +%T) $1"; }
boot() { colima ssh -p $P -- cat /proc/sys/kernel/random/boot_id 2>/dev/null; }
wait_vm() { for i in $(seq 1 90); do colima ssh -p $P -- true 2>/dev/null && [ -n "$(boot)" ] && [ "$(boot)" != "$1" ] && break; sleep 2; done; for i in $(seq 1 60); do colima ssh -p $P -- docker exec w0e3-db mysqladmin -uroot -prootpw ping 2>/dev/null | grep -q alive && break; sleep 2; done; echo "VM back: boot_id=$(boot) mysql=$(colima ssh -p $P -- docker exec w0e3-db mysqladmin -uroot -prootpw ping 2>/dev/null)"; }
step "prepare"; $V "bash s4-mounts.sh down; bash reset.sh w1n_s4 VERIFIED=true TRUSTED=true JAR=head-server.jar DIST=dist-head DURABLE=true HARNESS=false 'STORAGES=\"a l v t\"' > /dev/null; bash s4-mounts.sh up && bash svc.sh start && $E PHASE=before /opt/qwen/node s4-reboot.mjs" > $RIG/out/new/s4-before.console 2>&1
B0=$(boot); step "systemctl reboot (boot_id $B0)"; T0=$(date +%s); colima ssh -p $P -- sudo systemctl reboot 2>/dev/null; sleep 5; wait_vm "$B0"; echo "reboot took $(( $(date +%s) - T0 )) s"
step "after reboot: remount (loop image attached under another number), start"; $V "bash s4-mounts.sh up shuffle && bash svc.sh start && sleep 8 && $E PHASE=after TAG=after-reboot /opt/qwen/node s4-reboot.mjs" > $RIG/out/new/s4-after-reboot.console 2>&1
step "loop image re-attached under its original number"; $V "bash svc.sh stop; bash s4-mounts.sh down; bash s4-mounts.sh up && bash svc.sh start && sleep 8 && $E PHASE=after TAG=after-remount STS='l t' /opt/qwen/node s4-reboot.mjs" > $RIG/out/new/s4-after-remount.console 2>&1
B1=$(boot); step "power cut (colima stop --force), boot_id $B1"; T0=$(date +%s); colima stop --force -p $P > /dev/null 2>&1; colima start -p $P --activate=false > /dev/null 2>&1; wait_vm "$B1"; echo "power cycle took $(( $(date +%s) - T0 )) s"
step "after power cut"; $V "bash s4-mounts.sh up && bash svc.sh start && sleep 8 && $E PHASE=after TAG=after-power-cut STS='a l v' /opt/qwen/node s4-reboot.mjs" > $RIG/out/new/s4-after-power-cut.console 2>&1
step "cleanup"; $V "bash svc.sh stop; bash s4-mounts.sh down; bash svc.sh 'STORAGES=\"a b c d\"' TRUSTED=false" > /dev/null 2>&1
step DONE
