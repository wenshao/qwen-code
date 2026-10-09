#!/bin/bash
# Round 4: targeted alternating A/B of the 5 tests that failed in the full run (head wt43 vs base wt43b).
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
O=/Users/wenshao/pr13243-rig/out/unit-ab4; mkdir -p $O
P1='drains a long settled history without rescanning it per occurrence|settles parallel quota refusals after a lost reply'
P2='reopens a Session whose journal carries a child_acceptance commit|refuses a fresh prompt stacked on a Session attached with a parked Turn|refuses retriably when the wait-check reports exception'
for i in 1 2 3; do
  for a in head:wt43 base:wt43b; do
    n=${a%%:*}; w=${a##*:}; cd /Users/wenshao/pr13243-rig/$w/packages/cli
    npx vitest run src/serve/hosted-hook-session.test.ts -t "$P1" > $O/$n-hook-$i.txt 2>&1; r1=$?
    npx vitest run src/serve/hosted-harness-session.test.ts -t "$P2" > $O/$n-harness-$i.txt 2>&1; r2=$?
    echo "$n run$i head=$(git rev-parse --short HEAD) hook-session exit=$r1 [$(grep -E '^ +Tests ' $O/$n-hook-$i.txt | sed -E 's/^ +Tests +//')] harness-session exit=$r2 [$(grep -E '^ +Tests ' $O/$n-harness-$i.txt | sed -E 's/^ +Tests +//')] load=$(sysctl -n vm.loadavg | cut -d' ' -f2)"
  done
done
