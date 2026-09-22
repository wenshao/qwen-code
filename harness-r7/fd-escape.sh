#!/bin/bash
# R6-1 A/B at round-7 heads: does a redirected stdin descriptor let the confined command write outside the policy?
ART=/root/git/qwen-code-verify/tmp/pr12267-verify-20260922-164444
cd "$ART/scratch"
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe'; }
reset() { rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n' > hostdir/victim.txt; printf 'ws-original\n' > ws/ws-victim.txt; chmod 644 hostdir/victim.txt; }
for ARM in "$@"; do
  for POL in ro-closed ww-closed; do
    reset
    out=$("$ART/harness-r7/q.sh" $ARM $POL sandbox -- sh -c "echo direct > $ART/scratch/hostdir/victim.txt 2>&1; echo \"direct-rc=\$?\"; readlink /proc/self/fd/0; echo via-fd0 > /proc/self/fd/0 && echo \"fd0-write=ok\"" < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-4s %-9s | < file outside ws  | %s| host file: %s\n' $ARM $POL "$out" "$(cat hostdir/victim.txt)"
    reset
    out=$("$ART/harness-r7/q.sh" $ARM $POL sandbox -- sh -c 'echo planted > /proc/self/fd/0/planted.txt && echo "dir-write=ok"; echo up > /proc/self/fd/0/../escaped-up.txt && echo "dotdot-write=ok"' < hostdir/sub 2>&1 | filt | tr '\n' ' ')
    printf '%-4s %-9s | < directory        | %s| host: %s\n' $ARM $POL "$out" "$(cd hostdir; ls sub/planted.txt escaped-up.txt 2>/dev/null | tr '\n' ' ')"
    reset
    out=$("$ART/harness-r7/q.sh" $ARM $POL sandbox -- sh -c 'echo via-fd0 > /proc/self/fd/0 && echo "fd0-write=ok"' < ws/ws-victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-4s %-9s | < file inside ws   | %s| ws file: %s\n' $ARM $POL "$out" "$(cat ws/ws-victim.txt)"
    reset
    out=$("$ART/harness-r7/q.sh" $ARM $POL sandbox -- sh -c 'chmod 666 /proc/self/fd/0 && echo "chmod=ok"' < hostdir/victim.txt 2>&1 | filt | tr '\n' ' ')
    printf '%-4s %-9s | chmod via fd0      | %s| mode: %s\n' $ARM $POL "$out" "$(stat -c %a hostdir/victim.txt)"
  done
done
# named FIFO row (needs a reader, so run it separately)
reset
for ARM in "$@"; do
  rm -f hostdir/named.fifo; mkfifo hostdir/named.fifo; chmod 644 hostdir/named.fifo
  ( exec 3<> hostdir/named.fifo; timeout -k 2 15 "$ART/harness-r7/q.sh" $ARM ro-closed sandbox -- sh -c 'chmod 666 /proc/self/fd/0 && echo "fifo-chmod=ok"; true' < hostdir/named.fifo 2>&1 | filt | tr '\n' ' ' > "$ART/scratch/fifo-out.txt"; exec 3>&- ) &
  FPID=$!; wait $FPID 2>/dev/null
  printf '%-4s ro-closed | named FIFO         | %s| host fifo mode: %s\n' $ARM "$(cat "$ART/scratch/fifo-out.txt")" "$(stat -c %a hostdir/named.fifo)"
done
reset
