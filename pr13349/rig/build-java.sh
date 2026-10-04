#!/bin/bash
# Builds each arm's SDK modules into that arm's own m2, then its server jar.
set -euo pipefail
R=/Users/wenshao/git/pr13349-rig
for arm in head base; do
  cd /Users/wenshao/git/pr13349-$arm/packages/sdk-java
  rev=$(git rev-parse --short HEAD)
  for m in client qwencode runtime-broker; do
    echo "== [$arm $rev] install $m"
    (cd $m && $R/mvn.sh $arm -o -q -DskipTests -Dcheckstyle.skip -Dspotbugs.skip -Dgpg.skip clean install)
  done
  echo "== [$arm $rev] package managed-agent-server"
  (cd managed-agent-server && $R/mvn.sh $arm -o -q -DskipTests -Dcheckstyle.skip -Dspotbugs.skip -Dgpg.skip clean package)
  cp managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $R/jars/server-$arm-$rev.jar
done
ls -la $R/jars
