#!/bin/bash
set -euo pipefail
M="-B -ntp -s /rig/settings.xml -Dmaven.repo.local=/rig/m2"
cd /rig/base/packages/sdk-java
mvn $M -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install
mvn $M -f runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install
for a in base head cand; do
  cd /rig/$a/packages/sdk-java/managed-agent-server
  mvn $M -DskipTests test-compile
  echo "BUILT $a"
done
echo BUILD-DONE
