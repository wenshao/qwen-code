#!/bin/bash
# container: full suites on the rebased tree once more, with nothing else running on the VM
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/rebased2; mkdir -p $O
summary() { grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' "$1" | tail -1 | sed 's/^\[[A-Z]*\] //'; }
failing() { grep -E '<<< (FAILURE|ERROR)!' "$1" | grep -v -E ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//' | sed -E 's/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | tr '\n' ';'; }
W=/w-rebased2; rm -rf $W && mkdir -p $W && cp -a /rig/src-rebased/. $W/
cp -a /root/.m2/repository /m2r; R="-Dmaven.repo.local=/m2r"
SJ=$W/packages/sdk-java; CLI=/rig/wt-main/dist/cli.js
(cd $SJ/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install >/dev/null 2>&1)
(cd $SJ/runtime-broker && mvn -B -ntp $R install > $O/u-broker.log 2>&1; echo "[rebased, rerun] broker unit + checkstyle: exit=$? $(summary $O/u-broker.log) $(failing $O/u-broker.log)")
(cd $SJ/managed-agent-server && mvn -B -ntp $R test > $O/u-server.log 2>&1; echo "[rebased, rerun] server unit + checkstyle: exit=$? $(summary $O/u-server.log) $(failing $O/u-server.log)")
(cd $SJ/runtime-broker && mvn -B -ntp $R test -Pfault-gates -Dqwen.cli.entry=$CLI > $O/gates.log 2>&1; echo "[rebased, rerun] fault gates: exit=$? $(summary $O/gates.log) $(failing $O/gates.log)")
echo RERUN-DONE
