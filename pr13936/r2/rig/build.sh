#!/bin/bash
# usage: build.sh <arm> <worktree>   (TS build+bundle, then the three Java modules into an isolated m2)
set -uo pipefail
ARM=$1; WT=$2; RIG=/Users/wenshao/git/pr13936-rig
LOG=$RIG/build-$ARM.log
exec > "$LOG" 2>&1
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:/Users/wenshao/Install/maven/bin:$PATH
M2=$RIG/m2-$ARM
if [ ! -d "$M2" ]; then cp -Rc ~/.m2/repository "$M2"; rm -rf "$M2/com/alibaba/qwencode-sdk" "$M2/com/alibaba/qwen-managed-runtime-broker" "$M2/com/alibaba/qwen-managed-agent-server"; fi
cd "$WT" || exit 9
echo "== TS build $(date +%T)"
if [ -z "${SKIP_TS:-}" ]; then npm run build && npm run bundle || { echo TSFAIL; exit 1; }; fi
echo "== Java $(date +%T)"
for m in qwencode runtime-broker; do
  (cd packages/sdk-java/$m && mvn -B -q ${MVN_OFFLINE--o} -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip -Dmaven.javadoc.skip=true -Dmaven.source.skip=true install) || { echo "JAVAFAIL $m"; exit 2; }
done
(cd packages/sdk-java/managed-agent-server && mvn -B -q ${MVN_OFFLINE--o} -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip clean package) || { echo JAVAFAIL server; exit 3; }
ls -la packages/sdk-java/managed-agent-server/target/*.jar dist/cli.js
echo "BUILD-DONE $(date +%T)"
