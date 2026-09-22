#!/bin/bash
# R5-1 preservation: streaming shapes must still work on the fix arm (no regression from the copy path).
V=/root/verify/r7; cd $V
Q=$V/q.sh
run() { local label=$1; shift; local t0=$(date +%s%N)
  out=$(timeout -k 2 60 bash -c "$*" 2>e.tmp); rc=$?
  local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  printf '%-2s | %-40s | rc=%-3s %6sms | out=%s | err=%s\n' "$ARM" "$label" "$rc" "$ms" "$(echo "$out"|tr '\n' ' '|cut -c1-50)" "$(grep -v -e '^Boundary' -e '^Filesystem' -e '^Command' -e '^Model' -e '^Host' -e '^Backend' -e '^Requested' -e '^Effective' -e '^Workspace' e.tmp|tr '\n' ' '|cut -c1-60)"
}
# fixtures
[ -f rand1m.bin ] || head -c 1048576 /dev/urandom > rand1m.bin
RSHA=$(sha256sum rand1m.bin | cut -c1-16)
[ -f big3g.bin ] || truncate -s 3G big3g.bin
for ARM in "$@"; do
  # regular file copied through relay: 20x, all SHA must match
  ok=0; for i in $(seq 20); do s=$($Q $ARM ww-closed sandbox -- sha256sum < rand1m.bin 2>/dev/null | cut -c1-16); [ "$s" = "$RSHA" ] && ok=$((ok+1)); done
  printf '%-2s | %-40s | %s/20 match (expect %s)\n' $ARM "< rand1m file (copied) sha256sum" $ok $RSHA
  run "cat 1MiB | sha256sum (anon pipe)" "cat rand1m.bin | $Q $ARM ww-closed sandbox -- sha256sum | cut -c1-16"
  run "/dev/zero char dev | head -c 8" "$Q $ARM ww-closed sandbox -- head -c 8 < /dev/zero | wc -c"
  run "< /dev/null wc -c" "$Q $ARM ww-closed sandbox -- wc -c < /dev/null"
  run "< 3GiB sparse wc -c (bounded)" "/usr/bin/time -f 'maxrss=%MkB' $Q $ARM ww-closed sandbox -- wc -c < big3g.bin 2>&1 | tail -2"
  run "yes | head -n1 (backpressure)" "yes | $Q $ARM ww-closed sandbox -- head -n1"
  run "segmented writer | cat" "(printf 'a\n'; sleep 0.6; printf 'b\n') | $Q $ARM ww-closed sandbox -- cat"
  run "socket stdin (node spawn)" "node spawn-socket.cjs $ARM"
done
