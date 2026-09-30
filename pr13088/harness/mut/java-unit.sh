#!/bin/bash
# container: unit-suite stage of the Java mutation run on a local-disk copy. usage: java-unit.sh <tree> [ids...]
set -u
TREE=$1; shift
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
rm -rf /m && mkdir -p /m && cp -a /rig/$TREE/. /m/
cp -a /root/.m2/repository /m2; R="-Dmaven.repo.local=/m2"
(cd /m/packages/sdk-java/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /dev/null 2>&1)
(cd /m/packages/sdk-java/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true install > /dev/null 2>&1); echo "deps installed: exit=$?"
(cd /m/packages/sdk-java/managed-agent-server && mvn -B -ntp -q $R -Dcheckstyle.skip=true test-compile > /dev/null 2>&1); echo "server test-compile: exit=$?"
cd /rig/mut && node java-mutants.mjs unit "$@"
echo JAVA-UNIT-DONE
