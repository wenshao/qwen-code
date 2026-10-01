#!/bin/bash
# VERIFICATION RIG ONLY: run hosted-harness-session.test.ts N times in one tree; print failures per run.
T=$1; N=$2; export PATH=/opt/node22/bin:$PATH NO_COLOR=1
cd /rig/$T/packages/cli
for i in $(seq 1 $N); do
  o=$(npx vitest run --testTimeout=60000 src/serve/hosted-harness-session.test.ts 2>&1)
  echo "run $i: $(echo "$o" | grep -E '^ *Tests ' | tr -s ' ') :: $(echo "$o" | grep -E '^ *× ' | sed -E 's/^ *× //; s/ [0-9]+ms.*//; s/^.*> //' | tr '\n' ';')"
done
