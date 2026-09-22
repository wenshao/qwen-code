#!/bin/bash
# N3: an inherited INET socket on stdin keeps the HOST network namespace under network: closed
H=/root/verify/h12267r8; cd $H; Q=$H/q.sh
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
arms=${ARMS:-pre head}
: > listen.log; python3 listen.py listen.log 2>/dev/null & lp=$!; until grep -q ready listen.log; do sleep 0.1; done
echo "host netns     : $(readlink /proc/self/ns/net)"
for ARM in $arms; do
  for proto in tcp udp; do
    arg=''; [ $proto = tcp ] && arg=read
    hdr "\$ qwen sandbox -- python3 payload.py $arg < /dev/$proto/127.0.0.1/47001     # arm=$ARM, policy read-only/closed"
    n0=$(wc -l < listen.log); t0=$(date +%s%N)
    timeout -k 2 40 $Q $ARM ro-closed sandbox -- python3 $H/payload.py $arg < /dev/$proto/127.0.0.1/47001 2>&1 | grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe' | sed 's/^/  /'
    rc=${PIPESTATUS[0]}; ms=$(( ($(date +%s%N)-t0)/1000000 ))
    sleep 0.3; tail -n +$((n0+1)) listen.log | sed 's/^/  /'
    printf '  \033[2m(rc=%s, %s ms)\033[0m\n' $rc $ms
  done
done
kill $lp
