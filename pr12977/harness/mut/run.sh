#!/bin/bash
# container: for each mutant, broker unit suite + server unit suite (H2) on a fresh copy of the PR tree; rerun a failing stage once.
set -u
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/mut; mkdir -p $O
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(mkdir -p /q && cp -a /rig/src/packages/sdk-java/qwencode /q/ && cd /q/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true install > /dev/null 2>&1)
stage() { # <label> <dir> <args...>
  local L=$1 D=$2; shift 2
  (cd $D && mvn -B -ntp $R "$@" > $O/$L.log 2>&1); local rc=$?
  if [ $rc -ne 0 ]; then (cd $D && mvn -B -ntp $R "$@" > $O/$L.rerun.log 2>&1); local rc2=$?; echo "$rc/$rc2"; else echo "0"; fi
}
fails() { grep -h -E '<<< (FAILURE|ERROR)!' "$@" 2>/dev/null | grep -v ' in com\.' | sed -E 's/^\[ERROR\] +//; s/ -- Time elapsed.*//; s/com\.alibaba\.qwen\.code\.(runtimebroker|managedagent)\.//' | sort -u | head -4 | tr '\n' ';'; }
for id in ${IDS:-BASE M01 M02 M03 M04 M05 M06 M07 M08 M09 M10 M11 M12}; do
  W=/m-$id; rm -rf $W && mkdir -p $W/packages/cli/src/serve && cp -a /rig/src/packages/sdk-java $W/packages/ && cp -a /rig/src/packages/cli/src/serve/contracts $W/packages/cli/src/serve/ && mkdir -p $W/packages/core/src/managed-runtime && cp -a /rig/src/packages/core/src/managed-runtime/contracts $W/packages/core/src/managed-runtime/
  node /rig/mut/apply.mjs $W $id > $O/$id.apply 2>&1 || { echo "$id APPLY-FAILED $(cat $O/$id.apply)"; continue; }
  (cd $W/packages/sdk-java/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install > $O/$id-build.log 2>&1) || { echo "$id COMPILE-ERROR (broker)"; continue; }
  b=$(stage $id-broker $W/packages/sdk-java/runtime-broker test -Dcheckstyle.skip=true)
  s=$(stage $id-server $W/packages/sdk-java/managed-agent-server test -Dcheckstyle.skip=true)
  echo "$id broker=$b server=$s :: $(cat $O/$id.apply | head -1) :: $(fails $O/$id-broker.log $O/$id-server.log)"
done
echo MUT-DONE
