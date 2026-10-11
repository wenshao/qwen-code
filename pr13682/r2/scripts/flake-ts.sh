#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): one CLI test that failed on the head baseline. Interleave head (h3) and main 543f03e5 (m3).
L=/root/v13682/out/flake-ts.log; : > $L
for i in $(seq 1 20); do for A in h3 m3; do
  r=$(cd /root/v13682/$A/packages/cli && CI=1 timeout 600 npx vitest run src/serve/hosted-harness-session.test.ts -t "child_acceptance commit" 2>&1 | grep -E "Tests .*(passed|failed)" | sed "s/\x1b\[[0-9;]*m//g" | tr -s " ")
  echo "$i $A $r" >> $L
done; done
echo FLAKE-TS-DONE >> $L
