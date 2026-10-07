#!/bin/bash
# VERIFICATION RIG ONLY (PR #13354): run the contention probe for "<arm>:<db>" pairs, one stack at a time.
R=/Users/wenshao/pr13354-rig
down() { $R/lxx.sh "$R/lx/stop.sh $1 all" | grep -v worker-left | tr '\n' ' '; $R/lxx.sh "kill \$(ps -eo pid=,args= | awk -v d=$R/dist/ 'index(\$0, d) && \$0 !~ /awk/ {print \$1}') 2>/dev/null; sleep 1; ps -eo pid,args | grep -v grep | grep -cE 'node|java'"; }
N=${N:-8}; ROUNDS=${ROUNDS:-3}
for pair in "$@"; do
  arm=${pair%%:*}; db=${pair##*:}; mkdir -p $R/results/$db
  $R/lxx.sh "$R/lx/aux.sh $db" > /dev/null; $R/lxx.sh "$R/lx/spring.sh $arm $db" | tail -1; $R/lxx.sh "$R/lx/harness.sh $db $arm" | tail -1
  echo "== $arm $db N=$N ROUNDS=$ROUNDS"
  $R/lxx.sh "cd $R/probe && DB=$db ARM=$arm $R/lx/node/bin/node p8-contention.mjs $N $ROUNDS" 2>&1 | grep -E "^(NOTE  per|FAIL|PASS)|Error" | cut -c1-330
  down $db
done
