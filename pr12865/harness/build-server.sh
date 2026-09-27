#!/bin/bash
set -eu
rm -rf /work && mkdir -p /work && cp -a /rig/src/. /work/
cd /work/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true install
cd ../runtime-broker && mvn -B -ntp -q -DskipTests install
cd ../managed-agent-server && mvn -B -ntp -q -DskipTests package
ls -la target/*.jar
mkdir -p /rig/server && cp target/*.jar /rig/server/
