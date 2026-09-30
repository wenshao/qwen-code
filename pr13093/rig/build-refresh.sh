#!/bin/bash
# Rebuild the merge arm after main moved (lockfile and package.json unchanged,
# so dependencies are kept): the README's build commands, nothing else.
set -uo pipefail
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
LOG="$S/logs/build-merge2"
export JAVA_HOME="$HOME/Install/jdk21"
export PATH="$JAVA_HOME/bin:$HOME/Install/mysql-8.4.7-macos15-arm64/bin:$PATH"
export MAVEN_ARGS="-Dmaven.repo.local=$S/m2-merge --batch-mode --no-transfer-progress"
cd "$S/wt-merge" || exit 97
: >"$LOG.summary"
step() {
  local name="$1"; shift
  local t0=$(date +%s)
  "$@" >"$LOG.$name.log" 2>&1
  local rc=$?
  echo "RESULT arm=merge2 step=$name rc=$rc seconds=$(( $(date +%s) - t0 )) head=$(git rev-parse --short=10 HEAD)" | tee -a "$LOG.summary"
  return $rc
}
step build npm run build || exit 1
step bundle npm run bundle || exit 1
step mvn-qwencode mvn -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true install || exit 1
step mvn-broker mvn -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install || exit 1
step mvn-server mvn -f packages/sdk-java/managed-agent-server/pom.xml clean package || exit 1
echo "RESULT arm=merge2 step=all rc=0" | tee -a "$LOG.summary"
