#!/bin/bash
# qwen sandbox --verify across policies, both arms; boundary and backend line
V=/root/verify/r7; Q=$V/q.sh
for ARM in "$@"; do
  for POL in ro-closed ro-open ww-closed ww-open; do
    r=$($Q $ARM $POL sandbox --verify 2>&1)
    rc=$?
    line=$(echo "$r" | grep -iE "verified|checks|fail" | tr '\n' ' ' | cut -c1-90)
    printf '%-2s %-9s rc=%s | %s\n' $ARM $POL $rc "$line"
  done
done
