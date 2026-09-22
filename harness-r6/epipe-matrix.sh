#!/bin/bash
# R5-2 closure: downstream reader closes early
cd /root/verify/h12267r6
Q=./q.sh
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'; }
one() { # arm label pipeline-producer-args consumer
  local ARM=$1 label=$2 prod=$3 cons=$4
  local t0=$(date +%s%N)
  if [ "$label" = "stderr-only yes 2>&1 | head -n1" ]; then
    timeout -k 2 20 $Q $ARM ww-closed sandbox -- sh -c "$prod" 2>&1 >/dev/null | $cons > /dev/null; local rc=${PIPESTATUS[0]}; : > err.tmp
  else
    timeout -k 2 20 $Q $ARM ww-closed sandbox -- sh -c "$prod" 2>err.tmp | $cons > /dev/null; local rc=${PIPESTATUS[0]}
  fi
  local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  sleep 0.5
  local left=$(ps -eo pid,comm,args | awk '$2=="bwrap" || ($2=="node" && /sandboxBwrapRelay/) || ($2=="yes")' | grep -v awk | wc -l)
  printf '%-4s | %-34s | rc=%-3s | %6sms | leftover=%s | stderr=%s\n' "$ARM" "$label" "$rc" "$ms" "$left" "$(filt < err.tmp | head -3 | tr '\n' ' ' | cut -c1-100)"
}
for ARM in "$@"; do
  for i in 1 2 3; do one $ARM "yes | head -n1" 'yes' 'head -n1'; done
  one $ARM "slow loop | head -n1" 'while :; do echo y; sleep 0.2; done' 'head -n1'
  one $ARM "stderr-only yes 2>&1 | head -n1" 'yes >&2' 'head -n1'
  one $ARM "seq 1e6 | head -c 10" 'seq 1000000' 'head -c 10'
  one $ARM "cat 50MB | head -c 1" 'cat text50m.txt' 'head -c 1'
done
