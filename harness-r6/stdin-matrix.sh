#!/bin/bash
# R5-1 closure matrix: redirected stdin shapes, per arm
cd /root/verify/h12267r6
Q=./q.sh
run() { # label, cmd...
  local label=$1; shift
  local t0=$(date +%s%N)
  out=$(timeout -k 2 40 bash -c "$*" 2>err.tmp); rc=$?
  local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  printf '%-4s | %-44s | rc=%-3s | %6sms | out=%s | err=%s\n' "$ARM" "$label" "$rc" "$ms" "$(echo "$out"|tr '\n' ' '|cut -c1-60)" "$(grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe' err.tmp|tr '\n' ' '|cut -c1-90)"
}
for ARM in "$@"; do
  run "sleep 3 | echo hi" "sleep 3 | $Q $ARM ww-closed sandbox -- echo hi"
  run "segmented writer | cat" "(printf 'first\n'; sleep 1; printf 'second\n') | $Q $ARM ww-closed sandbox -- cat"
  run "50 slow lines | wc -l" "(for i in \$(seq 50); do echo \$i; sleep 0.03; done) | $Q $ARM ww-closed sandbox -- wc -l"
  run "read a; read b (2 segments)" "(echo A; sleep 0.5; echo B) | $Q $ARM ww-closed sandbox -- sh -c 'read a; read b; echo \$a\$b'"
  run "< /dev/null wc -c" "$Q $ARM ww-closed sandbox -- wc -c < /dev/null"
  run "< 3 GiB sparse file wc -c" "/usr/bin/time -f 'maxrss=%MkB' $Q $ARM ww-closed sandbox -- wc -c < big3g.bin 2>&1 | tail -2"
  run "yes | head -n1 (stdin side)" "yes | /usr/bin/time -f 'maxrss=%MkB' $Q $ARM ww-closed sandbox -- head -n1 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'"
  run "child fd0 flags (pipe)" "(sleep 1) | $Q $ARM ww-closed sandbox -- sh -c 'grep flags /proc/self/fdinfo/0; readlink /proc/self/fd/0'"
  run "socket stdin (node spawn)" "node spawn-socket.cjs $ARM"
done
