#!/bin/bash
# round-3 host-side helpers: ssh replaces colima; power cut = SIGKILL the qemu process.
set -u
VMDIR=/root/pr12869-r3/vm
SSHOPT="-o StrictHostKeyChecking=no -o UserKnownHostsFile=$VMDIR/known_hosts -o ConnectTimeout=10 -p 10022"
export LC_ALL=C

vm() { ssh $SSHOPT wenshao@127.0.0.1 "bash -c $(printf '%q' "$1")"; }

wait_ssh() { # seconds
  local end=$((SECONDS + ${1:-120}))
  while [ $SECONDS -lt $end ]; do ssh $SSHOPT wenshao@127.0.0.1 true 2>/dev/null && return 0; sleep 3; done
  return 1
}

vm_boot_id() { ssh $SSHOPT wenshao@127.0.0.1 'cat /proc/sys/kernel/random/boot_id' 2>/dev/null; }

power_cut() {
  echo "host: power cut issued $(date -u +%FT%T)Z (qemu pid $(cat $VMDIR/vm.pid 2>/dev/null))"
  kill -9 "$(cat $VMDIR/vm.pid)" 2>/dev/null || true
  sleep 3
}

power_on() {
  echo "host: power on $(date -u +%FT%T)Z"
  ( cd $VMDIR && setsid nohup ./boot-vm.sh </dev/null >/dev/null 2>&1 & )
  sleep 2
}

wait_new_boot() { # <old boot_id> [seconds] — returns when the VM answers ssh with a different boot id
  local old=$1 end=$((SECONDS + ${2:-180}))
  while [ $SECONDS -lt $end ]; do
    local b; b=$(vm_boot_id)
    [ -n "$b" ] && [ "$b" != "$old" ] && { echo "host: new boot_id $b after $(( ${2:-180} - (end - SECONDS) ))s"; return 0; }
    sleep 3
  done
  return 1
}
