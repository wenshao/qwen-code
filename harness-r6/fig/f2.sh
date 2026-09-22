. /root/verify/h12267r6/fig/common.sh; cd /root/verify/h12267r6
hdr "PR #12267 round 6 - R5-2 closure: downstream reader closes early   (timeout -k 2 20 around each run)"
printf "${D}rig: Linux $(uname -r), Node $(node --version), bubblewrap $(/usr/bin/bwrap --version | cut -d" " -f2)${N}\n"
printf "${D}arms: r6 = 479027b0a7 (previous head, round 5)   r7 = 05f6d76332 (this head)${N}\n\n"
left() { ps -eo pid,comm,args | awk '$2=="bwrap" || ($2=="node" && /sandboxBwrapRelay/) || $2=="yes"' | wc -l; }
one() { a=$1; label=$2; prod=$3; cons=$4; t0=$(date +%s%N)
  timeout -k 2 20 $Q $a ww-closed sandbox -- sh -c "$prod" 2>e.txt | $cons > /dev/null; rc=${PIPESTATUS[0]}
  ms=$(( ($(date +%s%N)-t0)/1000000 )); sleep 0.5; l=$(left); msg="$a: rc=$rc after ${ms} ms, leftover bwrap/relay/yes=$l, stderr='$(filt < e.txt | head -1)'"
  if [ $rc = 141 ]; then ok "$msg"; elif [ $rc = 124 ]; then bad "$msg"; else note "$msg"; fi; }
hdr "1) qwen sandbox -- yes | head -n1"; for a in r6 r7; do one $a y 'yes' 'head -n1'; done; echo
hdr "2) qwen sandbox -- sh -c 'while :; do echo y; sleep 0.2; done' | head -n1"; for a in r6 r7; do one $a s 'while :; do echo y; sleep 0.2; done' 'head -n1'; done; echo
hdr "3) qwen sandbox -- cat text50m.txt | head -c 1"; for a in r6 r7; do one $a c 'cat text50m.txt' 'head -c 1'; done; echo
hdr "4) stderr side: qwen sandbox -- sh -c 'yes >&2' 2>&1 >/dev/null | head -n 20"
for a in r6 r7; do t0=$(date +%s%N); timeout -k 2 20 $Q $a ww-closed sandbox -- sh -c 'yes >&2' 2>&1 >/dev/null | head -n 20 >/dev/null; rc=${PIPESTATUS[0]}; ms=$(( ($(date +%s%N)-t0)/1000000 )); m="$a: rc=$rc after ${ms} ms"; [ $rc = 141 ] && ok "$m" || bad "$m"; done; echo
hdr "5) non-EPIPE output error: qwen sandbox -- echo hi > /dev/full"
for a in r6 r7; do $Q $a ww-closed sandbox -- echo hi > /dev/full 2>e.txt; rc=$?; m="$a: rc=$rc stderr='$(filt < e.txt | tail -1)'"; [ $rc = 0 ] && bad "$m  (write error lost)" || note "$m"; done
