#!/bin/bash
# usage: run-it.sh <wt> <m2tag> <cliWt> <tag> [mysqlDb] [itFilter]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
WT=$1; M2=$2; CLIWT=$3; TAG=$4; DB=$5; FILTER=${6:-HostedPublicWorkspaceIT}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
A="--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo-$M2"
MY=()
if [ -n "$DB" ]; then MY=("-Dmysql.url=jdbc:mysql://127.0.0.1:23955/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12955); fi
cd $SP/$WT
START=$(date +%s)
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dcheckstyle.skip \
  -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$FILTER" "${MY[@]}" \
  -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node \
  -Dqwen.cli.entry=$SP/$CLIWT/dist/cli.js verify > $SP/logs/it-$TAG.log 2>&1
RC=$?
echo "it-$TAG rc=$RC wall=$(( $(date +%s) - START ))s"
grep -E "Tests run:.*in com|Tests run: [0-9]+, F|BUILD|expected|Expecting|to be equal|but was" $SP/logs/it-$TAG.log | grep -v "^\[INFO\] Running" | head -6 | cut -c1-250
