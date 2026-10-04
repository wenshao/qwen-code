#!/bin/bash
# Java unit + Checkstyle on the trial merge (PR r3 + main), isolated Maven repo.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A=(--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo-merge3)
cd $SP/wt-merge3
mvn "${A[@]}" -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/merge3-qwencode.log 2>&1; echo "qwencode rc=$?"
mvn "${A[@]}" -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > $SP/logs/merge3-broker.log 2>&1; echo "broker rc=$?"
cd packages/sdk-java/managed-agent-server
mvn "${A[@]}" -Dspotbugs.skip=true clean test checkstyle:check > $SP/logs/merge3-unit.log 2>&1; echo "server test rc=$?"
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|violations|BUILD|<<< (FAIL|ERROR)" $SP/logs/merge3-unit.log | tail -5
