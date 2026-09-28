#!/bin/bash
# usage: run-it.sh <wt> <tag> <db> [it.test filter]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad
WT=$SP/$1; TAG=$2; DB=$3; FILTER=${4:-HostedWorkspaceToolTurnIT}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $WT && time mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -P hosted-workspace-tools -Dcheckstyle.skip \
  -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$FILTER" \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13848/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig12831 \
  -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node \
  -Dqwen.cli.entry=${CLI_ENTRY:-$WT/dist/cli.js} "${@:5}" verify > $SP/logs/it-$TAG.log 2>&1
echo "mvn rc=$?"
grep -E "Tests run:|HOSTED_[A-Z_]+_OK|FG6[AB] |FG6B_DATABASE|FG6A_DATABASE|BUILD|ERROR\]" $SP/logs/it-$TAG.log | head -40
