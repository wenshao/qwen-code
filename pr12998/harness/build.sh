#!/bin/bash
# Build base and head managed-agent-server with JDK 21 against an isolated
# Maven repo, mirroring the sdk-java workflow's non-MySQL steps.
set -u
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
M="mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/m2repo"
OUT=$SP/pr12998/build
mkdir -p "$OUT"
status() { echo "$(date +%T) $*" | tee -a "$OUT/status.txt"; }

status "deps: qwencode + runtime-broker install (from head tree; identical in base)"
$M -f "$SP/wt-pr/packages/sdk-java/qwencode/pom.xml" -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > "$OUT/deps-qwencode.log" 2>&1; status "qwencode exit $?"
$M -f "$SP/wt-pr/packages/sdk-java/runtime-broker/pom.xml" -DskipTests install > "$OUT/deps-broker.log" 2>&1; status "runtime-broker exit $?"

status "base: package (skip tests)"
$M -f "$SP/wt-base/packages/sdk-java/managed-agent-server/pom.xml" -DskipTests clean package > "$OUT/base-package.log" 2>&1; status "base package exit $?"

status "head: clean verify checkstyle:check (full module suite)"
$M -f "$SP/wt-pr/packages/sdk-java/managed-agent-server/pom.xml" clean verify checkstyle:check > "$OUT/head-verify.log" 2>&1; status "head verify exit $?"
status "done"
