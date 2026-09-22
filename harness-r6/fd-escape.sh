#!/bin/bash
# Does a redirected stdin descriptor let the confined command write outside the policy?
cd /root/verify/h12267r6
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'; }
reset() { rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n' > hostdir/victim.txt; printf 'ws-original\n' > ws/ws-victim.txt; chmod 644 hostdir/victim.txt; }
for ARM in "$@"; do
  for POL in ro-closed ww-closed; do
    reset
    out=$(./q.sh $ARM $POL sandbox -- sh -c 'echo direct > /root/verify/h12267r6/hostdir/victim.txt 2>&1; echo "direct-rc=$?"; readlink /proc/self/fd/0; echo via-fd0 > /proc/self/fd/0 && echo "fd0-write=ok"' < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-3s %-9s | < file outside ws  | %s| host file: %s\n' $ARM $POL "$out" "$(cat hostdir/victim.txt)"
    reset
    out=$(./q.sh $ARM $POL sandbox -- sh -c 'echo planted > /proc/self/fd/0/planted.txt && echo "dir-write=ok"; echo up > /proc/self/fd/0/../escaped-up.txt && echo "dotdot-write=ok"' < hostdir/sub 2>&1 | filt | tr '\n' ' ')
    printf '%-3s %-9s | < directory        | %s| host: %s\n' $ARM $POL "$out" "$(cd hostdir; ls sub/planted.txt escaped-up.txt 2>/dev/null | tr '\n' ' ')"
    reset
    out=$(./q.sh $ARM $POL sandbox -- sh -c 'echo via-fd0 > /proc/self/fd/0 && echo "fd0-write=ok"' < ws/ws-victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-3s %-9s | < file inside ws   | %s| ws file: %s\n' $ARM $POL "$out" "$(cat ws/ws-victim.txt)"
    reset
    out=$(./q.sh $ARM $POL sandbox -- sh -c 'chmod 666 /proc/self/fd/0 && echo "chmod=ok"' < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-3s %-9s | chmod via fd0      | %s| mode: %s\n' $ARM $POL "$out" "$(stat -c %a hostdir/victim.txt)"
  done
done
reset
