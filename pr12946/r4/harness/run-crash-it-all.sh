#!/bin/bash
# run-crash-it.sh <tree-for-java> <db> [case]
TREE=$1; DB=$2; CASE=${3:-worker-kill}
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
docker exec pr12946-mysql mysql -uroot -prig12946 -e "drop database if exists $DB; create database $DB" 2>/dev/null
cd $TREE/packages/sdk-java/managed-agent-server && mvn -B --no-transfer-progress -Dgpg.skip -Dmaven.repo.local=${M2:-$SCRATCH/m2} -Phosted-harness-mysql   -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedProcessCrashIT   -Dnode.executable=$NODE22 -Dqwen.cli.entry=$SCRATCH/wt-pr/dist/cli.js   "-Dmysql.url=jdbc:mysql://127.0.0.1:13946/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12946 verify
