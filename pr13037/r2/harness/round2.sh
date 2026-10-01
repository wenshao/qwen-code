#!/bin/bash
# Round 2 batch (head db01133aec) on schema o3e. Each step logs to out/<step>.log; this file logs progress.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R)
export DB=${DB:-o3e}
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch.log
step() { echo "$(date +%T) START $1 (load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
on() { env ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true "$@" ./restart.sh ${ARM:-pr} $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
FROM=${FROM:-all}
if [ "$FROM" = all ]; then
  on
  step s1 env LABEL=s1a $N s1-states.mjs
  step s2 env FROM=s1a $N s2-reads.mjs
  step s3 env FROM=s1a $N s3-lifecycle.mjs
  step s4 env LABEL=s4 $N s4-make.mjs
  step abort sh -c "$N t-abort-timing.mjs > out/t-abort-timing.log 2>&1"
  step revoke-pr sh -c "for i in 1 2; do $N t-revoke.mjs 2>&1 | sed 's/^/PR head: /' >> out/t-revoke-pr.log; done"
  step b1 $N b1-live.mjs
  step b2 $N b2-paging.mjs
  step b3 $N b3-download.mjs
  step b4 $N b4-states.mjs
  step b6 $N b6-order.mjs
  step b6b $N b6b-busy.mjs
  step gib $N s5-make-gib.mjs
  step cost $N t-cost.mjs
  step slow ./s5-slow.sh
  step gone $N s6-gone.mjs
  on
  step unbound $N t-unbound.mjs
  step faults $N s9-faults.mjs
  on
fi
echo "$(date +%T) BATCH DONE" >> $B
