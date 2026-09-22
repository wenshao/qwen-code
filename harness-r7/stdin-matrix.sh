#!/bin/bash
# R5-1 regression matrix at the new head: redirected stdin shapes must keep working
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
cd "$ART/scratch"
Q="$ART/harness-r7/q.sh"
FILT='^Boundary|^Filesystem|^Command network|^Model,|^Host reads|^Backend probe'
run() { # label, cmd...
  local label=$1; shift
  local t0=$(date +%s%N)
  out=$(timeout -k 2 60 bash -c "$*" 2>err.tmp); rc=$?
  local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  printf '%-4s | %-44s | rc=%-3s | %6sms | out=%s | err=%s\n' "$ARM" "$label" "$rc" "$ms" "$(echo "$out"|tr '\n' ' '|cut -c1-60)" "$(grep -v -e "$FILT" err.tmp|tr '\n' ' '|cut -c1-90)"
}
for ARM in "$@"; do
  run "sleep 3 | echo hi" "sleep 3 | $Q $ARM ww-closed sandbox -- echo hi"
  run "segmented writer | cat" "(printf 'first\n'; sleep 1; printf 'second\n') | $Q $ARM ww-closed sandbox -- cat"
  run "50 slow lines | wc -l" "(for i in \$(seq 50); do echo \$i; sleep 0.03; done) | $Q $ARM ww-closed sandbox -- wc -l"
  run "read a; read b (2 segments)" "(echo A; sleep 0.5; echo B) | $Q $ARM ww-closed sandbox -- sh -c 'read a; read b; echo \$a\$b'"
  run "< /dev/null wc -c" "$Q $ARM ww-closed sandbox -- wc -c < /dev/null"
  run "< 1 MiB file sha256 (copied path)" "$Q $ARM ww-closed sandbox -- sha256sum < "$ART/scratch/ws/rand1m.bin" | cut -c1-16"
  run "< 3 GiB sparse file wc -c" "$Q $ARM ww-closed sandbox -- wc -c < "$ART/scratch/ws/big3g.bin" 2>&1 | tail -2"
  run "input never read (echo hi < 3 GiB)" "$Q $ARM ww-closed sandbox -- echo hi < "$ART/scratch/ws/big3g.bin" 2>&1 | tail -2"
  run "yes | head -n1 (stdin side)" "yes | $Q $ARM ww-closed sandbox -- head -n1 2>&1 | grep -v -e '$FILT'"
  run "child fd0 flags (pipe)" "(sleep 1) | $Q $ARM ww-closed sandbox -- sh -c 'grep flags /proc/self/fdinfo/0; readlink /proc/self/fd/0'"
  run "child fd0 flags (< file, copied)" "$Q $ARM ww-closed sandbox -- sh -c 'grep flags /proc/self/fdinfo/0; readlink /proc/self/fd/0' < "$ART/scratch/ws/rand1m.bin""
  run "socket stdin (node spawn)" "node $ART/harness-r7/spawn-socket.cjs $ARM"
  run "named FIFO data intact" "bash $ART/harness-r7/fifo-data.sh $ARM"
  run "< directory (expect EOF, no crash)" "$Q $ARM ww-closed sandbox -- cat < hostdir/sub; echo rc-inner=\$?"
done
