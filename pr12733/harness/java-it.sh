#!/bin/bash
# usage: java-it.sh <label> [extra mvn args...]
set -uo pipefail
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad
LABEL=$1; shift
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd ~/git/qwen-code-pr12733
mvn --batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo \
  -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dit.test=HostedHarnessMySqlIT \
  -Dqwen.cli.entry=$HOME/git/qwen-code-pr12733/dist/cli.js \
  -Dmysql.url='jdbc:mysql://127.0.0.1:33733/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false' \
  -Dmysql.user=root -Dmysql.password= "$@" verify checkstyle:check > $SP/java-$LABEL.log 2>&1
echo "exit=$?"
grep -E "HOSTED_MYSQL_DATABASE|Tests run: [0-9]+, Fail.*Skipped: [0-9]+$|BUILD (SUCCESS|FAILURE)|Checkstyle violations|\[ERROR\] +[A-Za-z].*(expected|Expect|must|timed out)" $SP/java-$LABEL.log | cut -c1-240 | head -12
