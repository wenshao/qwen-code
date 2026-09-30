#!/bin/bash
# One HostedPublicWorkspaceIT run on MySQL with two independent counters around it (issue #13049 asks for a probe):
#   - MySQL general log: every statement the fixture sends, so the diagnostic SELECTs can be counted;
#   - JFR jdk.FileRead (threshold 0): every read of harness.log by the test JVM, with bytes.
# usage: counted.sh <worktree> <label>
set -u
. /Users/wenshao/pr13095-rig/scripts/env.sh
W=$1; L=$2; shift 2
O=$RIG/out/counted; mkdir -p $O
GL=$RIG/mysql/general.log
$RIG/scripts/mysql.sh sql "SET GLOBAL general_log = 0"; : > $GL; $RIG/scripts/mysql.sh sql "SET GLOBAL general_log = 1"
rm -f $O/$L.jfr
$RIG/scripts/it.sh $W counted-$L mysql "-DargLine=-XX:StartFlightRecording:filename=$O/$L.jfr,jdk.FileRead#enabled=true,jdk.FileRead#threshold=0ms,jdk.FileRead#stackTrace=true" "$@"
$RIG/scripts/mysql.sh sql "SET GLOBAL general_log = 0"
cp $GL $O/$L.general.log
node $RIG/scripts/count.mjs $O/$L.general.log $O/$L.jfr $L | tee $O/$L.counts.txt
