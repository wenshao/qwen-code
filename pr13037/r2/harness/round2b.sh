#!/bin/bash
# Round 2, second batch (head db01133aec, schema o3e): restarts with different settings.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R)
export DB=${DB:-o3e}
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch-b.log
step() { echo "$(date +%T) START $1 (load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
rs() { env "$@" ./restart.sh pr $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
on() { env ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true "$@" ./restart.sh ${ARM:-pr} $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
# time zones
on JVM_EXTRA="-Duser.timezone=Asia/Shanghai"
step tz sh -c "$N t-tz.mjs > out/t-tz.log 2>&1"
# seven routes, disabled then enabled
rm -f out/t-routes.log
rs PUB_ORIGINAL=true PUB_PREVIEW=true
step routes-off env LABEL="O3 disabled (default)" $N t-routes.mjs
on
step routes-on env LABEL=enabled $N t-routes.mjs
# five deployment configurations
rm -f out/s7-policy.json
pol() { local label=$1 ws=$2; shift 2; rs "$@"; step "policy $label" sh -c "CONF='$label' WS=$ws $N s7-policy.mjs >> out/s7-policy.log 2>&1"; }
pol "enabled, original=false, preview=false" 25 ARTIFACTS=true PUB_ORIGINAL=false PUB_PREVIEW=false
pol "enabled, original=false, preview=true" 26 ARTIFACTS=true PUB_ORIGINAL=false PUB_PREVIEW=true
pol "enabled, original=true, preview=false" 27 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=false
pol "disabled (default), publish flags left true" 28 PUB_ORIGINAL=true PUB_PREVIEW=true
pol "all three true again" 29 ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true
# memory with a 256 MiB heap and a long read budget
on JVM_EXTRA="-Xmx256m" READ_TIMEOUT=30m
step perf ./s5-perf.sh
echo "read-timeout for this run: 30m (raised so that the measurement is not cut by the 2-minute budget)" >> out/s5-perf.log
# database latency, paired timings, candidate
step dblatency ./s10-dblatency.sh
step paired ./s10c.sh
step candidate ./s11-candidate.sh
ARM=cand on
step revoke-cand sh -c "for i in 1 2; do $N t-revoke.mjs 2>&1 | sed 's/^/candidate: /' >> out/t-revoke-cand.log; done"
step cost-cand sh -c "ONLY_DL=1 COST_LOG=t-cost-cand $N t-cost.mjs"
on
echo "$(date +%T) BATCH B DONE" >> $B
