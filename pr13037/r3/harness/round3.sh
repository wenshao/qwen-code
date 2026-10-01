#!/bin/bash
# Round 3 batch (head e47fa595ee), schema o3g. Aborts when a restart does not come up.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R)
export DB=${DB:-o3g}
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch.log
step() { echo "$(date +%T) START $1 (load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
rs() { local arm=$1; shift; env "$@" ./restart.sh $arm $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
on() { rs ${ARM:-pr} ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true "$@"; }
# the database delay relay must be up for the latency steps
lsof -nP -iTCP:24037 -sTCP:LISTEN -t >/dev/null || { nohup $N db-delay.mjs 24037 23037 1 > $S/logs/db-delay3.log 2>&1 & echo $! > run/dbdelay.pid; sleep 1; }
lsof -nP -iTCP:24037 -sTCP:LISTEN -t >/dev/null || { echo "RELAY NOT RUNNING - aborting" >> $B; exit 9; }
on
step s1 env LABEL=s1a $N s1-states.mjs
step s2 env FROM=s1a $N s2-reads.mjs
step s3 env FROM=s1a $N s3-lifecycle.mjs
step s4 env LABEL=s4 $N s4-make.mjs
step abort sh -c "$N t-abort-timing.mjs > out/t-abort-timing.log 2>&1"
step abort-corrupt $N t-abort-corrupt.mjs
step revoke-pr sh -c "for i in 1 2; do $N t-revoke.mjs 2>&1 | sed 's/^/PR head: /' >> out/t-revoke-pr.log; done"
step b1 $N b1-live.mjs
step b2 $N b2-paging.mjs
step b3 $N b3-download.mjs
step b4 $N b4-states.mjs
step b6b $N b6b-busy.mjs
step b8 $N b8-abort-ui.mjs
step gib $N s5-make-gib.mjs
step cost $N t-cost.mjs
step slow ./s5-slow.sh
step gone $N s6-gone.mjs
on
step unbound $N t-unbound.mjs
step faults $N s9-faults.mjs
on JVM_EXTRA="-Duser.timezone=Asia/Shanghai"
step tz sh -c "$N t-tz.mjs > out/t-tz.log 2>&1"
rm -f out/t-routes.log
rs pr PUB_ORIGINAL=true PUB_PREVIEW=true
step routes-off env LABEL="O3 disabled (default)" $N t-routes.mjs
on
step routes-on env LABEL=enabled $N t-routes.mjs
rm -f out/s7-policy.json
pol() { local label=$1 ws=$2; shift 2; rs pr "$@"; step "policy $label" sh -c "CONF='$label' WS=$ws $N s7-policy.mjs >> out/s7-policy.log 2>&1"; }
pol "enabled, original=false, preview=false" 25 ARTIFACTS=true PUB_ORIGINAL=false PUB_PREVIEW=false
pol "enabled, original=false, preview=true" 26 ARTIFACTS=true PUB_ORIGINAL=false PUB_PREVIEW=true
pol "enabled, original=true, preview=false" 27 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=false
pol "disabled (default), publish flags left true" 28 PUB_ORIGINAL=true PUB_PREVIEW=true
pol "all three true again" 29 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true
on JVM_EXTRA="-Xmx256m" READ_TIMEOUT=30m
step perf ./s5-perf.sh
echo "read-timeout for this run: 30m (raised so that the measurement is not cut by the 2-minute budget)" >> out/s5-perf.log
step dblatency ./s10-dblatency.sh
step paired ./s10c.sh
step candidate ./s11-candidate.sh
ARM=cand on
step revoke-cand sh -c "for i in 1 2; do $N t-revoke.mjs 2>&1 | sed 's/^/candidate: /' >> out/t-revoke-cand.log; done"
step cost-cand sh -c "ONLY_DL=1 COST_LOG=t-cost-cand $N t-cost.mjs"
on
echo "$(date +%T) BATCH DONE" >> $B
