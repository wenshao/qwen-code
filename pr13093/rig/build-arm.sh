#!/bin/bash
# Build one arm exactly as the README section tells a reader to:
#   npm run build && npm run bundle
#   mvn -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true install
#   mvn -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install
#   mvn -f packages/sdk-java/managed-agent-server/pom.xml clean package
# Only additions: dependency install, JDK 21 + MySQL 8.4 on PATH, and a private
# Maven local repository so concurrent sessions cannot overwrite the artifacts.
set -uo pipefail
ARM="$1"
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
WT="$S/wt-$ARM"
LOG="$S/logs/build-$ARM"
export JAVA_HOME="$HOME/Install/jdk21"
[ -d "$JAVA_HOME/Contents/Home" ] && export JAVA_HOME="$JAVA_HOME/Contents/Home"
export PATH="$JAVA_HOME/bin:$HOME/Install/mysql-8.4.7-macos15-arm64/bin:$PATH"
export MAVEN_ARGS="-Dmaven.repo.local=$S/m2-$ARM --batch-mode --no-transfer-progress"
cd "$WT" || exit 97

step() {
  local name="$1"; shift
  local t0=$(date +%s)
  echo "=== [$ARM] $name: $*" | tee -a "$LOG.summary"
  "$@" >"$LOG.$name.log" 2>&1
  local rc=$?
  echo "RESULT arm=$ARM step=$name rc=$rc seconds=$(( $(date +%s) - t0 )) head=$(git rev-parse --short=10 HEAD)" | tee -a "$LOG.summary"
  return $rc
}

: >"$LOG.summary"
echo "java: $(java -version 2>&1 | head -1)  node: $(node -v)  mvn: $(mvn -v 2>/dev/null | head -1)" | tee -a "$LOG.summary"
if [ ! -d "$S/m2-$ARM" ]; then
  step m2seed cp -Rc /Users/wenshao/pr13088-rig/m2 "$S/m2-$ARM" || exit 1
fi
step install corepack pnpm install --frozen-lockfile --prefer-offline --reporter=append-only || exit 1
step build npm run build || exit 1
step bundle npm run bundle || exit 1
step mvn-qwencode mvn -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true install || exit 1
step mvn-broker mvn -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install || exit 1
step mvn-server mvn -f packages/sdk-java/managed-agent-server/pom.xml clean package || exit 1
echo "RESULT arm=$ARM step=all rc=0" | tee -a "$LOG.summary"
