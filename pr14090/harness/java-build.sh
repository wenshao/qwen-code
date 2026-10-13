#!/bin/bash
set -uo pipefail
M="-B -ntp -s /rig/settings.xml -Dmaven.repo.local=/rig/m2"
cd /rig/j-base/packages/sdk-java
mvn $M -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /rig/out/jb-qwencode.log 2>&1; echo "qwencode exit=$?"
mvn $M -f runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > /rig/out/jb-broker.log 2>&1; echo "broker exit=$?"
for a in base pr m1 m2 m3 m4; do
  cd /rig/j-$a/packages/sdk-java/managed-agent-server
  mvn $M -DskipTests test-compile > /rig/out/jb-tc-$a.log 2>&1; echo "test-compile $a exit=$?"
done
echo JAVA-BUILD-DONE
