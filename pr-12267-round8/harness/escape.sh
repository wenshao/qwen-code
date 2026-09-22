#!/bin/bash
# R6-1 A/B on x86_64: does a redirected host descriptor let the confined command write outside policy?
H=/root/verify/h12267r8; cd $H; Q=$H/q.sh
hdr(){ printf '\033[1;36m%s\033[0m\n' "$*"; }
filt(){ grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'; }
reset(){ rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n' > hostdir/victim.txt; printf 'ws-original\n' > ws/wsvictim.txt; chmod 644 hostdir/victim.txt; }
arms=${ARMS:-pre head}
for POL in ro-closed ww-closed; do
 hdr "policy $POL"
 for ARM in $arms; do
  reset; o=$($Q $ARM $POL sandbox -- sh -c 'echo direct>/root/verify/h12267r8/hostdir/victim.txt 2>/dev/null; echo direct-rc=$?; echo via-fd0>/proc/self/fd/0 2>/dev/null && echo fd0-write=ok || echo fd0-write=blocked' < hostdir/victim.txt 2>&1|filt|tr '\n' ' ')
  printf '  %-4s < host file   | %s| host file now: %s\n' $ARM "$o" "$(cat hostdir/victim.txt)"
  reset; o=$($Q $ARM $POL sandbox -- sh -c 'echo planted>/proc/self/fd/0/planted.txt 2>/dev/null && echo dir-write=ok||echo dir-write=blocked; echo up>/proc/self/fd/0/../escaped-up.txt 2>/dev/null && echo dotdot=ok||echo dotdot=blocked' < hostdir/sub 2>&1|filt|tr '\n' ' ')
  printf '  %-4s < host dir    | %s| planted on host: %s\n' $ARM "$o" "$(cd hostdir; ls sub/planted.txt escaped-up.txt 2>/dev/null|tr '\n' ' ')"
  reset; o=$($Q $ARM $POL sandbox -- sh -c 'chmod 666 /proc/self/fd/0 2>/dev/null && echo chmod=ok||echo chmod=blocked' < hostdir/victim.txt 2>&1|filt|tr '\n' ' ')
  printf '  %-4s chmod via fd0 | %s| host mode now: %s\n' $ARM "$o" "$(stat -c %a hostdir/victim.txt)"
 done
done; reset
