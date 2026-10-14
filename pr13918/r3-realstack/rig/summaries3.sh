#!/bin/bash
# Collect round-3 test summaries into assets-stage/pr13918/r3-realstack/test-summaries-r3.txt
RIG=/Users/wenshao/pr13918-rig; O=$RIG/assets-stage/pr13918/r3-realstack/test-summaries-r3.txt; mkdir -p $(dirname $O)
s() { echo; echo "### $1"; shift; for f in "$@"; do echo "-- $(basename $f): $(head -1 $f | cut -c1-160)"; grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+(, Time elapsed.* -- in .*)?$|<<< (FAILURE|ERROR)!$|EXIT=|Test Files|Tests  " $f | sed 's/^\[[A-Z]*\] //' | cut -c1-230; done; }
{
echo "PR #13918 round 3 — test summaries (macOS arm64, JDK 21). Head 72a7897843 first, then the earlier 695fcf592e runs."
s "MySQL 8.4.7 guard ITs + ManagedAgentCsiMutationMySqlIT, head 72a7897843" $RIG/out/it-r4-guard.log
s "MySQL 8.4.7 witness: head's ManagedAgentCsiMutationMySqlIT on 695fcf592e" $RIG/out/it-r3w-csiwit.log
echo; echo "### H2 unit, mutant M1 on 72a7897843 (6 classes; surefire XML counts)"
for f in $RIG/src-r4/packages/sdk-java/managed-agent-server/target/surefire-reports/TEST-*.xml; do echo "$(basename $f .xml | sed 's/TEST-com.alibaba.qwen.code.managedagent.//') $(grep -o 'tests="[0-9]*" errors="[0-9]*" skipped="[0-9]*" failures="[0-9]*"' $f | head -1)"; done
echo; echo "### MariaDB 10.11.18: broker + full non-Hosted managed-agent IT run, 72a7897843 + 43f7d42817 + 688ccb347f"
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+(, Time elapsed.* -- in .*)?$|<<< (FAILURE|ERROR)!$|exit=" $RIG/out/it-r4j-mariadb.log | sed 's/^\[[A-Z]*\] //' | cut -c1-230
echo; echo "================ 695fcf592e ================"
s "MySQL 8.4.7 guard ITs, head" $RIG/out/it-r3-guard.log
s "MySQL 8.4.7 witness: ManagedSessionGuardConvoyIT at c7c2f7aab1 (before the CSI commits)" $RIG/out/it-c7-convoy.log
s "MySQL 8.4.7 mutant M1 (requireNoLifecycleClaim removed from requireOrdinaryAdmission)" $RIG/out/it-r3mut-m1.log
s "H2 unit: baseline / M1 / M1 (6 classes) / M2" $RIG/out/mut-base0.log $RIG/out/mut-m1.log $RIG/out/mut-m1b.log $RIG/out/mut-m2.log
echo; echo "### MariaDB 10.11.18: full non-Hosted managed-agent IT run (head + 43f7d42817)"
echo "(the runtime-broker part of this log errored with Unknown database 'runtime_broker_test' because the local server had no pre-created database; it is filtered out here and rerun below as itm-r3m-broker.log)"
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+(, Time elapsed.* -- in .*)?$|<<< (FAILURE|ERROR)!$|exit=" $RIG/out/it-r3m-mariadb.log | grep -v "runtimebroker" | grep -v "Tests run: 74, Failures: 0, Errors: 73" | sed 's/^\[[A-Z]*\] //' | cut -c1-230
s "MariaDB 10.11.18: reruns and broker ITs" $(ls $RIG/out/itm-*.log 2>/dev/null)
} > $O
wc -l $O
