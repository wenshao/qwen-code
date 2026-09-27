#!/bin/bash
# reruns ManagedAgentServerIntegrationTest N times on the PR head (container)
set -u
W=/work-rerun; rm -rf $W && mkdir -p $W && cp -a /rig/src/. $W/
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
cd $W/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install >/dev/null 2>&1
cd ../runtime-broker && mvn -B -ntp -q -DskipTests install >/dev/null 2>&1
cd ../managed-agent-server
for i in 1 2 3 4 5; do
  mvn -B -ntp test -Dtest=ManagedAgentServerIntegrationTest -Dcheckstyle.skip=true > /rig/out/rerun-server-it-$i.log 2>&1
  echo "run $i exit=$? $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' /rig/out/rerun-server-it-$i.log | tail -1) $(grep -E '<<< (FAILURE|ERROR)' /rig/out/rerun-server-it-$i.log | grep -v 'in com' | cut -c1-160)"
done
echo "--- full suite again"
mvn -B -ntp test -Dcheckstyle.skip=true > /rig/out/rerun-server-full.log 2>&1
echo "full exit=$? $(grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' /rig/out/rerun-server-full.log | tail -1)"
