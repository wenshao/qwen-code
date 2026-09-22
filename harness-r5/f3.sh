. /root/verify/h12267r5/fig/common.sh; cd /root/verify/h12267r5
hdr "PR #12267 round 5 - consumer closes early:  qwen sandbox -- <producer> | head -n1"
printf "${D}r5pre = e1a1f56b00   r5 = 6f498f177a (head)   r5out = head + flush + EPIPE->abort (3 lines)   timeout 20 s${N}\n\n"
for p in "yes" "sh -c 'while :; do echo y; sleep 0.2; done'"; do hdr "producer: $p"
for a in r5pre r5 r5out; do s=$(date +%s%N); eval "timeout -k 2 20 $Q $a ww-closed sandbox -- $p" 2>e.txt | head -n1 >/dev/null; rc=${PIPESTATUS[0]}; ms=$(( ($(date +%s%N)-s)/1000000 )); er=$(filt < e.txt | head -1 | cut -c1-60)
  case $a in r5pre) note "$a: exit=$rc after ${ms} ms   stderr: ${er:-<none>}";; r5) bad "$a: exit=$rc after ${ms} ms   (124 = killed by timeout)";; r5out) ok "$a: exit=$rc after ${ms} ms   stderr: ${er:-<none>}";; esac; done; echo; done
hdr "6 s after head exited (r5, producer 'yes'):"
( timeout -k 2 12 $Q r5 ww-closed sandbox -- yes 2>/dev/null | head -n1 >/dev/null ) & sleep 6
ps -eo pid,etimes,pcpu,comm,args | awk '$4=="yes" || ($4=="node" && /pr12267-r5\/dist\/cli/) {printf "  %-6s %-5s %5s%%  %s\n", $1, $2"s", $3, substr($0, index($0,$5), 60)}'; wait
note "cause: once(stream,'drain') rejects on 'error'; clearDrain() drops the EPIPE, later chunks are silently discarded while the child keeps running"
