#!/bin/bash
# Usage: build-server.sh <arm>  -> packages the Spring fat jar in wt-<arm>
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
ARM=$1
cd /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/wt-$ARM/packages/sdk-java/managed-agent-server || exit 2
mvn -B ${OFFLINE:+-o} -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/m2/shared -DskipTests -Dcheckstyle.skip clean package > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/build-server-$ARM.log 2>&1 || { echo "$ARM PACKAGE-FAIL"; exit 1; }
ls -la target/*.jar | grep -v original
echo "$ARM SERVER-BUILD-OK"
