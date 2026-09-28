#!/bin/bash
# usage: mut-run.sh M1 M2 ...  -> results in logs/mut-results.tsv
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo-mut"
cd $SP/wt-mut
for M in "$@"; do
  git checkout -q -- packages/sdk-java
  node $SP/mutate.mjs $M || { echo -e "$M\tAPPLY_FAIL" >> $SP/logs/mut-results.tsv; continue; }
  SDKRC=-
  if [ "$M" = M17 ] || [ "$M" = M18 ]; then
    mvn $A -f packages/sdk-java/qwencode/pom.xml -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dcheckstyle.skip install > $SP/logs/mut-$M-sdk.log 2>&1; SDKRC=$?
    if [ $SDKRC -ne 0 ]; then
      # install the mutated SDK anyway so the server suite sees it
      mvn $A -f packages/sdk-java/qwencode/pom.xml -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dcheckstyle.skip -DskipTests install > /dev/null 2>&1
    fi
  fi
  mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip test > $SP/logs/mut-$M-unit.log 2>&1; RC=$?
  FAILED=$(grep -E "^\[ERROR\]   [A-Za-z]+.*:[0-9]+|^\[ERROR\] [A-Za-z]+Test\.[a-zA-Z]+" $SP/logs/mut-$M-unit.log | sed -E 's/^\[ERROR\] +//' | cut -c1-90 | sort -u | head -4 | tr '\n' ';')
  SUM=$(grep -E "Tests run:" $SP/logs/mut-$M-unit.log | tail -1 | sed 's/\[.*\] //')
  echo -e "$M\tsdk=$SDKRC\tunit=$RC\t$SUM\t$FAILED" >> $SP/logs/mut-results.tsv
  if [ "$M" = M17 ] || [ "$M" = M18 ]; then
    git checkout -q -- packages/sdk-java
    mvn $A -f packages/sdk-java/qwencode/pom.xml -Dgpg.skip=true -Dmaven.javadoc.skip=true -Dcheckstyle.skip -DskipTests install > /dev/null 2>&1
  fi
done
git checkout -q -- packages/sdk-java
echo MUT_DONE
