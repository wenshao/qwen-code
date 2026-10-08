#!/bin/bash
# VERIFICATION ONLY (PR #13163 R9): local head worktree — TS install+build, and the Java module installs.
set -u
W=/root/verify/pr13163-r9/h9; O=/root/verify/pr13163-r9/out; mkdir -p $O
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 QWEN_SKIP_PREPARE=1 HUSKY=0 CI=1
cd $W
( export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:$PATH
  R="-Dmaven.repo.local=/root/verify/pr13163-r9/m2 -Dmaven.repo.local.tail=/root/.m2/repository"
  (cd packages/sdk-java/qwencode && mvn -B -ntp -q $R -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/java-qwencode.log 2>&1); echo "qwencode install exit=$?" >> $O/main.log
  (cd packages/sdk-java/runtime-broker && mvn -B -ntp -q $R -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true install > $O/java-broker.log 2>&1); echo "broker install exit=$?" >> $O/main.log
  echo JAVA-DEPS-DONE >> $O/main.log ) &
corepack pnpm install --frozen-lockfile > $O/install.log 2>&1; echo "install exit=$? $(date -u +%T)" >> $O/main.log
NODE_OPTIONS=--max-old-space-size=8192 npm run build > $O/build.log 2>&1; echo "build exit=$? $(date -u +%T)" >> $O/main.log
wait; echo ALL-DONE >> $O/main.log
