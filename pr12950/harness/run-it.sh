#!/bin/bash
# usage: run-it.sh <cli-arm-dir> <tag> <db> [it.test filter]
SP=<rig>
ARMDIR=$SP/$1; TAG=$2; DB=$3; FILTER=${4:-HostedWorkspaceToolTurnIT#packagedHarnessUsesSavedWorkspacesThroughRealBrokerWorkerAndSqlStore}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:~/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $SP/wt-pr && time mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -P hosted-workspace-tools -Dcheckstyle.skip \
  -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$FILTER" \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13950/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig12950 \
  -Dnode.executable=~/.local/share/fnm/node-versions/v22.23.2/installation/bin/node \
  -Dqwen.cli.entry=$ARMDIR/dist/cli.js verify > $SP/logs/it-$TAG.log 2>&1
echo "mvn rc=$?"
grep -E "Tests run:|HOSTED_[A-Z_]+_OK|AssertionError|BUILD|ERROR\]" $SP/logs/it-$TAG.log | head -30
