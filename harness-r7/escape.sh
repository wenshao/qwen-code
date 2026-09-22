#!/bin/bash
# R6-1: does a redirected stdin descriptor let the confined command write outside the read-only policy?
# arm A = fix (54c6407), arm B = parent relay (0b4349, the round-6 escape head).
V=/root/verify/r7; cd $V
Q=$V/q.sh
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe' -e '^Requested' -e '^Effective' -e '^Workspace'; }
reset() { rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n' > hostdir/victim.txt; printf 'ws-original\n' > ws/ws-victim.txt; chmod 644 hostdir/victim.txt; }
echo "=== R6-1 escape probe (policy read-only/closed and workspace-write/closed) ==="
for ARM in "$@"; do
  for POL in ro-closed ww-closed; do
    reset
    out=$($Q $ARM $POL sandbox -- sh -c 'echo direct > /root/verify/r7/hostdir/victim.txt 2>&1; echo "direct-rc=$?"; echo "link=$(readlink /proc/self/fd/0)"; echo via-fd0 > /proc/self/fd/0 && echo "fd0-write=ok"' < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-2s %-9s | < host file (outside ws) | %s|| host file now: %s\n' $ARM $POL "$out" "$(cat hostdir/victim.txt | tr '\n' ' ')"
    reset
    out=$($Q $ARM $POL sandbox -- sh -c 'echo planted > /proc/self/fd/0/planted.txt && echo "dir-write=ok"; echo up > /proc/self/fd/0/../escaped-up.txt && echo "dotdot-write=ok"' < hostdir/sub 2>&1 | filt | tr '\n' ' ')
    printf '%-2s %-9s | < host directory        | %s|| planted on host: %s\n' $ARM $POL "$out" "$(cd hostdir; ls sub/planted.txt escaped-up.txt 2>/dev/null | tr '\n' ' ')"
    reset
    out=$($Q $ARM $POL sandbox -- sh -c 'echo via-fd0 > /proc/self/fd/0 && echo "fd0-write=ok"' < ws/ws-victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-2s %-9s | < ws file (read-only)    | %s|| ws file now: %s\n' $ARM $POL "$out" "$(cat ws/ws-victim.txt | tr '\n' ' ')"
    reset
    out=$($Q $ARM $POL sandbox -- sh -c 'chmod 666 /proc/self/fd/0 && echo "chmod=ok"' < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-2s %-9s | chmod via fd0           | %s|| host mode now: %s\n' $ARM $POL "$out" "$(stat -c %a hostdir/victim.txt)"
  done
done
reset
