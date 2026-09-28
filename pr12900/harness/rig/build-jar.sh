#!/bin/bash
# build-jar.sh <worktree> <out.jar> <m2>: install the tree's SDK modules into <m2>, package its server jar
source "$(dirname "$0")/env.sh"
WT=$1; OUT=$2; M2=$3
B=(mvn --batch-mode --no-transfer-progress -o -s $SP/empty-settings.xml -Dmaven.repo.local=$M2)
cd "$WT/packages/sdk-java" || exit 2
"${B[@]}" -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q &&
"${B[@]}" -f runtime-broker/pom.xml -DskipTests install -q &&
"${B[@]}" -f managed-agent-server/pom.xml -DskipTests -Dcheckstyle.skip=true clean package -q || exit 1
cp managed-agent-server/target/qwen-managed-agent-server-*.jar "$OUT" 2>/dev/null || cp $(ls managed-agent-server/target/*.jar | grep -v original | head -1) "$OUT"
echo "built $OUT from $(git -C "$WT" rev-parse --short HEAD)"
