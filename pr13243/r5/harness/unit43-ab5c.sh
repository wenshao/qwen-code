#!/bin/bash
# Round 5 (c4f98b15c5): R12-1 strict stderr guard. Alternating whole-file runs head (wt43) vs base (wt43b),
# then the cold-reattach case alone on the head.
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
O=/Users/wenshao/pr13243-rig/out/unit-ab5c; mkdir -p $O
T='reports an aborted live turn as cancelled after a Java-style cold reattach'
for i in 1 2 3; do
  for a in head:wt43 base:wt43b; do
    n=${a%%:*}; w=${a##*:}; cd /Users/wenshao/pr13243-rig/$w/packages/cli
    npx vitest run src/serve/hosted-harness-session.test.ts > $O/$n-file-$i.txt 2>&1; r=$?
    echo "$n file run$i head=$(git rev-parse --short HEAD) exit=$r [$(grep -E '^ +Tests ' $O/$n-file-$i.txt | sed -E 's/^ +Tests +//')] stray-stderr-fail=$(grep -c 'writeStderrLineSafe" to not be called' $O/$n-file-$i.txt) failed=[$(grep -E '^ FAIL ' $O/$n-file-$i.txt | sort -u | sed -E 's/.*> //' | tr '\n' ';')] load=$(sysctl -n vm.loadavg | cut -d' ' -f2)"
  done
done
cd /Users/wenshao/pr13243-rig/wt43/packages/cli
for i in 1 2 3; do
  npx vitest run src/serve/hosted-harness-session.test.ts -t "$T" > $O/head-alone-$i.txt 2>&1; r=$?
  echo "head alone run$i exit=$r [$(grep -E '^ +Tests ' $O/head-alone-$i.txt | sed -E 's/^ +Tests +//')] load=$(sysctl -n vm.loadavg | cut -d' ' -f2)"
done
echo "AB5C-DONE"
