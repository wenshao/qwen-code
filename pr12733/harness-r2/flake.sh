#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
cd ~/git/qwen-code-pr12733
pass=0; fail=0
for i in $(seq 1 15); do
  mvn -o --batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip -Dtest=ManagedAgentServerIntegrationTest test > $SP/flake-$i.log 2>&1
  if grep -q "Tests run: 21, Failures: 0, Errors: 0" $SP/flake-$i.log; then pass=$((pass+1)); else fail=$((fail+1)); grep -E "<<< FAILURE|Expecting" $SP/flake-$i.log | head -3; fi
done
echo "ManagedAgentServerIntegrationTest x15: pass=$pass fail=$fail"
