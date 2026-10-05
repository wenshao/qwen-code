#!/bin/bash
# installs qwencode + runtime-broker (identical on base/head) into the shared m2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/wt-pr/packages/sdk-java || exit 2
LOG=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/build-java-deps.log; : > $LOG
for m in qwencode runtime-broker; do
  mvn -B -o -Dmaven.repo.local=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad/m2/shared -DskipTests -Dcheckstyle.skip -Dgpg.skip -Dmaven.javadoc.skip -Dmaven.source.skip -f $m/pom.xml clean install >> $LOG 2>&1 || { echo "$m INSTALL-FAIL"; exit 1; }
done
echo DEPS-OK
