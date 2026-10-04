#!/bin/bash
# Packages the managed-agent-server jar of each named arm into jars/.
set -euo pipefail
R=/Users/wenshao/git/pr13347-rig
for arm in "$@"; do
  m2=$R/m2; case $arm in merge*) m2=$R/m2-merge;; esac
  cd /Users/wenshao/git/pr13347-$arm/packages/sdk-java/managed-agent-server
  echo "== package $arm $(git rev-parse --short HEAD)"
  M2=$m2 $R/mvn.sh -o -q -B -DskipTests -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true clean package
  cp target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/server-$arm-$(git rev-parse --short HEAD).jar
done
ls -la $R/jars
