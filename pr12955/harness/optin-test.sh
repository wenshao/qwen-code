#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:~/Install/jdk21/bin:~/Install/maven/bin:$PATH
cd $SP/wt-mut
for SPEC in none M9 M10 M9+M10; do
  git checkout -q -- packages/sdk-java/managed-agent-server/src/main
  [ $SPEC = none ] || for M in ${SPEC//+/ }; do node $SP/mutate.mjs $M > /dev/null; done
  mvn --batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo-mut -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip -Dtest=ManagedWorkspaceFilesOptInTest test > $SP/logs/optin-$SPEC.log 2>&1
  echo "$SPEC rc=$? $(grep -E 'Tests run: [0-9]+, F' $SP/logs/optin-$SPEC.log | tail -1) $(grep -oE 'Status expected:<[0-9]+> but was:<[0-9]+>' $SP/logs/optin-$SPEC.log | head -1)"
done
git checkout -q -- packages/sdk-java/managed-agent-server/src/main
