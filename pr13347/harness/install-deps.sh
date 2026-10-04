#!/bin/bash
# install-deps.sh <tree> <m2>: stages qwencode + runtime-broker jars from <tree> into <m2>.
set -euo pipefail
T=$1; export M2=$2
cd $T/packages/sdk-java
echo "== deps from $T @ $(git rev-parse --short HEAD) into $M2"
/Users/wenshao/git/pr13347-rig/mvn.sh -B -q -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dcheckstyle.skip -Dspotbugs.skip install
/Users/wenshao/git/pr13347-rig/mvn.sh -B -q -f runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip install
echo "== done"
