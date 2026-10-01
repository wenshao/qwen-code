#!/bin/bash
# Round 3 extras: rerun the lifecycle probe (its fetch reader crashed inside undici on the new Connection: close),
# PR revocation bytes, the 1 GiB memory step in isolation, and the WebShell download-abort probe through both proxies.
R=$(cd $(dirname $0); pwd); cd $R; S=$(dirname $R)
export DB=${DB:-o3g}
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
B=$R/out/batch-extra.log
step() { echo "$(date +%T) START $1 (load $(uptime | sed 's/.*averages: //' | cut -d' ' -f1))" >> $B; shift; "$@" > /dev/null 2>> $B; echo "$(date +%T) END rc=$?" >> $B; }
rs() { local arm=$1; shift; env "$@" ./restart.sh $arm $DB > $R/run/last-restart.log 2>&1; cat $R/run/last-restart.log >> $B; grep -q "harness via tap: 200" $R/run/last-restart.log || { echo "RESTART FAILED - aborting" >> $B; exit 9; }; }
mv out/s3-s1a.log out/s3-s1a-crashed-fetch-client.log 2>/dev/null
rm -f out/t-revoke-pr.log
rs pr ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true
step s3 env FROM=s1a CORRUPT_WS=31 $N s3-lifecycle.mjs
step revoke-pr sh -c "for i in 1 2; do $N t-revoke.mjs 2>&1 | sed 's/^/PR head: /' >> out/t-revoke-pr.log; done"
step b8-pr-proxy env LABEL=b8-abort-ui-pr-proxy $N b8-abort-ui.mjs
step b8-cand-proxy env ORIGIN=http://localhost:5139 LABEL=b8-abort-ui-candidate-proxy $N b8-abort-ui.mjs
rs pr ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true JVM_EXTRA="-Xmx256m" READ_TIMEOUT=30m
step perf ./s5-perf.sh
echo "read-timeout for this run: 30m (raised so that the measurement is not cut by the 2-minute budget)" >> out/s5-perf.log
rs pr ARTIFACTS=true PUB_ORIGINAL=true PUB_PREVIEW=true
echo "$(date +%T) BATCH EXTRA DONE" >> $B
