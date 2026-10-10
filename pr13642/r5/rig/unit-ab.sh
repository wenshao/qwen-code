#!/bin/bash
# usage: unit-ab.sh <worktree-arm> <m2> <tag>  -- managed-agent-server surefire phase only (H2), failures do not stop the run
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $S/wt-$1
mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-$2 -f packages/sdk-java/managed-agent-server/pom.xml \
  -Dmaven.test.failure.ignore=true clean test > $S/unitab-$3.log 2>&1
echo "$3 rev=$(git rev-parse --short HEAD) exit=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $S/unitab-$3.log | tail -1)"
grep -E '^\[ERROR\]   [A-Za-z]' $S/unitab-$3.log | cut -c1-200
